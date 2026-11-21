"use client";

/**
 * The public summary of a shared inspection: the verdict in its three states, the photo, the
 * truck and the main checks. No sign-in; the driver's name only when the organization allows it.
 */

import { useFormatter, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { StateBadge } from "@/components/inspection/result-view";
import { TruckArt } from "@/components/inspection/truck-art";
import { pill } from "@/components/ui/pill";
import { Link } from "@/i18n/navigation";
import { API_URL } from "@/lib/api";
import { choiceOf } from "@/lib/inspection/trucks";
import type { Battery } from "@/lib/inspection/types";
import { physicsPassed, stateOfStored, verdictOf } from "@/lib/inspection/verdict";

type Summary = {
  title: string;
  created_at: string;
  verdict: "pass" | "warning" | "fail" | null;
  situations_passed: number | null;
  situations_total: number | null;
  truck_json: string | null;
  truck_body: string | null;
  truck_size: string | null;
  cargo_weight_kg: number | null;
  weight_source: "measured" | "invoice" | "estimated" | null;
  driver_name: string | null;
  org_name: string | null;
  proven_by: string | null;
  photo: { path: string } | null;
  checks: Pick<Battery, "situations" | "contran_945" | "checklist" | "axle_loads"> | null;
};

export function SharedInspectionFromQuery() {
  const token = useSearchParams().get("t") ?? "";
  return <SharedInspection key={token} token={token} />;
}

function SharedInspection({ token }: { token: string }) {
  const t = useTranslations("Driver.shared");
  const names = useTranslations("Driver");
  const flow = useTranslations("Flow");
  const format = useFormatter();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/share/${encodeURIComponent(token)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as Summary;
        if (!cancelled) setSummary(body);
      })
      .catch(() => !cancelled && setMissing(true));
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (missing || !token) return <p className="type-body" data-testid="shared-missing">{t("notFound")}</p>;
  if (!summary) return <p className="type-small text-gray">{t("loading")}</p>;

  const checks = summary.checks;
  const state = checks ? verdictOf(checks as never).state : stateOfStored(summary.verdict) ?? "fails";
  const truck = choiceOf(summary.truck_json ? JSON.parse(summary.truck_json) : { body: summary.truck_body, size: summary.truck_size });
  const photo = summary.photo ? (summary.photo.path.startsWith("/share/") ? `${API_URL}${summary.photo.path}` : summary.photo.path) : null;
  const contranFails = checks?.contran_945.filter((c) => c.status === "fail").length ?? 0;
  const weightFails = (checks?.checklist?.weight ?? []).some((i) => i.kind === "rule" && i.status === "fail");

  return (
    <article data-testid="shared-inspection" data-state={state}>
      <p className="type-label">{t("label")}</p>
      <h1 className="type-hero mt-4 text-balance">{summary.title || flow("steps.result")}</h1>
      <p className="type-small mt-2 text-gray">
        {format.dateTime(new Date(summary.created_at), { day: "2-digit", month: "short", year: "numeric" })}
        {summary.org_name ? ` · ${summary.org_name}` : ""}
        {summary.driver_name ? ` · ${t("by", { name: summary.driver_name })}` : ""}
      </p>
      <div className="mt-6">
        <StateBadge state={state} />
        <p className="type-card-title mt-3">{names(`verdict.${state}.title`)}</p>
        {summary.proven_by && <p className="type-small mt-2 text-pass">{names("verdict.proven")}</p>}
      </div>
      {photo && (
        // eslint-disable-next-line @next/next/no-img-element -- the shared inspection's photo
        <img src={photo} alt="" className="mt-8 aspect-[16/9] w-full max-w-2xl rounded object-cover" />
      )}
      {truck && (
        <div className="mt-6 flex items-center gap-3">
          <TruckArt size={truck.size} style={truck.style} className="h-10 w-auto" />
          <span className="text-ink">{names("truck.name", { size: names(`sizes.${truck.size}.name`), body: names(`styles.${truck.style}.short`) })}</span>
        </div>
      )}
      <h2 className="type-label mt-10">{t("checks")}</h2>
      <ul className="mt-2 border-b border-hairline text-ink">
        {checks && (
          <li className="border-t border-hairline py-3">{t("situations", { passed: physicsPassed(checks as never), total: checks.situations.length })}</li>
        )}
        {checks && <li className="border-t border-hairline py-3">{contranFails ? t("contranFails", { count: contranFails }) : t("contranOk")}</li>}
        {checks && <li className="border-t border-hairline py-3">{weightFails ? t("weightFails") : t("weightOk")}</li>}
        {summary.weight_source === "estimated" && <li className="border-t border-hairline py-3 text-warn">{t("estimated")}</li>}
      </ul>
      <p className="type-small mt-8 text-gray">{t("disclaimer")}</p>
      <Link href="/app/new" className={pill({ className: "mt-6 h-12 px-5" })}>
        {t("try")}
      </Link>
    </article>
  );
}
