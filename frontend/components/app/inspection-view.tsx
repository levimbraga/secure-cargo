"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { badgeVerdict, InspectionVerdict, useDates, useTruckLabel } from "@/components/app/inspection-bits";
import { useMe } from "@/components/app/me-provider";
import { DataRow } from "@/components/ui/data-row";
import { pill } from "@/components/ui/pill";
import { VerdictBadge } from "@/components/ui/verdict-badge";
import { Link } from "@/i18n/navigation";
import { AppApiError, type InspectionDetail, photoUrl, useAppApi } from "@/lib/app-api";
import { encodeDraft, type LoadDraft } from "@/lib/explorer/draft";

/** The inspection named by `?id=`. */
export function InspectionFromQuery() {
  const id = useSearchParams().get("id") ?? "";
  return <InspectionView key={id} id={id} />;
}

/** One saved inspection: what was loaded, how it did, the fix, and links into the editor, replay and lab. */
export function InspectionView({ id }: { id: string }) {
  const t = useTranslations("Inspection");
  const { signedIn, ready } = useMe();
  const request = useAppApi();
  const dates = useDates();
  const truck = useTruckLabel();
  const [inspection, setInspection] = useState<InspectionDetail | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    request<InspectionDetail>(`/inspections/${encodeURIComponent(id)}`)
      .then((value) => !cancelled && setInspection(value))
      .catch((error: unknown) => {
        if (!cancelled && error instanceof AppApiError) setMissing(true);
      });
    return () => {
      cancelled = true;
    };
  }, [id, signedIn, request]);

  if (ready && !signedIn) return <p className="type-body">{t("notFound")}</p>;
  if (missing) return <p className="type-body">{t("notFound")}</p>;
  if (!inspection) return <p className="type-small text-gray">…</p>;

  const photo = photoUrl(inspection.photos[0]?.r2_key ?? null);
  const fix = inspection.fixes[0];
  const sections = inspection.scenarios.map((scenario) => ({
    scenario,
    result: inspection.results.find((r) => r.scenario_id === scenario.id),
  }));

  return (
    <>
      <Link href="/app" className="type-small text-gray hover:text-ink">
        ← {t("back")}
      </Link>
      <p className="type-label mt-8">{t("label")}</p>
      <h1 className="type-hero mt-5 text-balance">{inspection.title || t("untitled")}</h1>
      <div className="mt-4">
        <InspectionVerdict inspection={inspection} />
      </div>

      {photo && (
        // eslint-disable-next-line @next/next/no-img-element -- sample photograph, already processed
        <img src={photo} alt="" className="mt-10 aspect-[2.35/1] w-full rounded-[4px] object-cover grayscale" />
      )}

      <dl className="mt-10 border-b border-hairline">
        <DataRow label={t("rows.author")}>{inspection.author_name ?? "—"}</DataRow>
        {inspection.org_name && <DataRow label={t("rows.organization")}>{inspection.org_name}</DataRow>}
        <DataRow label={t("rows.created")}>{dates.long(inspection.created_at)}</DataRow>
        <DataRow label={t("rows.truck")}>{truck(inspection.truck_body, inspection.truck_size) || "—"}</DataRow>
        <DataRow label={t("rows.weight")}>
          {inspection.cargo_weight_kg ? t("weightKg", { weight: inspection.cargo_weight_kg.toLocaleString() }) : "—"}
        </DataRow>
        <DataRow label={t("rows.status")}>{t(`status.${inspection.status}`)}</DataRow>
        {inspection.situations_total !== null && (
          <DataRow label={t("rows.situations")}>
            {t("situations", { passed: inspection.situations_passed ?? 0, total: inspection.situations_total })}
          </DataRow>
        )}
      </dl>

      {sections.map(({ scenario, result }) => {
        const gallery = result?.metrics.gallery;
        const variant = result?.metrics.variant ?? "as_loaded";
        return (
          <section key={scenario.id} className="mt-14">
            <h2 className="type-label">{scenario.kind === "fixed" ? t("fixed") : t("asLoaded")}</h2>
            {result && (
              <div className="mt-3">
                <VerdictBadge verdict={badgeVerdict(result.verdict)}>{t(`verdict.${result.verdict}`)}</VerdictBadge>
              </div>
            )}
            {scenario.kind === "fixed" && fix && (
              <>
                <p className="type-body mt-4">{fix.passes ? t("fixPasses") : t("fixFails")}</p>
                {fix.changes.length > 0 && (
                  <ul className="type-small mt-3 list-disc pl-5 text-gray">
                    {fix.changes.map((change, n) => (
                      <li key={n}>
                        {change.field === "straps"
                          ? t("change.straps", { unit: change.unit ?? "", from: String(change.from), to: String(change.to) })
                          : change.field === "restraint"
                            ? t("change.restraint", { from: String(change.from), to: String(change.to) })
                            : t("change.units", { from: String(change.from), to: String(change.to) })}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                href={`/app/explorer#draft=${encodeDraft(scenario.draft as LoadDraft)}`}
                className={pill({ variant: "secondary", className: "max-sm:h-11" })}
              >
                {t("openEditor")}
              </Link>
              {gallery && (
                <>
                  <Link href={`/app/scenarios/${gallery}`} className={pill({ variant: "secondary", className: "max-sm:h-11" })}>
                    {t("openReplay")}
                  </Link>
                  <Link
                    href={`/app/lab/${gallery}?variant=${variant}`}
                    className={pill({ variant: "secondary", className: "max-sm:h-11" })}
                  >
                    {t("openLab")}
                  </Link>
                </>
              )}
            </div>
          </section>
        );
      })}
    </>
  );
}
