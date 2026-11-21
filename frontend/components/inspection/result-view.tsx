"use client";

/**
 * The result of an inspection: the scorecard of the seven situations, the worst one first with
 * its 3D replay, force arrows and reason sentence, the EN 12195-1 and CONTRAN 945 checks, the
 * axle loads, and the fix ("Apply fix and re-simulate"). Used by the new-inspection flow and by
 * a saved inspection's page (read only).
 */

import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { AxleBars } from "@/components/explorer/load-editor";
import { ExplorerScene } from "@/components/explorer/explorer-scene";
import { useReasonSentence } from "@/components/lab/lab-result";
import { Findings, useReplayText } from "@/components/scenario/replay-shared";
import { pill } from "@/components/ui/pill";
import { VerdictBadge } from "@/components/ui/verdict-badge";
import { Link } from "@/i18n/navigation";
import type { Finding } from "@/lib/demo";
import { AXLE_LIMIT_KG, encodeDraft, type LoadDraft } from "@/lib/explorer/draft";
import type { ExplorerRun } from "@/lib/explorer/use-explorer";
import { parseKeyframes } from "@/lib/keyframes";
import type { LiveRun } from "@/lib/live/engine";
import { explain } from "@/lib/live/reason";
import { simulateSituation } from "@/lib/inspection/client";
import { fetchSampleRun } from "@/lib/inspection/samples";
import {
  type Battery,
  batteryPasses,
  type Change,
  type Plan,
  SITUATION_IDS,
  type ServerRunResult,
  type SituationId,
  type SituationResult,
} from "@/lib/inspection/types";

type Variant = "as_loaded" | "fixed";

export function ResultView({
  battery,
  plan,
  fixing = false,
  fixStartedAt = null,
  onApplyFix,
  sampleRuns,
  readOnly = false,
  error = null,
}: {
  battery: Battery;
  plan: Plan | null;
  fixing?: boolean;
  fixStartedAt?: number | null;
  onApplyFix?: () => void;
  /** Static runs of a sample's situations (no API needed). */
  sampleRuns?: Partial<Record<Variant, Partial<Record<SituationId, string>>>>;
  readOnly?: boolean;
  error?: string | null;
}) {
  const t = useTranslations("Flow");
  const fixed = plan?.battery ?? null;
  const [variant, setVariant] = useState<Variant>("as_loaded");
  const shown = variant === "fixed" && fixed ? fixed : battery;
  const [chosen, setChosen] = useState<SituationId | null>(null);
  const situation = shown.situations.find((s) => s.id === (chosen ?? shown.worst)) ?? shown.situations[0];

  // A fix that just arrived is shown at once.
  const seenPlan = useRef(plan);
  useEffect(() => {
    if (plan && plan !== seenPlan.current && plan.battery) {
      seenPlan.current = plan;
      setVariant("fixed");
      setChosen(null);
    }
  }, [plan]);

  return (
    <div data-testid="inspection-result" data-passed={shown.passed} data-variant={variant}>
      {fixed && (
        <div className="mb-8 inline-flex rounded-full bg-surface p-1" role="group" aria-label={t("result.variant")}>
          {(["as_loaded", "fixed"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={variant === value}
              onClick={() => {
                setVariant(value);
                setChosen(null);
              }}
              className={pill({ variant: variant === value ? "primary" : "secondary", className: "h-10 px-4" })}
            >
              {t(`result.${value === "fixed" ? "fixedVersion" : "asLoaded"}`)}
            </button>
          ))}
        </div>
      )}

      <Scorecard battery={shown} selected={situation?.id ?? null} onSelect={setChosen} fixed={variant === "fixed"} />

      {situation && (
        <SituationDetail
          key={`${variant}-${situation.id}`}
          battery={shown}
          situation={situation}
          staticRun={sampleRuns?.[variant]?.[situation.id]}
        />
      )}

      <Checks battery={shown} />

      {variant === "as_loaded" && !readOnly && (
        <FixPanel battery={battery} plan={plan} fixing={fixing} startedAt={fixStartedAt} onApplyFix={onApplyFix} error={error} />
      )}
      {variant === "as_loaded" && readOnly && plan && <ChangeList changes={plan.changes} title={t("fix.applied")} />}
      {variant === "fixed" && plan && <ChangeList changes={plan.changes} title={t("fix.applied")} />}
    </div>
  );
}

// ---- scorecard ----------------------------------------------------------------------------

function StatusMark({ status }: { status: SituationResult["status"] }) {
  const style =
    status === "pass" ? "bg-pass text-white" : status === "warning" ? "bg-amber text-ink" : "bg-fail text-white";
  return (
    <span aria-hidden className={`inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[0.8125rem] font-medium ${style}`}>
      {status === "pass" ? "✓" : status === "warning" ? "!" : "✕"}
    </span>
  );
}

