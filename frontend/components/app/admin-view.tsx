"use client";

import { cn } from "cn";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { useMe } from "@/components/app/me-provider";
import { pill } from "@/components/ui/pill";
import { VerdictBadge } from "@/components/ui/verdict-badge";
import { useRouter } from "@/i18n/navigation";
import { type AdminOverview, type AdminUser, useAppApi } from "@/lib/app-api";

const th = "type-label h-10 border-b border-hairline px-3 text-left font-normal first:pl-0";
const td = "border-b border-hairline px-3 py-2.5 align-middle first:pl-0";
const num = "text-right font-mono text-[0.875rem]";

/** `/app/admin`: the platform admin's view (desktop-first): spend vs cap, kill switch, quotas, users. */
export function AdminView() {
  const t = useTranslations("Admin");
  const format = useFormatter();
  const { ready, signedIn, me } = useMe();
  const request = useAppApi();
  const router = useRouter();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [users, setUsers] = useState<AdminUser[] | null>(null);

  const fetchAll = useCallback(
    () =>
      Promise.all([request<AdminOverview>("/admin/overview"), request<{ users: AdminUser[] }>("/admin/users")]),
    [request],
  );

  const load = useCallback(async () => {
    const [o, u] = await fetchAll();
    setOverview(o);
    setUsers(u.users);
  }, [fetchAll]);

  useEffect(() => {
    if (!me?.is_platform_admin) return;
    let cancelled = false;
    fetchAll()
      .then(([o, u]) => {
        if (cancelled) return;
        setOverview(o);
        setUsers(u.users);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [me, fetchAll]);

  useEffect(() => {
    if (ready && !signedIn) router.replace("/app/sign-in");
  }, [ready, signedIn, router]);

  if (ready && !signedIn) return null;
  if (me && !me.is_platform_admin) return <p className="type-body col">{t("forbidden")}</p>;
  if (!overview || !users) return <p className="type-small col text-gray">{t("loading")}</p>;

  const usd = (value: number) => format.number(value, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const share = Math.min(1, overview.month_spend_usd / Math.max(overview.settings.monthly_cap_usd, 0.0001));
  const maxDay = Math.max(0.0001, ...overview.daily.map((d) => d.cost_usd));

  async function patch(path: string, body: unknown) {
    await request(path, { method: "PATCH", body: JSON.stringify(body) });
    await load();
  }

  return (
    <div className="wide md:px-8">
      <p className="type-label">{t("label")}</p>
      <h1 className="type-hero mt-5">
        {t("title", { spend: usd(overview.month_spend_usd), cap: usd(overview.settings.monthly_cap_usd) })}
      </h1>

      <div className="mt-6 max-w-[688px]">
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-surface"
          role="meter"
          aria-label={t("capLabel")}
          aria-valuemin={0}
          aria-valuemax={overview.settings.monthly_cap_usd}
          aria-valuenow={overview.month_spend_usd}
        >
          <div className={cn("h-full", share >= 1 ? "bg-fail" : "bg-ink")} style={{ width: `${Math.max(share * 100, 0.5)}%` }} />
        </div>
      </div>

      <div className="mt-12 grid gap-14 lg:grid-cols-2">
        <section>
          <h2 className="type-label">{t("killSwitch")}</h2>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <VerdictBadge verdict={overview.settings.kill_switch ? "fail" : "pass"}>
              {overview.settings.kill_switch ? t("on") : t("off")}
            </VerdictBadge>
            <button
              type="button"
              onClick={() => patch("/admin/settings", { kill_switch: !overview.settings.kill_switch })}
              className={pill({ variant: overview.settings.kill_switch ? "secondary" : "primary" })}
            >
              {overview.settings.kill_switch ? t("turnOff") : t("turnOn")}
            </button>
          </div>
          <p className="type-small mt-3 text-gray">{overview.settings.kill_switch ? t("killOn") : t("killOff")}</p>

          <h2 className="type-label mt-12">{t("settingsLabel")}</h2>
          <SettingsForm overview={overview} onSave={(body) => patch("/admin/settings", body)} />
        </section>

        <section>
          <dl>
            {(
              [
                ["users", overview.totals.users],
                ["organizations", overview.totals.organizations],
                ["inspections", overview.totals.inspections],
                ["analysesToday", overview.totals.analyses_today],
                ["analysesMonth", overview.totals.analyses_month],
                ["cachedMonth", overview.totals.cached_month],
              ] as const
            ).map(([key, value]) => (
              <div key={key} className="flex min-h-11 items-center justify-between border-t border-hairline py-2">
                <dt className="text-gray">{t(`totals.${key}`)}</dt>
                <dd className="font-mono text-[0.9375rem] text-ink">{value}</dd>
              </div>
            ))}
          </dl>
          <h2 className="type-label mt-10">{t("dailyLabel")}</h2>
          {overview.daily.length === 0 ? (
            <p className="type-small mt-3 text-gray">{t("noUsage")}</p>
          ) : (
            <ul className="mt-3">
              {overview.daily.map((d) => (
                <li key={d.date} className="grid grid-cols-[92px_1fr_96px] items-center gap-3 py-1">
                  <span className="font-mono text-[0.8125rem] text-gray">{d.date}</span>
                  <span className="h-1.5 rounded-full bg-ink" style={{ width: `${Math.max((d.cost_usd / maxDay) * 100, 1)}%` }} />
                  <span className={num}>{usd(d.cost_usd)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="mt-16">
        <h2 className="type-label">{t("usersLabel")}</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-[0.9375rem]">
            <thead>
              <tr>
                <th className={th}>{t("userColumns.user")}</th>
                <th className={th}>{t("userColumns.orgs")}</th>
                <th className={cn(th, "text-right")}>{t("userColumns.inspections")}</th>
                <th className={cn(th, "text-right")}>{t("userColumns.today")}</th>
                <th className={cn(th, "text-right")}>{t("userColumns.month")}</th>
                <th className={cn(th, "text-right")}>{t("userColumns.cost")}</th>
                <th className={th}>{t("userColumns.quota")}</th>
                <th className={th}>{t("userColumns.status")}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className={td}>
                    <span className="text-ink">{u.name ?? "—"}</span>
                    {u.is_demo === 1 && <span className="type-label ml-2">{t("demo")}</span>}
                    <span className="type-small block text-gray">{u.email ?? u.id}</span>
                  </td>
                  <td className={cn(td, "type-small text-gray")}>{u.organizations ?? "—"}</td>
                  <td className={cn(td, num)}>{u.inspections}</td>
                  <td className={cn(td, num)}>{u.analyses_today}</td>
                  <td className={cn(td, num)}>{u.analyses_month}</td>
                  <td className={cn(td, num)}>{usd(u.month_cost_usd)}</td>
                  <td className={td}>
                    <QuotaInput
                      key={`${u.id}:${u.daily_analysis_quota}`}
                      value={u.daily_analysis_quota}
                      placeholder={`${overview.settings.default_daily_quota} (${t("default")})`}
                      onSave={(value) => patch(`/admin/users/${encodeURIComponent(u.id)}`, { daily_analysis_quota: value })}
                    />
                  </td>
                  <td className={td}>
                    <button
                      type="button"
                      disabled={u.id === me?.user.id}
                      onClick={() => patch(`/admin/users/${encodeURIComponent(u.id)}`, { blocked: u.blocked !== 1 })}
                      className={pill({ variant: "secondary" })}
                    >
                      {u.blocked === 1 ? t("unblock") : t("block")}
                    </button>
                    {u.blocked === 1 && <span className="type-small ml-2 text-fail">{t("blocked")}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-16">
        <h2 className="type-label">{t("orgsLabel")}</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-[0.9375rem]">
            <thead>
              <tr>
                <th className={th}>{t("orgColumns.name")}</th>
                <th className={th}>{t("orgColumns.type")}</th>
                <th className={cn(th, "text-right")}>{t("orgColumns.members")}</th>
                <th className={cn(th, "text-right")}>{t("orgColumns.inspections")}</th>
                <th className={cn(th, "text-right")}>{t("orgColumns.cost")}</th>
                <th className={th}>{t("orgColumns.quota")}</th>
              </tr>
            </thead>
            <tbody>
              {overview.organizations.map((o) => (
                <tr key={o.id}>
                  <td className={td}>
                    {o.name}
                    {o.is_demo === 1 && <span className="type-label ml-2">{t("demo")}</span>}
                  </td>
                  <td className={cn(td, "text-gray")}>{o.type}</td>
                  <td className={cn(td, num)}>{o.members}</td>
                  <td className={cn(td, num)}>{o.inspections}</td>
                  <td className={cn(td, num)}>{usd(o.month_cost_usd)}</td>
                  <td className={td}>
                    <QuotaInput
                      key={`${o.id}:${o.daily_analysis_quota}`}
                      value={o.daily_analysis_quota}
                      placeholder={`${overview.settings.default_daily_quota} (${t("default")})`}
                      onSave={(value) => patch(`/admin/orgs/${encodeURIComponent(o.id)}`, { daily_analysis_quota: value })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/** A daily quota cell: empty means "use the default"; saved on blur or Enter. Keyed by value, so a reload resets it. */
function QuotaInput({ value, placeholder, onSave }: { value: number | null; placeholder: string; onSave: (value: number | null) => Promise<void> }) {
  const [text, setText] = useState(value === null ? "" : String(value));
  const commit = () => {
    const next = text.trim() === "" ? null : Number(text);
    if (next !== null && (!Number.isInteger(next) || next < 0)) return setText(value === null ? "" : String(value));
    if (next !== value) void onSave(next);
  };
  return (
    <input
      inputMode="numeric"
      value={text}
      placeholder={placeholder}
      aria-label={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
      className="h-8 w-32 rounded-[4px] border border-control-border bg-white px-2 font-mono text-[0.875rem]"
    />
  );
}

function SettingsForm({ overview, onSave }: { overview: AdminOverview; onSave: (body: Record<string, number>) => Promise<void> }) {
  const t = useTranslations("Admin");
  const [cap, setCap] = useState(String(overview.settings.monthly_cap_usd));
  const [quota, setQuota] = useState(String(overview.settings.default_daily_quota));
  const [demo, setDemo] = useState(String(overview.settings.demo_shared_daily_quota));
  const [saved, setSaved] = useState(false);
  const field = "mt-1 h-10 w-full rounded-[4px] border border-control-border bg-white px-3 font-mono text-[0.9375rem]";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    await onSave({ monthly_cap_usd: Number(cap), default_daily_quota: Number(quota), demo_shared_daily_quota: Number(demo) });
    setSaved(true);
  }

  return (
    <form onSubmit={submit} className="mt-4 grid max-w-[420px] gap-3">
      <label className="type-small text-gray">
        {t("cap")}
        <input inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} className={field} />
      </label>
      <label className="type-small text-gray">
        {t("defaultQuota")}
        <input inputMode="numeric" value={quota} onChange={(e) => setQuota(e.target.value)} className={field} />
      </label>
      <label className="type-small text-gray">
        {t("demoQuota")}
        <input inputMode="numeric" value={demo} onChange={(e) => setDemo(e.target.value)} className={field} />
      </label>
      <div className="flex items-center gap-3">
        <button type="submit" className={pill({ variant: "secondary" })}>
          {t("save")}
        </button>
        {saved && (
          <span role="status" className="type-small text-pass">
            {t("saved")}
          </span>
        )}
      </div>
    </form>
  );
}
