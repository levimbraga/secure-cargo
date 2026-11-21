"use client";

import { useFormatter, useTranslations } from "next-intl";

import { VerdictBadge } from "@/components/ui/verdict-badge";
import { Link } from "@/i18n/navigation";
import { type InspectionSummary, usePhotoSrc, type Verdict } from "@/lib/app-api";

export function badgeVerdict(verdict: Verdict | null): "pass" | "fail" | "neutral" {
  if (verdict === "pass") return "pass";
  if (verdict === "fail" || verdict === "warning") return "fail";
  return "neutral";
}

/** "Fails" / "Passes", plus "fixed: passes" when a fix was proven. */
export function InspectionVerdict({ inspection }: { inspection: Pick<InspectionSummary, "verdict" | "fixed_verdict"> }) {
  const t = useTranslations("Inspection");
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <VerdictBadge verdict={badgeVerdict(inspection.verdict)}>{t(`verdict.${inspection.verdict ?? "none"}`)}</VerdictBadge>
      {inspection.fixed_verdict === "pass" && <VerdictBadge verdict="pass">{t("fixedTo")}</VerdictBadge>}
    </span>
  );
}

export function useTruckLabel() {
  const t = useTranslations("Explorer.options");
  return (body: string | null, size: string | null) =>
    [body ? t(`body.${body}` as "body.flatbed") : null, size ? t(`size.${size}` as "size.toco") : null].filter(Boolean).join(" · ");
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
          <span className="block truncate font-[450] text-ink">{inspection.title || t("untitled")}</span>
          <span className="type-small mt-0.5 block truncate text-gray">
            {dates.short(inspection.created_at)} · {truck(inspection.truck_body, inspection.truck_size)}
          </span>
          <span className="mt-1.5 block">
            <InspectionVerdict inspection={inspection} />
          </span>
        </span>
      </Link>
    </li>
  );
}
