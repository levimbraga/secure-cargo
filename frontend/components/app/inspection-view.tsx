"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { AuditTrail } from "@/components/app/audit-trail";
import { CertificatePanel } from "@/components/app/certificate-panel";
import { InspectionVerdict, truckOf, useDates, useInspectionTitle, useTruckLabel } from "@/components/app/inspection-bits";
import { useMe } from "@/components/app/me-provider";
import { ResultView } from "@/components/inspection/result-view";
import { ShareButton } from "@/components/inspection/share";
import { verdictOf } from "@/lib/inspection/verdict";
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

type Results = { asLoaded: Battery | null; plan: Plan | null; before: Battery | null };

/**
 * One saved inspection: its photos, what was loaded, the battery of seven situations with the
 * worst one first, the checks and the fix, read only. Opens the load in the editor too.
 */
export function InspectionView({ id }: { id: string }) {
  const t = useTranslations("Inspection");
  const format = useFormatter();
  const titleOf = useInspectionTitle();
  const driver = useTranslations("Driver");
  const { signedIn, ready, me } = useMe();
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
            // `static:/path[#key]`: a file of the site, or one key of it (a sample's battery).
            const [path, key] = scenario.battery_ref.slice("static:".length).split("#");
            const response = await fetch(path as string);
            if (!response.ok) return null;
            const data = (await response.json()) as Record<string, unknown>;
            return (key ? (data[key] as Battery | undefined) ?? null : (data as unknown as Battery));
          }
          return request<Battery>(`/inspections/${encodeURIComponent(id)}/battery/${kind}`).catch(() => null);
        };
        const [asLoaded, fixed] = await Promise.all([read("as_loaded"), read("fixed")]);
        // A re-inspection shows the first inspection's result beside its own.
        const before = value.reinspection_of
          ? await request<Battery>(`/inspections/${encodeURIComponent(value.reinspection_of)}/battery/as_loaded`).catch(() => null)
          : null;
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
        if (!cancelled) setResults({ asLoaded, plan, before });
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
  const manager = Boolean(me && me.user.id !== inspection.author_id && (me.org?.role === "org_admin" || me.is_platform_admin));
  return (
    <>
      <Link href={manager ? "/app/org/inspections" : "/app"} className="type-small text-gray hover:text-ink">
        ← {t("back")}
      </Link>
      <p className="type-label mt-8">{t("label")}</p>
      <h1 className="type-hero mt-5 text-balance">{titleOf(inspection.title) || t("untitled")}</h1>
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
        <DataRow label={t("rows.truck")}>{truck(inspection.truck_body, inspection.truck_size, inspection.truck_json) || "—"}</DataRow>
        <DataRow label={t("rows.weight")}>
          {inspection.cargo_weight_kg ? t("weightKg", { weight: format.number(inspection.cargo_weight_kg) }) : "—"}
          {inspection.weight_source ? ` · ${t(`weightSource.${inspection.weight_source}`)}` : ""}
        </DataRow>
        <DataRow label={t("rows.status")}>{t(`status.${inspection.status}`)}</DataRow>
        {inspection.situations_total !== null && (
          <DataRow label={t("rows.situations")}>
            {t("situations", { passed: inspection.situations_passed ?? 0, total: inspection.situations_total })}
          </DataRow>
        )}
        {inspection.notes && <DataRow label={t("rows.notes")}>{inspection.notes}</DataRow>}
      </dl>

      {inspection.verdict && <CertificatePanel inspectionId={inspection.id} />}

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

      {(inspection.reinspection_of || (inspection.reinspections?.length ?? 0) > 0) && (
        <ul className="mt-6 space-y-1" data-testid="reinspection-links">
          {inspection.reinspection_of && (
            <li>
              <Link href={`/app/inspection?id=${inspection.reinspection_of}`} className="type-small text-ink underline decoration-1 underline-offset-4">
                {t("reinspectionOf")}
              </Link>
            </li>
          )}
          {inspection.reinspections?.map((child) => (
            <li key={child.id}>
              <Link href={`/app/inspection?id=${child.id}`} className="type-small text-ink underline decoration-1 underline-offset-4">
                {t("reinspection", { verdict: child.verdict ? driver(`verdict.${child.verdict === "pass" ? "approved" : child.verdict === "warning" ? "holds_noncompliant" : "fails"}.badge`) : "—" })}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-14">
        {results === null ? (
          <p className="type-small text-gray">…</p>
        ) : results.asLoaded ? (
          <ResultView
            battery={results.asLoaded}
            plan={results.plan}
            readOnly
            truck={truckOf(inspection)}
            weightSource={inspection.weight_source ?? null}
            range={inspection.weight_range_json ? JSON.parse(inspection.weight_range_json) : null}
            before={results.before}
            provenBy={
              inspection.proven_by ? (
                <Link href={`/app/inspection?id=${inspection.proven_by}`} className="type-small text-pass underline decoration-1 underline-offset-4" data-testid="proven-by">
                  {driver("verdict.proven")}
                </Link>
              ) : null
            }
            share={
              me && (inspection.author_id === me.user.id || me.org?.role === "org_admin") ? (
                <ShareButton
                  verdict={driver(`verdict.${verdictOf(results.asLoaded).state}.badge`)}
                  getUrl={async () => {
                    const { path } = await request<{ path: string }>(`/inspections/${encodeURIComponent(inspection.id)}/share`, { method: "POST" });
                    return `${window.location.origin}${document.documentElement.lang === "pt-BR" ? "/pt-BR" : ""}${path}`;
                  }}
                />
              ) : null
            }
          />
        ) : (
          <p className="type-body text-gray">{t("notSimulated")}</p>
        )}
      </div>
      {me && inspection.author_id === me.user.id && results?.asLoaded && verdictOf(results.asLoaded).state !== "approved" && !inspection.proven_by && (
        <Link href={`/app/new?reinspect=${inspection.id}`} className={pill({ className: "mt-8 h-12 px-5" })} data-testid="reinspect-link">
          {driver("fix.reinspect")}
        </Link>
      )}
      <AuditTrail inspectionId={inspection.id} />
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
