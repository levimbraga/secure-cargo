"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { InspectionVerdict, truckOf, useDates, useInspectionTitle, useTruckLabel } from "@/components/app/inspection-bits";
import { useFailureLabel } from "@/components/app/manager-bits";
import { OrgShell } from "@/components/app/org-shell";
import { TruckArt } from "@/components/inspection/truck-art";
import { Link } from "@/i18n/navigation";
import { type OrgAlert, useAppApi } from "@/lib/app-api";

export function OrgAlertsPage() {
  return <OrgShell>{() => <OrgAlerts />}</OrgShell>;
}

/** `/app/org/alerts`: failed or out of compliance, with no proven fix after the organization's N hours. */
function OrgAlerts() {
  const t = useTranslations("Manager.alerts");
  const titleOf = useInspectionTitle();
  const m = useTranslations("Manager");
  const failures = useFailureLabel();
  const request = useAppApi();
  const dates = useDates();
  const truck = useTruckLabel();
  const [data, setData] = useState<{ alert_after_hours: number; alerts: OrgAlert[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    request<{ alert_after_hours: number; alerts: OrgAlert[] }>("/org/alerts")
      .then((value) => !cancelled && setData(value))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [request]);

  if (!data) return <p className="type-small text-gray">{m("loading")}</p>;
  const hours = data.alert_after_hours;
  return (
    <>
      <h1 className="type-hero text-balance">{t("title")}</h1>
      <p className="type-body mt-4 max-w-[688px]">{t("sentence", { hours })}</p>
      <p className="type-small mt-2 text-gray">
        <Link href="/app/org/team" className="underline decoration-1 underline-offset-4 hover:text-ink">
          {t("changeN")}
        </Link>
      </p>
      {data.alerts.length === 0 ? (
        <p className="type-body mt-10 text-gray">{t("none", { hours })}</p>
      ) : (
        <ul className="mt-10 border-b border-hairline" data-testid="alert-list">
          {data.alerts.map((alert) => {
            const choice = truckOf(alert);
            return (
              <li key={alert.id} className="border-t border-hairline">
                <Link href={`/app/inspection?id=${alert.id}`} className="grid gap-x-6 gap-y-2 py-4 hover:bg-surface/40 md:grid-cols-[140px_1fr_auto] md:items-center">
                  <span className="font-mono text-[0.875rem] text-fail">
                    {alert.hours_open >= 48 ? t("openDays", { days: Math.floor(alert.hours_open / 24) }) : t("open", { hours: alert.hours_open })}
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-[450] text-ink">{titleOf(alert.title)}</span>
                      {choice && <TruckArt size={choice.size} style={choice.style} className="h-4 w-auto shrink-0 text-gray" />}
                    </span>
                    <span className="type-small mt-0.5 block text-gray">
                      {alert.author_name ?? "—"} · {dates.short(alert.created_at)} · {truck(alert.truck_body, alert.truck_size, alert.truck_json)}
                    </span>
                    <span className="type-small mt-1 block text-ink">
                      {alert.failure_codes.slice(0, 3).map(failures).join(" · ")}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2 md:justify-end">
                    <InspectionVerdict inspection={alert} />
                    {alert.fixed_verdict !== "pass" && <span className="type-small text-gray">{t("noFixYet")}</span>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
