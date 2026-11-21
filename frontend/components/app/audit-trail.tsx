"use client";

import { cn } from "cn";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { type Audit, type DraftEdit, useAppApi } from "@/lib/app-api";

/** The analysis' restraint kinds, named with the explorer's securing options. */
const RESTRAINT_OF_KIND: Record<string, string> = {
  strap: "top_over",
  chain: "chain",
  rope: "rope",
  anti_slip_mat: "mat",
  blocking: "blocking",
  coil_cradle: "cradle",
};

const unitName = (id: unknown) => String(id ?? "").replace(/[-_]/g, " ");

/**
 * An inspection's audit trail: the AI's reading beside the load the driver confirmed, the driver's
 * edits to it, and every step with who did it and when (`GET /inspections/:id/audit`).
 */
export function AuditTrail({ inspectionId }: { inspectionId: string }) {
  const t = useTranslations("Audit");
  const options = useTranslations("Explorer.options");
  const driver = useTranslations("Driver");
  const format = useFormatter();
  const request = useAppApi();
  const [audit, setAudit] = useState<Audit | null>(null);

  useEffect(() => {
    let cancelled = false;
    request<Audit>(`/inspections/${encodeURIComponent(inspectionId)}/audit`)
      .then((value) => !cancelled && setAudit(value))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [inspectionId, request]);

  if (!audit) return null;

  const option = (group: "size" | "body" | "cargo" | "restraint", value: unknown) => {
    const key = `${group}.${String(value)}`;
    return options.has(key as never) ? options(key as never) : String(value ?? "—");
  };
  const show = (field: string, value: unknown): string => {
    if (value === null || value === undefined || value === "unknown") return "—";
    switch (field) {
      case "truck_size":
        return driver.has(`sizes.${value}.name` as never) ? driver(`sizes.${value}.name` as never) : option("size", value);
      case "truck_body":
        return option("body", value);
      case "cargo":
        return (value as { cargo: string; n: number }[]).map((c) => `${c.n} × ${option("cargo", c.cargo)}`).join(", ") || "—";
      case "restraint":
        if (Array.isArray(value)) return [...new Set(value.map((k) => option("restraint", RESTRAINT_OF_KIND[k as string] ?? k)))].join(", ") || "—";
        return option("restraint", value);
      case "weight": {
        const w = value as { kg: number | null; source: string | null };
        const source = w.source && ["measured", "invoice", "estimated"].includes(w.source) ? t(`weightSource.${w.source as "measured"}`) : "";
        return w.kg ? t("weightBy", { kg: w.kg.toLocaleString(), source }) : "—";
      }
      default:
        return String(value);
    }
  };
  const edit = (e: DraftEdit): string => {
    const values = {
      unit: unitName(e.unit),
      cargo: option("cargo", e.cargo),
      from: e.code === "unit_cargo" ? option("cargo", e.from) : e.code === "restraint" ? option("restraint", e.from) : String(e.from ?? "—"),
      to: e.code === "unit_cargo" ? option("cargo", e.to) : e.code === "restraint" ? option("restraint", e.to) : String(e.to ?? "—"),
      distance: format.number(e.distance_m ?? 0, { maximumFractionDigits: 2 }),
      field: String(e.field ?? ""),
    };
    return t.has(`edit.${e.code}` as never) ? t(`edit.${e.code}` as never, values as never) : e.code;
  };
  const eventText = (kind: string, detail: Record<string, unknown>) => {
    const values = {
      position: String(detail.position ?? ""),
      passed: Number(detail.passed ?? 0),
      total: Number(detail.total ?? 0),
      changes: Number(detail.changes ?? 0),
      id: String(detail.certificate_id ?? ""),
    };
    return t.has(`events.${kind}` as never) ? t(`events.${kind}` as never, values as never) : kind;
  };

  return (
    <section className="mt-14" data-testid="audit-trail">
      <h2 className="type-label">{t("title")}</h2>
      <p className="type-small mt-2 text-gray">{t("sentence")}</p>

      <h3 className="mt-6 text-[0.9375rem] font-[450] text-ink">{t("reading")}</h3>
      {audit.reading ? (
        <>
          <p className="type-small mt-1 text-gray">{audit.reading.model === "sample" ? t("readingSample") : t("readingModel", { model: audit.reading.model ?? "—" })}</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-[0.9375rem]" data-testid="audit-reading">
              <thead>
                <tr>
                  <th className="type-label h-9 border-b border-hairline pr-3 text-left font-normal">{t("columns.field")}</th>
                  <th className="type-label h-9 border-b border-hairline px-3 text-left font-normal">{t("columns.ai")}</th>
                  <th className="type-label h-9 border-b border-hairline px-3 text-left font-normal">{t("columns.driver")}</th>
                </tr>
              </thead>
              <tbody>
                {audit.reading.rows.map((row) => (
                  <tr key={row.field}>
                    <td className="border-b border-hairline py-2.5 pr-3 text-gray">{t(`fields.${row.field as "units"}`)}</td>
                    <td className={cn("border-b border-hairline px-3 py-2.5", row.field === "weight" && "text-gray")}>
                      {row.field === "weight" ? t("notRead") : show(row.field, row.ai)}
                    </td>
                    <td className="border-b border-hairline px-3 py-2.5">
                      {show(row.field, row.driver)}
                      {row.changed && <span className="type-small ml-2 rounded-full bg-warn-tint px-2 py-0.5 text-warn">{t("changed")}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="type-small mt-2 text-gray">{t("noReading")}</p>
      )}

      {audit.reading && (
        <>
          <h3 className="mt-8 text-[0.9375rem] font-[450] text-ink">{t("edits")}</h3>
          {audit.edits && audit.edits.length > 0 ? (
            <ul className="mt-2 list-disc pl-5 text-[0.9375rem]" data-testid="audit-edits">
              {audit.edits.map((e, n) => (
                <li key={n}>{edit(e)}</li>
              ))}
            </ul>
          ) : (
            <p className="type-small mt-2 text-gray">{t("noEdits")}</p>
          )}
        </>
      )}

      <ol className="mt-8 border-l border-hairline pl-5" data-testid="audit-events">
        {audit.events.map((e) => {
          const changes = Array.isArray(e.detail.changes) ? (e.detail.changes as DraftEdit[]) : null;
          return (
            <li key={e.id} className="relative pb-4">
              <span className="absolute top-1.5 -left-[24.5px] size-2 rounded-full bg-gray" aria-hidden />
              <p className="text-[0.9375rem] text-ink">{eventText(e.kind, e.detail)}</p>
              <p className="type-small text-gray">
                {format.dateTime(new Date(e.at), { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} · {e.actor_name ?? t("system")}
              </p>
              {changes && changes.length > 0 && (
                <p className="type-small mt-1 text-gray">
                  {t("changesCount", { count: changes.length })}: {changes.slice(0, 4).map(edit).join("; ")}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
