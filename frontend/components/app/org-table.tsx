"use client";

import { cn } from "cn";
import { useFormatter, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { InspectionVerdict, useDates, useInspectionTitle, useTruckLabel } from "@/components/app/inspection-bits";
import { useFailureLabel } from "@/components/app/manager-bits";
import { useMe } from "@/components/app/me-provider";
import { OrgShell } from "@/components/app/org-shell";
import { pill } from "@/components/ui/pill";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { API_URL } from "@/lib/api";
import { type InspectionPage, type OrgView, useAppApi } from "@/lib/app-api";

const PAGE_SIZE = 25;
const KEYS = ["from", "to", "driver", "state", "truck", "cargo", "failure", "q"] as const;
type Key = (typeof KEYS)[number];
const STATES = ["open", "fails", "holds_noncompliant", "approved", "proven", "pending"] as const;
const SIZES = ["vuc", "three_quarter", "toco", "truck", "semi"] as const;
const CARGO = ["wood_pallet", "plastic_pallet", "crate", "drum", "steel_coil", "machine", "tall_cabinet", "sacks", "long_pipes", "stacked_boxes"] as const;
const FAILURES = [
  "unit_slid",
  "unit_hit_headboard",
  "headboard_overloaded",
  "unit_left_bed",
  "unit_tilted",
  "unit_rolled",
  "lashing_overloaded",
  "devices_allowed",
  "safety_factor",
  "four_terminals",
  "anchoring",
  "diagonals_for_gaps",
  "above_headboard",
  "axle",
  "payload",
  "gross",
  "height",
  "width",
  "overhang",
] as const;

export function OrgTablePage() {
  return <OrgShell>{() => <OrgTable />}</OrgShell>;
}

/** `/app/org/inspections`: every inspection, filtered, searched, paged and exported. Filters live in the URL. */
function OrgTable() {
  const t = useTranslations("Manager.table");
  const format = useFormatter();
  const titleOf = useInspectionTitle();
  const explorer = useTranslations("Explorer.options");
  const failureLabel = useFailureLabel();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const request = useAppApi();
  const { getToken } = useMe();
  const dates = useDates();
  const truck = useTruckLabel();
  const [data, setData] = useState<InspectionPage | null>(null);
  const [members, setMembers] = useState<OrgView["members"]>([]);
  const [exporting, setExporting] = useState(false);
  const [query, setQuery] = useState(params.get("q") ?? "");

  const filters = useMemo(() => Object.fromEntries(KEYS.map((k) => [k, params.get(k) ?? ""])) as Record<Key, string>, [params]);
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);
  const qs = useMemo(() => {
    const search = new URLSearchParams({ scope: "org" });
    for (const k of KEYS) if (filters[k]) search.set(k, filters[k]);
    return search;
  }, [filters]);

  useEffect(() => {
    let cancelled = false;
    const search = new URLSearchParams(qs);
    search.set("page", String(page));
    search.set("page_size", String(PAGE_SIZE));
    request<InspectionPage>(`/inspections?${search}`)
      .then((value) => !cancelled && setData(value))
      .catch(() => !cancelled && setData({ inspections: [], total: 0, page: 1, page_size: PAGE_SIZE }));
    return () => {
      cancelled = true;
    };
  }, [qs, page, request]);

  useEffect(() => {
    request<OrgView>("/org")
      .then((org) => setMembers(org.members))
      .catch(() => undefined);
  }, [request]);

  // Search as you type, a moment after the last key.
  useEffect(() => {
    if (query === (params.get("q") ?? "")) return;
    const timer = setTimeout(() => set({ q: query }), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the typed text starts a search
  }, [query]);

  function set(next: Partial<Record<Key | "page", string>>) {
    const search = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) search.set(k, v);
      else search.delete(k);
    }
    if (!("page" in next)) search.delete("page");
    router.replace(`${pathname}${search.size ? `?${search}` : ""}`, { scroll: false });
  }

  async function exportCsv() {
    setExporting(true);
    try {
      const token = await getToken();
      const response = await fetch(`${API_URL}/inspections/export.csv?${qs}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!response.ok) return;
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ?? "securecargo-inspections.csv";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setExporting(false);
    }
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const control = "mt-1 h-10 w-full rounded-[4px] border border-control-border bg-white px-2.5 text-[0.9375rem]";
  const th = "type-label h-10 border-b border-hairline px-3 text-left font-normal first:pl-0";
  const td = "border-b border-hairline px-3 py-3 align-middle first:pl-0";
  const active = KEYS.some((k) => filters[k]);

  return (
    <>
      <h1 className="type-hero">{t("title")}</h1>

      <section aria-label={t("filtersLabel")} className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <label className="type-small col-span-2 text-gray md:col-span-4 xl:col-span-8">
          <span className="sr-only">{t("search")}</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search")} className={cn(control, "mt-0 max-w-[420px]")} />
        </label>
        <label className="type-small text-gray">
          {t("from")}
          <input type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} className={control} />
        </label>
        <label className="type-small text-gray">
          {t("to")}
          <input type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} className={control} />
        </label>
        <Select label={t("driver")} value={filters.driver} onChange={(v) => set({ driver: v })} any={t("any")} options={members.map((m) => [m.userId, m.name ?? m.email ?? m.userId])} className={control} />
        <Select label={t("state")} value={filters.state} onChange={(v) => set({ state: v })} any={t("any")} options={STATES.map((s) => [s, t(`states.${s}`)])} className={control} />
        <Select label={t("truck")} value={filters.truck} onChange={(v) => set({ truck: v })} any={t("any")} options={SIZES.map((s) => [s, explorer(`size.${s}`)])} className={control} />
        <Select label={t("cargo")} value={filters.cargo} onChange={(v) => set({ cargo: v })} any={t("any")} options={CARGO.map((c) => [c, explorer(`cargo.${c}`)])} className={control} />
        <Select label={t("failure")} value={filters.failure} onChange={(v) => set({ failure: v })} any={t("any")} options={FAILURES.map((f) => [f, failureLabel(f)])} className={cn(control)} wide />
      </section>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p className="type-small text-gray" role="status" data-testid="table-total">
          {data ? t("results", { total: data.total }) : "…"}
          {active && (
            <button type="button" onClick={() => { setQuery(""); router.replace(pathname, { scroll: false }); }} className="ml-3 text-ink underline decoration-1 underline-offset-4">
              {t("clear")}
            </button>
          )}
        </p>
        <button type="button" onClick={exportCsv} disabled={exporting} className={pill({ variant: "secondary" })} data-testid="export-csv">
          {exporting ? t("exporting") : t("export")}
        </button>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[880px] border-collapse text-[0.9375rem]" data-testid="inspection-table">
          <thead>
            <tr>
              <th className={th}>{t("columns.date")}</th>
              <th className={th}>{t("columns.driver")}</th>
              <th className={th}>{t("columns.load")}</th>
              <th className={th}>{t("columns.truck")}</th>
              <th className={cn(th, "text-right")}>{t("columns.weight")}</th>
              <th className={th}>{t("columns.result")}</th>
              <th className={th}>{t("columns.failures")}</th>
            </tr>
          </thead>
          <tbody>
            {data?.inspections.map((row) => {
              const codes = (row.failure_codes ?? "").split(",").filter(Boolean);
              return (
                <tr key={row.id} className="cursor-pointer hover:bg-surface/40" onClick={() => router.push(`/app/inspection?id=${row.id}`)}>
                  <td className={cn(td, "font-mono text-[0.875rem] whitespace-nowrap")}>{dates.short(row.created_at)}</td>
                  <td className={td}>{row.author_name ?? "—"}</td>
                  <td className={td}>
                    <Link href={`/app/inspection?id=${row.id}`} className="font-[450] text-ink hover:underline" onClick={(e) => e.stopPropagation()}>
                      {titleOf(row.title) || "—"}
                    </Link>
                    {row.reinspection_of && <span className="type-small ml-2 text-gray">{t("reinspection")}</span>}
                  </td>
                  <td className={cn(td, "text-gray")}>{truck(row.truck_body, row.truck_size, row.truck_json)}</td>
                  <td className={cn(td, "text-right font-mono text-[0.875rem] whitespace-nowrap")}>{row.cargo_weight_kg ? `${format.number(row.cargo_weight_kg)} kg` : "—"}</td>
                  <td className={td}>
                    <InspectionVerdict inspection={row} />
                  </td>
                  <td className={cn(td, "type-small max-w-[260px] text-gray")}>
                    {codes.slice(0, 2).map(failureLabel).join(" · ")}
                    {codes.length > 2 ? ` +${codes.length - 2}` : ""}
                  </td>
                </tr>
              );
            })}
            {data && data.inspections.length === 0 && (
              <tr>
                <td colSpan={7} className={cn(td, "text-gray")} data-testid="table-empty">
                  {Object.values(filters).some(Boolean) ? t("emptyFiltered") : t("empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {data && pages > 1 && (
        <nav className="mt-6 flex items-center gap-3" aria-label={t("page", { page, pages })}>
          <button type="button" disabled={page <= 1} onClick={() => set({ page: String(page - 1) })} className={pill({ variant: "secondary" })}>
            {t("prev")}
          </button>
          <span className="type-small text-gray">{t("page", { page, pages })}</span>
          <button type="button" disabled={page >= pages} onClick={() => set({ page: String(page + 1) })} className={pill({ variant: "secondary" })}>
            {t("next")}
          </button>
        </nav>
      )}
    </>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  any,
  className,
  wide,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
  any: string;
  className: string;
  wide?: boolean;
}) {
  return (
    <label className={cn("type-small text-gray", wide && "col-span-2")}>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className={className}>
        <option value="">{any}</option>
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}