function topFinding(situation: SituationResult): Finding | undefined {
  const order = ["unit_left_bed", "lashing_broke", "unit_tilted", "unit_rolled", "unit_hit_headboard", "headboard_overloaded", "unit_slid", "axle_overloaded", "lashing_overloaded"];
  const sorted = [...situation.findings].sort(
    (a, b) => (a.severity === "fail" ? 0 : 1) - (b.severity === "fail" ? 0 : 1) || order.indexOf(a.code) - order.indexOf(b.code),
  );
  return sorted[0];
}

function Scorecard({
  battery,
  selected,
  onSelect,
  fixed,
}: {
  battery: Battery;
  selected: SituationId | null;
  onSelect: (id: SituationId) => void;
  fixed: boolean;
}) {
  const t = useTranslations("Flow");
  const { findingSentence } = useReplayText();
  const passes = batteryPasses(battery);
  const failing = battery.situations.filter((s) => !s.passed);
  const ordered = SITUATION_IDS.map((id) => battery.situations.find((s) => s.id === id)).filter(
    (s): s is SituationResult => Boolean(s),
  );
  return (
    <section aria-labelledby="scorecard-title">
      <VerdictBadge verdict={passes ? "pass" : "fail"}>{passes ? t("result.arrives") : t("result.doesNotArrive")}</VerdictBadge>
      <h2 id="scorecard-title" className="type-hero mt-4 text-balance" data-testid="scorecard">
        {t("result.passes", { passed: battery.passed, total: battery.total })}
      </h2>
      <p className="type-body mt-3 text-pretty">
        {failing.length === 0
          ? passes
            ? t(fixed ? "result.allFixed" : "result.all")
            : t("result.allButRules")
          : t("result.worst", { count: failing.length, situation: t(`situations.${battery.worst}.name`) })}
      </p>
      <ul className="mt-6 border-b border-hairline">
        {ordered.map((situation) => {
          const finding = topFinding(situation);
          return (
            <li key={situation.id} className="border-t border-hairline">
              <button
                type="button"
                aria-pressed={selected === situation.id}
                onClick={() => onSelect(situation.id)}
                data-situation={situation.id}
                data-status={situation.status}
                className={`flex min-h-14 w-full items-center gap-3 py-2.5 text-left hover:bg-surface/40 ${selected === situation.id ? "bg-surface/60" : ""}`}
              >
                <StatusMark status={situation.status} />
                <span className="min-w-0 flex-1">
                  <span className="block font-[450] text-ink">{t(`situations.${situation.id}.name`)}</span>
                  <span className="type-small block truncate text-gray">
                    {finding ? findingSentence(finding) : t("result.holds")}
                  </span>
                </span>
                <span aria-hidden className="text-gray">
                  ›
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---- one situation ------------------------------------------------------------------------

function toRun(result: ServerRunResult): ExplorerRun {
  const doc = parseKeyframes(result.keyframes);
  return { source: "server", summary: result, doc, reason: explain(result, doc), runMs: 0 };
}

function SituationDetail({
  battery,
  situation,
  staticRun,
}: {
  battery: Battery;
  situation: SituationResult;
  staticRun?: string;
}) {
  const t = useTranslations("Flow");
  const lab = useTranslations("Lab");
  const format = useFormatter();
  const sentence = useReasonSentence();
  const engine = useRef<LiveRun | null>(null);
  const isWorst = situation.id === battery.worst;
  const [run, setRun] = useState<ExplorerRun | null>(() => (isWorst ? toRun(battery.worst_result) : null));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (isWorst) return;
    const controller = new AbortController();
    (async () => {
      const stored = await fetchSampleRun(staticRun).catch(() => null);
      return stored ?? (await simulateSituation(battery.scenario, situation.event, controller.signal));
    })()
      .then((result) => setRun(toRun(result)))
      .catch(() => !controller.signal.aborted && setFailed(true));
    return () => controller.abort();
  }, [battery.scenario, isWorst, situation.event, staticRun]);

  const explorerDraft: LoadDraft = { ...battery.draft, trip: situation.trip };
  return (
    <section className="mt-14" aria-labelledby="situation-title" data-testid="situation-detail" data-situation={situation.id}>
      <p className="type-label">{isWorst ? t("detail.worst") : t("detail.label")}</p>
      <h2 id="situation-title" className="type-card-title mt-2">
        {t(`situations.${situation.id}.name`)}
      </h2>
      <p className="type-small mt-1 text-gray">
        {lab("eventLine", {
          event: lab(`events.${situation.event.kind}` as never),
          speed: format.number(situation.event.speed_kmh),
          surface: lab(`surfaces.${situation.event.road_surface}` as never),
        })}
      </p>
      <div className="mt-4">
        <VerdictBadge verdict={situation.status === "fail" ? "fail" : "pass"}>
          {t(`status.${situation.status}`)}
        </VerdictBadge>
        <p className="type-card-title mt-3 text-pretty" data-testid="situation-reason">
          {run ? sentence(run.reason) : failed ? t("detail.unavailable") : t("detail.loading")}
        </p>
      </div>
      <div className="mt-6">
        <ExplorerScene run={run} engine={engine} busy={!run} event={situation.event.kind} />
      </div>
      {run && <Findings run={run.summary} />}
      <div className="mt-6 flex flex-wrap gap-3">
        <Link href={`/app/explorer#draft=${encodeDraft(explorerDraft)}`} className={pill({ variant: "secondary", className: "h-11 px-4" })}>
          {t("detail.openExplorer")}
        </Link>
      </div>
      <p className="type-small mt-2 text-gray">{t("detail.explorerHint")}</p>
    </section>
  );
}

// ---- checks -------------------------------------------------------------------------------

function Checks({ battery }: { battery: Battery }) {
  const t = useTranslations("Flow");
  const format = useFormatter();
  const { nameOf } = useReplayText();
  const axles = battery.axle_loads.map((axle) => {
    const group = battery.scenario.vehicle?.axle_groups.find((g) => g.id === axle.axle_group_id);
    return {
      id: axle.axle_group_id,
      kind: group?.kind ?? "single_2_tyres",
      loadKg: axle.load_kg,
      limitKg: group ? AXLE_LIMIT_KG[group.kind] : axle.limit_kg,
      ratio: axle.ratio,
    };
  });
  const tonnes = (kg: number) => format.number(kg / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return (
    <section className="mt-16" aria-labelledby="checks-title">
      <h2 id="checks-title" className="type-card-title">
        {t("checks.title")}
      </h2>
      <h3 className="type-label mt-6">{t("checks.contran")}</h3>
      <ul className="mt-2 border-b border-hairline" data-testid="contran-checks">
        {battery.contran_945.map((check) => (
          <li key={check.code} className="flex items-start gap-3 border-t border-hairline py-2.5" data-check={check.code} data-status={check.status}>
            {check.status === "not_applicable" ? (
              <span aria-hidden className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-surface text-[0.8125rem] text-gray">
                –
              </span>
            ) : (
              <StatusMark status={check.status === "pass" ? "pass" : "fail"} />
            )}
            <span className="min-w-0 flex-1">
              <span className="block text-ink">{t(`contran.${check.code}.${check.status === "fail" ? "fail" : "pass"}`)}</span>
              <span className="type-small block text-gray">
                {check.article}
                {check.unit_ids.length > 0 && ` · ${check.unit_ids.map((id) => nameOf(id)).join(", ")}`}
                {check.status === "not_applicable" && ` · ${t("checks.notApplicable")}`}
              </span>
            </span>
          </li>
        ))}
      </ul>

      <h3 className="type-label mt-8">{t("checks.en")}</h3>
      <ul className="mt-2 border-b border-hairline">
        {battery.en_12195_1.map((check) => (
          <li key={check.unit_id} className="flex items-start gap-3 border-t border-hairline py-2.5">
            {check.meets_standard === null ? (
              <span aria-hidden className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-surface text-[0.8125rem] text-gray">
                –
              </span>
            ) : (
              <StatusMark status={check.meets_standard ? "pass" : "fail"} />
            )}
            <span className="min-w-0 flex-1">
              <span className="block text-ink">{nameOf(check.unit_id)}</span>
              <span className="type-small block text-gray">
                {check.meets_standard === null
                  ? t("checks.enNotAssessed")
                  : check.required_lashings !== null
                    ? t("checks.enStraps", { installed: check.installed_lashings, required: check.required_lashings })
                    : t(check.meets_standard ? "checks.enMeets" : "checks.enFails")}
              </span>
            </span>
          </li>
        ))}
      </ul>

      <AxleBars axles={axles} tonnes={tonnes} />
      <p className="type-small mt-2 text-gray">{t("checks.axleSource")}</p>
    </section>
  );
}

// ---- fix ----------------------------------------------------------------------------------

/** An option's label in the middle of a sentence. */
function lower(label: string): string {
  return label.charAt(0).toLocaleLowerCase() + label.slice(1);
}

export function useChangeSentence() {
  const t = useTranslations("Flow");
  const { nameOf } = useReplayText();
  const format = useFormatter();
  const restraint = useTranslations("Explorer.options");
  return (change: Change): string => {
    const cm = (m: number | undefined) => format.number(Math.abs((m ?? 0) * 100), { maximumFractionDigits: 0 });
    switch (change.code) {
      case "straps":
        return t("changes.straps", { unit: nameOf(change.unit_id), from: Number(change.before ?? 0), to: Number(change.after ?? 0) });
      case "restraint":
        return t("changes.restraint", {
          from: lower(restraint(`restraint.${String(change.before)}` as never)),
          to: lower(restraint(`restraint.${String(change.after)}` as never)),
        });
      case "close_gaps":
        return t(change.values.limited_by_axles ? "changes.closeGapsAxles" : "changes.closeGaps", { distance: cm(change.values.moved_m) });
      case "balance_axles":
        return t((change.values.shift_m ?? 0) > 0 ? "changes.balanceForward" : "changes.balanceBack", {
          distance: cm(change.values.shift_m),
          load: format.number((change.values.load_kg ?? 0) / 1000, { maximumFractionDigits: 2 }),
          limit: format.number((change.values.limit_kg ?? 0) / 1000, { maximumFractionDigits: 1 }),
        });
      case "overweight":
        return t("changes.overweight", {
          mass: format.number((change.values.mass_kg ?? 0) / 1000, { maximumFractionDigits: 1 }),
          payload: format.number((change.values.payload_kg ?? 0) / 1000, { maximumFractionDigits: 1 }),
        });
      default:
        return t(`changes.${change.code}`);
    }
  };
}

function ChangeList({ changes, title }: { changes: Change[]; title: string }) {
  const sentence = useChangeSentence();
  if (!changes.length) return null;
  return (
    <section className="mt-12">
      <h3 className="type-label">{title}</h3>
      <ol className="mt-3 space-y-2" data-testid="fix-changes">
        {changes.map((change, n) => (
          <li key={n} className="flex gap-3">
            <span className="font-mono text-[0.8125rem] text-gray">{n + 1}.</span>
            <span className="min-w-0 flex-1">
              <span className="block text-ink">{sentence(change)}</span>
              {change.article && <span className="type-small block text-gray">{change.article}</span>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function FixPanel({
  battery,
  plan,
  fixing,
  startedAt,
  onApplyFix,
  error,
}: {
  battery: Battery;
  plan: Plan | null;
  fixing: boolean;
  startedAt: number | null;
  onApplyFix?: () => void;
  error: string | null;
}) {
  const t = useTranslations("Flow");
  if (batteryPasses(battery)) {
    return (
      <section className="mt-16">
        <h2 className="type-card-title">{t("fix.title")}</h2>
        <p className="type-body mt-3">{t("fix.none")}</p>
      </section>
    );
  }
  const changes = plan?.changes ?? battery.recommendation?.changes ?? [];
  return (
    <section className="mt-16" aria-labelledby="fix-title" data-testid="fix-panel">
      <h2 id="fix-title" className="type-card-title">
        {t("fix.title")}
      </h2>
      <p className="type-body mt-3 text-pretty">{t("fix.sentence")}</p>
      <ChangeList changes={changes} title={plan ? t("fix.applied") : t("fix.recommended")} />
      {plan ? (
        <p className="type-body mt-6" data-testid="fix-result">
          {plan.verified && plan.battery
            ? t("fix.proven", { passed: plan.battery.passed, total: plan.battery.total })
            : t("fix.notProven", { passed: plan.battery?.passed ?? 0, total: plan.battery?.total ?? 7 })}
        </p>
      ) : fixing ? (
        <Running startedAt={startedAt} label={t("fix.running")} />
      ) : (
        <button type="button" onClick={onApplyFix} className={pill({ className: "mt-6 h-12 px-5" })} data-testid="apply-fix">
          {t("fix.apply")}
        </button>
      )}
      {error && !fixing && (
        <p role="alert" className="type-small mt-3 text-fail">
          {t.has(`errors.${error}` as never) ? t(`errors.${error}` as never) : t("errors.failed")}
        </p>
      )}
    </section>
  );
}

/** A long server run: what is happening and how long it has taken so far. */
export function Running({ startedAt, label, situations = false }: { startedAt: number | null; label: string; situations?: boolean }) {
  const t = useTranslations("Flow");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  const seconds = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
  return (
    <div role="status" aria-live="polite" className="mt-6" data-testid="running">
      <p className="font-[450] text-ink">{label}</p>
      <p className="type-small mt-1 text-gray">{t("running.elapsed", { seconds })}</p>
      <div className="mt-3 h-0.5 w-full max-w-md overflow-hidden bg-surface" aria-hidden>
        <div className="h-full w-1/3 animate-[indeterminate_1.1s_ease-in-out_infinite] bg-ink" />
      </div>
      {situations && (
        <ul className="type-small mt-4 grid grid-cols-1 gap-1 text-gray sm:grid-cols-2">
          {SITUATION_IDS.map((id) => (
            <li key={id}>· {t(`situations.${id}.name`)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
