"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";

import { TruckArt } from "@/components/inspection/truck-art";
import { VerdictBadge } from "@/components/ui/verdict-badge";
import { Link } from "@/i18n/navigation";
import { type InspectionSummary, usePhotoSrc, type Verdict } from "@/lib/app-api";
import { localTitle } from "@/lib/demo-titles";
import { choiceOf, type TruckChoice } from "@/lib/inspection/trucks";

/** The stored verdict as a badge: pass (approved), warning (out of compliance), fail. */
export function badgeVerdict(verdict: Verdict | null): "pass" | "warn" | "fail" | "neutral" {
  if (verdict === "pass") return "pass";
  if (verdict === "warning") return "warn";
  if (verdict === "fail") return "fail";
  return "neutral";
}

/** The three states, plus "fixed and proven" (a new photo passed) or "fix simulated". */
export function InspectionVerdict({
  inspection,
}: {
  inspection: Pick<InspectionSummary, "verdict" | "fixed_verdict"> & { proven_by?: string | null };
}) {
  const t = useTranslations("Inspection");
  const driver = useTranslations("Driver.verdict");
  const state = inspection.verdict === "pass" ? "approved" : inspection.verdict === "warning" ? "holds_noncompliant" : inspection.verdict === "fail" ? "fails" : null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" data-verdict={inspection.verdict ?? "none"}>
      <VerdictBadge verdict={badgeVerdict(inspection.verdict)}>{state ? driver(`${state}.badge`) : t("verdict.none")}</VerdictBadge>
      {inspection.proven_by ? (
        <VerdictBadge verdict="pass">{driver("proven")}</VerdictBadge>
      ) : (
        inspection.fixed_verdict === "pass" && <VerdictBadge verdict="neutral">{t("fixedTo")}</VerdictBadge>
      )}
    </span>
  );
}

/** The truck of a list row: from its stored truck (size, body style), or the old columns. */
export function truckOf(inspection: Pick<InspectionSummary, "truck_body" | "truck_size"> & { truck_json?: string | null }): TruckChoice | null {
  try {
    if (inspection.truck_json) return choiceOf(JSON.parse(inspection.truck_json));
  } catch {
    // fall through to the columns
  }
  return choiceOf(inspection.truck_size ? { body: (inspection.truck_body ?? "flatbed") as "flatbed", size: inspection.truck_size as "toco" } : null);
}

/** An inspection's title in the page's language (the seeded demo titles are translated). */
export function useInspectionTitle() {
  const locale = useLocale();
  const titles = useTranslations("Scenario.titles");
  return (title: string | null | undefined): string | null => (title ? localTitle(title, locale, (id) => titles(id as never)) : null);
}

export function useTruckLabel() {
  const t = useTranslations("Driver");
  return (body: string | null, size: string | null, truckJson?: string | null) => {
    const truck = truckOf({ truck_body: body, truck_size: size, truck_json: truckJson });
    return truck ? t("truck.name", { size: t(`sizes.${truck.size}.name`), body: t(`styles.${truck.style}.short`) }) : "";
  };
}

export function useDates() {
  const format = useFormatter();
  return {
    short: (iso: string) => format.dateTime(new Date(iso), { day: "2-digit", month: "short" }),
    long: (iso: string) =>
      format.dateTime(new Date(iso), { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }),
  };
}

/** One inspection in a phone-first list: photo, title, date and truck, verdict. The row is the link. */
export function InspectionListItem({ inspection }: { inspection: InspectionSummary }) {
  const titleOf = useInspectionTitle();
  const t = useTranslations("Inspection");
  const dates = useDates();
  const truck = useTruckLabel();
  const photo = usePhotoSrc(inspection.id, inspection.cover_photo_id, inspection.cover_photo);
  return (
    <li className="border-t border-hairline">
      <Link href={`/app/inspection?id=${inspection.id}`} className="flex min-h-[76px] items-center gap-4 py-3 hover:bg-surface/40">
        <span className="size-14 shrink-0 overflow-hidden rounded-[4px] bg-surface">
          {photo && (
            // eslint-disable-next-line @next/next/no-img-element -- small sample thumbnails, already optimized
            <img src={photo} alt="" width={56} height={56} loading="lazy" className="size-full object-cover" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="block truncate font-[450] text-ink">{titleOf(inspection.title) || t("untitled")}</span>
            {truckOf(inspection) && (
              <TruckArt size={truckOf(inspection)!.size} style={truckOf(inspection)!.style} className="h-4 w-auto shrink-0 text-gray" />
            )}
          </span>
          <span className="type-small mt-0.5 block truncate text-gray">
            {dates.short(inspection.created_at)} · {truck(inspection.truck_body, inspection.truck_size, inspection.truck_json)}
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-2">
            <InspectionVerdict inspection={inspection} />
            {inspection.situations_total !== null && (
              <span className="type-small text-gray">
                {t("situations", { passed: inspection.situations_passed ?? 0, total: inspection.situations_total })}
              </span>
            )}
          </span>
        </span>
      </Link>
    </li>
  );
}
