/**
 * Credit protection for photo analysis, the only call that spends Anthropic credits.
 *
 * Order of the checks: blocked user → kill switch → monthly budget cap → daily quota (the demo
 * accounts share one small pool). A cached analysis (same photo hash) costs nothing and never
 * reaches this gate. When the answer is "no", the UI switches to demo mode and offers the
 * sample photos.
 */
import type { Principal } from "./authz";
import { type Db, periodStarts } from "./db";

export type AnalysisDenial = "blocked" | "kill_switch" | "budget_cap" | "quota_exceeded";

export interface AnalysisAllowance {
	allowed: boolean;
	reason: AnalysisDenial | null;
	/** "demo" when analysis is refused: the UI offers the sample photos instead. */
	mode: "live" | "demo";
	usedToday: number;
	dailyQuota: number;
	/** True when the count and quota are the demo accounts' shared pool. */
	sharedPool: boolean;
	monthSpendUsd: number;
	monthlyCapUsd: number;
}

export interface QuotaInputs {
	blocked: boolean;
	killSwitch: boolean;
	monthSpendUsd: number;
	monthlyCapUsd: number;
	isDemo: boolean;
	usedToday: number;
	dailyQuota: number;
}

export function decideAnalysis(inputs: QuotaInputs): AnalysisAllowance {
	const deny = (reason: AnalysisDenial): AnalysisAllowance => ({
		...shape(inputs),
		allowed: false,
		reason,
		mode: "demo",
	});
	if (inputs.blocked) return deny("blocked");
	if (inputs.killSwitch) return deny("kill_switch");
	if (inputs.monthSpendUsd >= inputs.monthlyCapUsd) return deny("budget_cap");
	if (inputs.usedToday >= inputs.dailyQuota) return deny("quota_exceeded");
	return { ...shape(inputs), allowed: true, reason: null, mode: "live" };
}

function shape(inputs: QuotaInputs) {
	return {
		usedToday: inputs.usedToday,
		dailyQuota: inputs.dailyQuota,
		sharedPool: inputs.isDemo,
		monthSpendUsd: round(inputs.monthSpendUsd),
		monthlyCapUsd: inputs.monthlyCapUsd,
	};
}

/** Quota precedence: the user's override, then the organization's, then the platform default. */
export function effectiveDailyQuota(
	userQuota: number | null,
	orgQuota: number | null,
	platformDefault: number,
): number {
	return userQuota ?? orgQuota ?? platformDefault;
}

export interface PlatformSettings {
	killSwitch: boolean;
	monthlyCapUsd: number;
	defaultDailyQuota: number;
	demoSharedDailyQuota: number;
}

export async function readSettings(db: Db): Promise<PlatformSettings> {
	const { results } = await db.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
	const map = new Map(results.map((r) => [r.key, r.value]));
	return {
		killSwitch: map.get("kill_switch") === "true",
		monthlyCapUsd: Number(map.get("monthly_cap_usd") ?? 80),
		defaultDailyQuota: Number(map.get("default_daily_quota") ?? 5),
		demoSharedDailyQuota: Number(map.get("demo_shared_daily_quota") ?? 10),
	};
}

export async function monthSpendUsd(db: Db, at: Date = new Date()): Promise<number> {
	const row = await db
		.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS total FROM usage WHERE created_at >= ?")
		.bind(periodStarts(at).month)
		.first<{ total: number }>();
	return row?.total ?? 0;
}

/** Billed (not cached) analyses today: the user's own, or the demo accounts' shared pool. */
async function analysesToday(db: Db, principal: Principal, at: Date): Promise<number> {
	const day = periodStarts(at).day;
	const sql = principal.isDemo
		? "SELECT COUNT(*) AS n FROM usage WHERE kind = 'photo_analysis' AND cached = 0 AND is_demo = 1 AND created_at >= ?"
		: "SELECT COUNT(*) AS n FROM usage WHERE kind = 'photo_analysis' AND cached = 0 AND user_id = ? AND created_at >= ?";
	const statement = principal.isDemo ? db.prepare(sql).bind(day) : db.prepare(sql).bind(principal.userId, day);
	const row = await statement.first<{ n: number }>();
	return row?.n ?? 0;
}

export async function analysisAllowance(
	db: Db,
	principal: Principal,
	at: Date = new Date(),
): Promise<AnalysisAllowance> {
	const settings = await readSettings(db);
	const user = await db
		.prepare("SELECT daily_analysis_quota AS q FROM users WHERE id = ?")
		.bind(principal.userId)
		.first<{ q: number | null }>();
	const org = principal.orgId
		? await db
				.prepare("SELECT daily_analysis_quota AS q FROM organizations WHERE id = ?")
				.bind(principal.orgId)
				.first<{ q: number | null }>()
		: null;
	const dailyQuota = principal.isDemo
		? settings.demoSharedDailyQuota
		: effectiveDailyQuota(user?.q ?? null, org?.q ?? null, settings.defaultDailyQuota);
	return decideAnalysis({
		blocked: principal.blocked,
		killSwitch: settings.killSwitch,
		monthSpendUsd: await monthSpendUsd(db, at),
		monthlyCapUsd: settings.monthlyCapUsd,
		isDemo: principal.isDemo,
		usedToday: await analysesToday(db, principal, at),
		dailyQuota,
	});
}

function round(value: number): number {
	return Math.round(value * 10000) / 10000;
}
