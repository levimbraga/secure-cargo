"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { InspectionVerdict, useDates, useTruckLabel } from "@/components/app/inspection-bits";
import { useMe } from "@/components/app/me-provider";
import { ResultView } from "@/components/inspection/result-view";
import { DataRow } from "@/components/ui/data-row";
import { pill } from "@/components/ui/pill";
import { Link } from "@/i18n/navigation";
import { AppApiError, type InspectionDetail, usePhotoSrc, useAppApi } from "@/lib/app-api";
import { encodeDraft, type LoadDraft } from "@/lib/explorer/draft";
import type { Battery, Change, Plan } from "@/lib/inspection/types";

/** The inspection named by `?id=`. */
export function InspectionFromQuery() {
  const id = useSearchParams().get("id") ?? "";
  return <InspectionView key={id} id={id} />;
}

type Results = { asLoaded: Battery | null; plan: Plan | null };

/**
 * One saved inspection: its photos, what was loaded, the battery of seven situations with the
 * worst one first, the checks and the fix, read only. Opens the load in the editor too.
 */
export function InspectionView({ id }: { id: string }) {
  const t = useTranslations("Inspection");
  const { signedIn, ready } = useMe();
  const request = useAppApi();
  const dates = useDates();
  const truck = useTruckLabel();
  const [inspection, setInspection] = useState<InspectionDetail | null>(null);
  const [results, setResults] = useState<Results | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    request<InspectionDetail>(`/inspections/${encodeURIComponent(id)}`)
      .then(async (value) => {
        if (cancelled) return;
        setInspection(value);
        // Batteries are stored whole: in the private bucket, or on the site for the seeded demo.
        const read = async (kind: "as_loaded" | "fixed"): Promise<Battery | null> => {
          const scenario = value.scenarios.find((s) => s.kind === kind);
          if (!scenario?.battery_ref) return null;
          if (scenario.battery_ref.startsWith("static:")) {
            const response = await fetch(scenario.battery_ref.slice("static:".length));
            return response.ok ? ((await response.json()) as Battery) : null;
          }
          return request<Battery>(`/inspections/${encodeURIComponent(id)}/battery/${kind}`).catch(() => null);
        };
        const [asLoaded, fixed] = await Promise.all([read("as_loaded"), read("fixed")]);
        const fix = value.fixes[0];
        const fixedScenario = value.scenarios.find((s) => s.kind === "fixed");
        const plan: Plan | null =
          fixed && fixedScenario
            ? {
                draft: fixedScenario.draft as LoadDraft,
                changes: (fix?.changes ?? []).filter((c): c is Change => "code" in c),
                verified: fix?.passes ?? false,
                rounds: 0,
                battery: fixed,
              }
            : null;
        if (!cancelled) setResults({ asLoaded, plan });
      })
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

  const loaded = inspection.scenarios.find((s) => s.kind === "as_loaded");
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

      {inspection.photos.length > 0 && (
        <ul className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="inspection-photos">
          {inspection.photos.map((photo) => (
            <li key={photo.id}>
              <StoredPhoto inspectionId={inspection.id} photo={photo} />
            </li>
          ))}
        </ul>
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
        {inspection.notes && <DataRow label={t("rows.notes")}>{inspection.notes}</DataRow>}
      </dl>

      {loaded && (
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href={`/app/explorer#draft=${encodeDraft(loaded.draft as LoadDraft)}`}
            className={pill({ variant: "secondary", className: "h-11 px-4" })}
          >
            {t("openEditor")}
          </Link>
        </div>
      )}

      <div className="mt-14">
        {results === null ? (
          <p className="type-small text-gray">…</p>
        ) : results.asLoaded ? (
          <ResultView battery={results.asLoaded} plan={results.plan} readOnly />
        ) : (
          <p className="type-body text-gray">{t("notSimulated")}</p>
        )}
      </div>
    </>
  );
}

function StoredPhoto({ inspectionId, photo }: { inspectionId: string; photo: InspectionDetail["photos"][number] }) {
  const t = useTranslations("Inspection");
  const src = usePhotoSrc(inspectionId, photo.id, photo.r2_key);
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- a stored inspection photo (private or sample)
    <img src={src} alt={t("photo", { position: photo.position })} className="aspect-[4/3] w-full rounded object-cover" />
  ) : (
    <div className="aspect-[4/3] w-full rounded bg-surface" aria-hidden />
  );
}
