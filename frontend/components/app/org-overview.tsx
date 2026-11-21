"use client";

import { cn } from "cn";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { PHYSICAL_FAILURES as PHYSICAL, useFailureLabel } from "@/components/app/manager-bits";
import { OrgShell } from "@/components/app/org-shell";
import { pill } from "@/components/ui/pill";
import { Link } from "@/i18n/navigation";
import { type OrgOverview as Overview, useAppApi } from "@/lib/app-api";

const PERIODS = [7, 30, 90] as const;

export function OrgOverviewPage() {
  return <OrgShell>{(org) => <OrgOverview orgName={org.name} />}</OrgShell>;
}

/** `/app/org`: where the risk is in the fleet, in 30 seconds. */
function OrgOverview({ orgName }: { orgName: string }) {
  const t = useTranslations("Manager.overview");
  const m = useTranslations("Manager");
  const format = useFormatter();
  const request = useAppApi();
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [data, setData] = useState<Overview | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    request<Overview>(`/org/overview?days=${days}`)
      .then((value) => !cancelled && setData(value))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [days, request]);

  if (failed) return <p className="type-body">{m("loading")}</p>;
  if (!data) return <p className="type-small text-gray">{m("loading")}</p>;

  const { totals } = data;
  const pct = (value: number | null) => (value === null ? "—" : format.number(value, { style: "percent", maximumFractionDigits: 0 }));
  const share = (n: number) => (totals.simulated ? pct(n / totals.simulated) : "—");
  const hours = data.policies.alert_after_hours;

  return (
    <>
      <h1 className="type-hero text-balance">{t("title", { org: orgName })}</h1>
      <p className="type-body mt-4 max-w-[688px]" data-testid="overview-headline">
        {t("headline", { open: totals.failed_no_proven_fix })} {t("headlineAlerts", { count: totals.alerts, hours })}{" "}
        {totals.alerts > 0 && (
          <Link href="/app/org/alerts" className="text-ink underline decoration-1 underline-offset-4">
            {t("seeAlerts")}
          </Link>
        )}
      </p>

      <div className="mt-8 flex flex-wrap items-center gap-2" role="group" aria-label={t("period")}>
        {PERIODS.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={days === value}
            onClick={() => setDays(value)}
            className={pill({ variant: days === value ? "primary" : "secondary" })}
          >
            {t("days", { days: value })}
          </button>
        ))}
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-[6px] border border-hairline bg-hairline md:grid-cols-3 xl:grid-cols-6" data-testid="overview-tiles">
        <Tile label={t("tiles.inspections")} value={totals.inspections} note={totals.inspections - totals.simulated > 0 ? t("pending", { count: totals.inspections - totals.simulated }) : t("reinspections", { count: totals.reinspections })} />
        <Tile label={t("tiles.approved")} value={totals.approved} tone="pass" note={t("ofSimulated", { share: share(totals.approved) })} href="/app/org/inspections?state=approved" />
        <Tile label={t("tiles.holds_noncompliant")} value={totals.holds_noncompliant} tone="warn" note={t("ofSimulated", { share: share(totals.holds_noncompliant) })} href="/app/org/inspections?state=holds_noncompliant" />
        <Tile label={t("tiles.fails")} value={totals.fails} tone="fail" note={t("ofSimulated", { share: share(totals.fails) })} href="/app/org/inspections?state=fails" />
        <Tile
          label={t("tiles.proven")}
          value={pct(totals.fixed_and_proven_rate)}
          tone="pass"
          note={totals.needs_fix ? t("provenOf", { proven: totals.fixed_and_proven, total: totals.needs_fix }) : t("noneNeeded")}
          href="/app/org/inspections?state=proven"
        />
        <Tile label={t("tiles.noFix")} value={totals.failed_no_proven_fix} tone={totals.failed_no_proven_fix ? "fail" : undefined} note={m("alerts.badge", { count: totals.alerts })} href="/app/org/inspections?state=open" />
      </dl>

      <div className="mt-14 grid gap-14 lg:grid-cols-[3fr_2fr]">
        <section>
          <h2 className="type-label">{t("trend")}</h2>
          <p className="type-small mt-2 text-gray">{t("trendSentence")}</p>
          <WeeklyTrend weeks={data.weeks} />
        </section>
        <section>
          <h2 className="type-label">{t("failures")}</h2>
          <p className="type-small mt-2 text-gray">{t("failuresSentence")}</p>
          <FailureBars failures={data.failures} />
        </section>
      </div>

      <section className="mt-14">
        <h2 className="type-label">{t("drivers")}</h2>
        <DriverTable drivers={data.drivers} />
      </section>

      <p className="type-small mt-10 max-w-[688px] text-gray">{t("definitions")}</p>
    </>
  );
}

function Tile({ label, value, note, tone, href }: { label: string; value: number | string; note?: string; tone?: "pass" | "warn" | "fail"; href?: string }) {
  // A <dl> may only hold <div> groups of <dt>/<dd>: a linked tile is a div with a link stretched over it.
  return (
    <div className={cn("relative bg-paper p-4", href && "hover:bg-surface/50")}>
      <dt className="type-small text-gray">
        {href ? (
          <Link href={href} className="after:absolute after:inset-0">
            {label}
          </Link>
        ) : (
          label
        )}
      </dt>
      <dd className={cn("mt-2 font-mono text-[1.75rem] leading-none", tone === "pass" && "text-pass", tone === "warn" && "text-warn", tone === "fail" && "text-fail")}>{value}</dd>
      {note && <dd className="type-small mt-2 text-gray">{note}</dd>}
    </div>
  );
}

/** Stacked bars, one per week: approved, out of compliance, fails, not simulated. */
function WeeklyTrend({ weeks }: { weeks: Overview["weeks"] }) {
  const t = useTranslations("Manager.overview");
  const states = useTranslations("Manager.table.states");
  const format = useFormatter();
  const max = Math.max(1, ...weeks.map((w) => w.approved + w.holds_noncompliant + w.fails + w.pending));
  const width = 560;
  const height = 180;
  const gap = 8;
  const bar = (width - gap * (weeks.length - 1)) / Math.max(1, weeks.length);
  const scale = (n: number) => (n / max) * (height - 18); // room for the total above the tallest bar
  const layers = [
    { key: "approved", className: "fill-pass" },
    { key: "holds_noncompliant", className: "fill-amber" },
    { key: "fails", className: "fill-fail" },
    { key: "pending", className: "fill-hairline" },
  ] as const;
  return (
    <figure className="mt-5">
      <svg viewBox={`0 0 ${width} ${height + 28}`} className="w-full" role="img" aria-label={t("trend")} data-testid="weekly-trend">
        <line x1={0} x2={width} y1={height} y2={height} className="stroke-hairline" />
        {weeks.map((week, n) => {
          let y = height;
          const x = n * (bar + gap);
          const label = format.dateTime(new Date(`${week.week}T12:00:00Z`), { day: "2-digit", month: "short" });
          const total = week.approved + week.holds_noncompliant + week.fails + week.pending;
          return (
            <g key={week.week}>
              <title>
                {t("week", { date: label })}: {layers.map((l) => `${states(l.key === "holds_noncompliant" ? "holds_noncompliant" : l.key)} ${week[l.key]}`).join(" · ")}
              </title>
              {layers.map((layer) => {
                const h = scale(week[layer.key]);
                y -= h;
                return h > 0 ? <rect key={layer.key} x={x} y={y} width={bar} height={h} className={layer.className} /> : null;
              })}
              {total > 0 && (
                <text x={x + bar / 2} y={y - 4} textAnchor="middle" className="fill-gray font-mono text-[11px]">
                  {total}
                </text>
              )}
              <text x={x + bar / 2} y={height + 18} textAnchor="middle" className="fill-gray text-[11px]">
                {label}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="type-small mt-2 flex flex-wrap gap-x-4 gap-y-1 text-gray">
        {layers.map((layer) => (
          <span key={layer.key} className="inline-flex items-center gap-1.5">
            <svg width="10" height="10" aria-hidden>
              <rect width="10" height="10" className={layer.className} />
            </svg>
            {states(layer.key)}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

function FailureBars({ failures }: { failures: Overview["failures"] }) {
  const t = useTranslations("Manager.overview");
  const label = useFailureLabel();
  const format = useFormatter();
  if (failures.length === 0) return <p className="type-body mt-5 text-gray">{t("noFailures")}</p>;
  return (
    <ol className="mt-5 space-y-3" data-testid="failure-bars">
      {failures.slice(0, 8).map((f) => (
        <li key={f.code}>
          <Link href={`/app/org/inspections?failure=${f.code}`} className="group block">
            <span className="flex items-baseline justify-between gap-3 text-[0.9375rem]">
              <span className="text-ink group-hover:underline">
                {label(f.code)}
                <span className="type-small ml-2 text-gray">{PHYSICAL.has(f.code) ? t("physics") : t("rule")}</span>
              </span>
              <span className="font-mono text-[0.875rem] text-gray">
                {f.inspections} · {format.number(f.share, { style: "percent", maximumFractionDigits: 0 })}
              </span>
            </span>
            <span className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-surface">
              <span className={cn("block h-full rounded-full", PHYSICAL.has(f.code) ? "bg-fail" : "bg-amber")} style={{ width: `${Math.max(2, f.share * 100)}%` }} />
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

const th = "type-label h-10 border-b border-hairline px-3 text-left font-normal first:pl-0";
const td = "border-b border-hairline px-3 py-3 align-middle first:pl-0";
const num = "text-right font-mono text-[0.875rem]";

function DriverTable({ drivers }: { drivers: Overview["drivers"] }) {
  const t = useTranslations("Manager.overview.driverColumns");
  const format = useFormatter();
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-[0.9375rem]" data-testid="driver-table">
        <thead>
          <tr>
            <th className={th}>{t("driver")}</th>
            <th className={cn(th, "text-right")}>{t("inspections")}</th>
            <th className={th}>{t("failureRate")}</th>
            <th className={cn(th, "text-right")}>{t("proven")}</th>
            <th className={cn(th, "text-right")}>{t("open")}</th>
          </tr>
        </thead>
        <tbody>
          {drivers.map((d) => (
            <tr key={d.user_id}>
              <td className={td}>
                <Link href={`/app/org/inspections?driver=${encodeURIComponent(d.user_id)}`} className="text-ink hover:underline">
                  {d.name ?? "—"}
                </Link>
              </td>
              <td className={cn(td, num)}>{d.inspections}</td>
              <td className={td}>
                <span className="flex items-center gap-3">
                  <span className="h-1.5 w-24 overflow-hidden rounded-full bg-surface">
                    <span className="block h-full rounded-full bg-fail" style={{ width: `${(d.failure_rate ?? 0) * 100}%` }} />
                  </span>
                  <span className="font-mono text-[0.875rem]">
                    {d.failure_rate === null ? "—" : format.number(d.failure_rate, { style: "percent", maximumFractionDigits: 0 })}
                  </span>
                </span>
              </td>
              <td className={cn(td, num, "text-pass")}>{d.fixes_proven}</td>
              <td className={cn(td, num)}>
                {d.open > 0 ? (
                  <Link href={`/app/org/inspections?driver=${encodeURIComponent(d.user_id)}&state=open`} className="text-fail hover:underline">
                    {d.open}
                  </Link>
                ) : (
                  <span className="text-gray">0</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
