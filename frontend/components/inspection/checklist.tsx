"use client";

/**
 * The checklist of an inspection, by theme: how the load is secured (CONTRAN 945; FMCSA 393 in
 * the US; Directive 2014/47/EU Annex III in the EU), weight and axles, the trip's physics (the
 * seven situations), protection, and dimensions. Every item: a mark, a plain explanation, the
 * article or standard, how to fix it and, in EU mode, the class a roadside check would give it.
 */

import { useFormatter, useTranslations } from "next-intl";
import { type ReactNode, useId, useState } from "react";

import { useReplayText } from "@/components/scenario/replay-shared";
import { pill } from "@/components/ui/pill";
import { useShownCountry, useShownUnits } from "@/components/units-context";
import type { Finding } from "@/lib/demo";
import { type Battery, SITUATION_IDS, type SituationResult } from "@/lib/inspection/types";
import { physicalFindings, situationMark } from "@/lib/inspection/verdict";

/** The battery's situations' speeds (`backend/app/inspection/battery.py`), for their names. */
export const SITUATION_SPEED_KMH: Record<SituationResult["id"], number> = {
  emergency_braking: 80,
  lane_change: 80,
  sharp_curve: 60,
  pothole: 60,
  speed_bump: 30,
  mountain_descent: 60,
  long_vibration: 60,
};

/** A situation's name, with its speed in the shown country's units ("at 50 mph"). */
export function useSituationName(): (id: SituationResult["id"]) => string {
  const flow = useTranslations("Flow");
  const units = useShownUnits();
  return (id) => flow(`situations.${id}.name` as never, { speed: units.speed(SITUATION_SPEED_KMH[id]) } as never);
}

const US_ONLY_IF_APPLICABLE = new Set(["van_contained", "rolling_articles", "metal_coils", "machinery", "rope_tiedowns"]);
const EU_ONLY_IF_APPLICABLE = new Set(["eu_tipping", "eu_headboard_height", "eu_body_strength", "eu_devices", "eu_lashing_points"]);
const EU_DIRECTIONS = new Set(["eu_forward", "eu_sideways", "eu_rearward"]);
// Standard gravity, as the backend (physics/constants.py): newtons to kilograms of force.
const G = 9.81;

/** The article as the page shows it: the older Brazilian checks carry only "Art. 4". */
function articleOf(article: string): string {
  return /^(CONTRAN|49 CFR|23 CFR|Directive|EN )/.test(article) ? article : `CONTRAN 945/2022, ${article}`;
}

export type Mark = "pass" | "fail" | "warn" | "na" | "advice";

export function MarkIcon({ mark }: { mark: Mark }) {
  const style =
    mark === "pass"
      ? "bg-pass text-white"
      : mark === "fail"
        ? "bg-fail text-white"
        : mark === "warn" || mark === "advice"
          ? "bg-warn-tint text-warn ring-1 ring-warn"
          : "bg-surface text-gray";
  const symbol = mark === "pass" ? "✓" : mark === "fail" ? "✕" : mark === "na" ? "–" : "!";
  return (
    <span aria-hidden className={`inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[0.8125rem] font-medium ${style}`}>
      {symbol}
    </span>
  );
}

function Item({
  mark,
  title,
  detail,
  article,
  fix,
  children,
  testId,
  deficiency = null,
}: {
  mark: Mark;
  title: ReactNode;
  detail?: ReactNode;
  article?: string | null;
  fix?: ReactNode;
  children?: ReactNode;
  testId?: string;
  /** EU: the class a roadside inspection would give this failure. */
  deficiency?: "minor" | "major" | "dangerous" | null;
}) {
  const t = useTranslations("Driver.checks");
  const roadside = useTranslations("Driver.roadside");
  return (
    <li className="flex items-start gap-3 border-t border-hairline py-3" data-check={testId} data-mark={mark} data-deficiency={deficiency ?? undefined}>
      <MarkIcon mark={mark} />
      <span className="min-w-0 flex-1">
        <span className="block text-ink">{title}</span>
        {deficiency && (
          <span className="type-small mt-1 block">
            <span
              className={`mr-2 inline-flex rounded-full px-2 py-0.5 text-[0.75rem] font-medium ${
                deficiency === "dangerous" ? "bg-fail text-white" : deficiency === "major" ? "bg-warn-tint text-warn ring-1 ring-warn" : "bg-surface text-ink"
              }`}
            >
              {roadside(deficiency)}
            </span>
            <span className="text-gray">{roadside(`${deficiency}Meaning`)}</span>
          </span>
        )}
        {detail && <span className="type-small mt-0.5 block text-gray">{detail}</span>}
        {fix && (mark === "fail" || mark === "warn" || mark === "advice") && (
          <span className="type-small mt-1 block text-ink">
            <span className="font-medium">{t("fixLabel")}</span> {fix}
          </span>
        )}
        {article && <span className="type-label mt-1 block">{article}</span>}
        {children}
      </span>
    </li>
  );
}

function Theme({ id, title, marks, children, open = false }: { id: string; title: string; marks: Mark[]; children: ReactNode; open?: boolean }) {
  const t = useTranslations("Driver.checks");
  const failing = marks.filter((m) => m === "fail").length;
  const warning = marks.filter((m) => m === "warn" || m === "advice").length;
  const summary: Mark = failing ? "fail" : warning ? "warn" : "pass";
  return (
    <details className="group border-b border-hairline" open={open} data-theme={id} data-summary={summary}>
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 py-3 [&::-webkit-details-marker]:hidden">
        <MarkIcon mark={summary} />
        <span className="min-w-0 flex-1">
          <span className="block font-[450] text-ink">{title}</span>
          <span className="type-small block text-gray">
            {failing ? t("themeFails", { count: failing }) : warning ? t("themeAdvice", { count: warning }) : t("themeOk")}
          </span>
        </span>
        <span aria-hidden className="text-gray transition-transform group-open:rotate-90">
          ›
        </span>
      </summary>
      <ul className="pb-3">{children}</ul>
    </details>
  );
}

function contranMark(status: string): Mark {
  if (status === "pass") return "pass";
  if (status === "fail") return "fail";
  if (status === "to_confirm") return "warn";
  return "na";
}

function itemMark(item: { status: string; kind: string }): Mark {
  if (item.status === "pass") return "pass";
  if (item.status === "fail") return "fail";
  if (item.status === "to_confirm") return "warn";
  if (item.status === "advice") return "advice";
  return "na";
}

/** What a situation did, in one word: holds, slides, tips, rolls, falls off, hits the cab. */
export function outcomeOf(situation: Pick<SituationResult, "findings">, country = "BR"): string {
  const findings = physicalFindings(situation.findings as Finding[], country).filter((f) => f.severity === "fail");
  const codes = new Set(findings.map((f) => f.code));
  if (codes.has("unit_left_bed")) return "falls";
  if (codes.has("unit_tilted")) return "tips";
  if (codes.has("unit_rolled")) return "rolls";
  if (codes.has("unit_hit_headboard") || codes.has("headboard_overloaded")) return "hits";
  if (codes.has("lashing_broke") || codes.has("lashing_overloaded")) return "strap";
  if (codes.has("unit_slid")) return "slides";
  return "holds";
}

export function Checklist({
  battery,
  onOpenSituation,
  onHeadboard,
  onFrontEndRating,
  readOnly = false,
}: {
  battery: Battery;
  onOpenSituation?: (id: SituationResult["id"]) => void;
  /** Re-check with the headboard height the driver gives (m). */
  onHeadboard?: (heightM: number) => void;
  /** US: re-check with the front end structure's declared rating (kg of force). */
  onFrontEndRating?: (kg: number) => void;
  readOnly?: boolean;
}) {
  const t = useTranslations("Driver.checks");
  const format = useFormatter();
  const { nameOf } = useReplayText();
  const country = useShownCountry();
  const us = country === "US";
  const eu = country === "EU";
  const measure = useShownUnits();
  const situationName = useSituationName();
  const units = (ids: string[]) => ids.map((id) => nameOf(id)).join(", ");
  const tonnes = (kg: number) => measure.weight(kg, { metric: false });
  const metres = (m: number) => measure.length(m);
  const checklist = battery.checklist;
  /** The numbers behind an EU check, in the page's units ("holds 14.5 t of 20.4 t: 71 %"). */
  function euNumbers(code: string, values: Record<string, number>, status: string): string | null {
    if (status === "not_applicable") return null;
    if (EU_DIRECTIONS.has(code)) {
      if (values.friction_alone) return t("eu.values.friction", { mu: format.number(values.friction ?? 0) });
      if (values.blocked) return t("eu.values.blocked");
      return t("eu.values.held", {
        held: tonnes(values.held_kg ?? 0),
        mass: tonnes(values.mass_kg ?? 0),
        share: format.number(Math.min(values.ratio ?? 0, 9.99), { style: "percent", maximumFractionDigits: 0 }),
        mu: format.number(values.friction ?? 0),
      });
    }
    if (code === "eu_body_strength" && values.front_dan !== undefined) {
      return t("eu.values.walls", {
        code: values.xl ? "XL" : "L",
        front: measure.capacity((values.front_dan ?? 0) * 10),
        side: measure.capacity((values.side_dan ?? 0) * 10),
        rear: measure.capacity((values.rear_dan ?? 0) * 10),
      });
    }
    if (code === "eu_devices" && values.strap_lc_dan !== undefined) {
      return t("eu.values.straps", { lc: measure.capacity(values.strap_lc_dan * 10), stf: measure.capacity((values.strap_stf_dan ?? 0) * 10) });
    }
    if (code === "eu_devices" && values.chain_lc_dan !== undefined) {
      return t("eu.values.chains", { lc: measure.capacity(values.chain_lc_dan * 10) });
    }
    if (code === "eu_lashing_points") {
      return t("eu.values.points", { point: measure.capacity((values.point_dan ?? 0) * 10), vehicle: tonnes(values.vehicle_kg ?? 0) });
    }
    if (code === "eu_headboard_height") {
      return t("eu.values.height", { height: metres(values.height_m ?? 0), top: metres(values.load_top_m ?? 0) });
    }
    return null;
  }
  /** US 393.114(c): the worst simulated wall load next to the minimum (and the declared rating). */
  function wallNumbers(values: Record<string, number>): string | null {
    const loads = battery.situations.map((s) => s.wall_load_n).filter((n): n is number => typeof n === "number");
    const minimum = battery.situations.find((s) => typeof s.front_end_min_n === "number")?.front_end_min_n;
    if (!loads.length || typeof minimum !== "number") return null;
    const load = Math.max(...loads);
    const kg = (n: number) => measure.weight(n / G, { metric: false });
    return t("fmcsa.front_end_structure.values", {
      load: kg(load),
      minimum: kg(minimum),
      within: load <= minimum ? "yes" : "no",
      declared: values.declared_kg ? measure.weight(values.declared_kg, { metric: false }) : "none",
    });
  }
  const situations = SITUATION_IDS.map((id) => battery.situations.find((s) => s.id === id)).filter((s): s is SituationResult => Boolean(s));

  const contranMarks = battery.contran_945.map((check) => contranMark(check.status));
  const weightItems = checklist?.weight ?? [];
  const protectionItems = checklist?.protection ?? [];
  const dimensionItems = checklist?.dimensions ?? [];
  // EN 12195-1 is the standard behind Brazil's rule; in US mode the CFR checks stand alone, and in
  // EU mode the EN 12195-1 calculation is the direction checks themselves.
  const en = us || eu ? [] : battery.en_12195_1;
  const themes = eu ? "themesEu" : us ? "themesUs" : "themes";

  return (
    <section className="mt-14" aria-labelledby="checklist-title" data-testid="checklist">
      <h2 id="checklist-title" className="type-card-title">
        {t("title")}
      </h2>
      <p className="type-small mt-1 text-gray">{t("sentence")}</p>
      <div className="mt-4 border-t border-hairline">
        <Theme id="securing" title={t(`${themes}.securing` as never)} marks={[...contranMarks, ...en.map((c) => (c.meets_standard === false ? "advice" : "pass") as Mark)]}>
          {battery.contran_945
            // US commodity rules that do not apply to this load (no van, no coils...) stay out of the list.
            .filter((check) => !(us && check.status === "not_applicable" && US_ONLY_IF_APPLICABLE.has(check.code)))
            .filter((check) => !(eu && check.status === "not_applicable" && EU_ONLY_IF_APPLICABLE.has(check.code)))
            .map((check) => {
            const state = check.status === "fail" ? "fail" : check.status === "to_confirm" ? "confirm" : check.status === "not_applicable" ? "na" : "pass";
            const group = eu ? "eu" : us ? "fmcsa" : "contran";
            const values = "values" in check ? (check.values ?? {}) : {};
            const deficiency = "deficiency" in check && check.status === "fail" ? (check.deficiency ?? null) : null;
            const numbers = eu
              ? euNumbers(check.code, values, check.status)
              : us && check.status !== "not_applicable" && check.code === "aggregate_wll"
                ? t("fmcsa.aggregate_wll.values", {
                    aggregate: measure.weight(values.aggregate_kg ?? 0, { metric: false }),
                    required: measure.weight(values.required_kg ?? 0, { metric: false }),
                    indirect: format.number(values.indirect ?? 0),
                    direct: format.number(values.direct ?? 0),
                  })
                : us && check.status !== "not_applicable" && check.code === "min_tiedowns"
                  ? t("fmcsa.min_tiedowns.values", {
                      installed: format.number(values.installed ?? 0),
                      required: format.number(values.required ?? 0),
                      blocked: values.blocked ? "yes" : "no",
                    })
                  : us && check.code === "front_end_structure"
                    ? wallNumbers(values)
                    : null;
            const title = eu
              ? t(`eu.${check.code}.${state}` as never, { g: format.number(values.acceleration_g ?? 0) } as never)
              : us && check.code === "front_end_structure" && check.status === "to_confirm"
                ? t("fmcsa.front_end_structure.confirm", {
                    demand: measure.weight(values.demand_kg ?? 0, { metric: false }),
                    height: measure.length(values.required_height_m ?? 1.22),
                  })
                : t(`${group}.${check.code}.${state}` as never);
            return (
              <Item
                key={check.code}
                testId={check.code}
                mark={contranMark(check.status)}
                title={title}
                deficiency={deficiency}
                detail={
                  <>
                    {numbers && <span className="block">{numbers}</span>}
                    {t(`${group}.${check.code}.explain` as never)}
                    {check.unit_ids.length > 0 && check.status !== "pass" && ` ${t("units", { units: units(check.unit_ids) })}`}
                    {us && check.code === "front_end_structure" && check.status === "to_confirm" && !readOnly && onFrontEndRating && (
                      <FrontEndRatingInput onSubmit={onFrontEndRating} />
                    )}
                  </>
                }
                article={articleOf(check.article)}
                fix={t(`${group}.${check.code}.fix` as never)}
              />
            );
          })}
          {groupEn(en).map(({ check, ids }) => (
            <Item
              key={ids.join("-")}
              testId={`en-${ids[0]}`}
              // EN 12195-1 is the standard behind the rule, not the rule: the simulation decides.
              mark={check.meets_standard === null ? "na" : check.meets_standard ? "pass" : "advice"}
              title={
                check.meets_standard === null
                  ? t("en.notAssessed", { unit: units(ids) })
                  : check.required_lashings !== null
                    ? t("en.straps", { unit: units(ids), installed: check.installed_lashings, required: check.required_lashings })
                    : t(check.meets_standard ? "en.meets" : "en.fails", { unit: units(ids) })
              }
              detail={t("en.explain")}
              article={`EN 12195-1 · ${t("advice")}`}
              fix={t("en.fix")}
            />
          ))}
        </Theme>

        <Theme id="weight" title={t(`${themes}.weight` as never)} marks={weightItems.map(itemMark)}>
          {weightItems.map((item, index) => {
            const v = item.values;
            if (item.code === "eu_axle") {
              const ratio = v.ratio ?? 0;
              const color = ratio > 1 ? "bg-fail" : ratio > 0.9 ? "bg-amber" : "bg-pass";
              return (
                <Item
                  key={`eu_axle-${index}`}
                  testId={`axle-${item.unit_ids[0] ?? index}`}
                  mark={itemMark(item)}
                  title={t("weight.eu_axle", { axle: item.unit_ids[0] ?? "rear", load: tonnes(v.load_kg ?? 0), limit: tonnes(v.limit_kg ?? 0) })}
                  detail={t(v.axles && v.axles > 1 ? "weight.eu_groupExplain" : v.driving ? "weight.eu_drivingExplain" : "weight.eu_axleExplain", {
                    spread: metres(v.spread_m ?? 0),
                  })}
                  article={item.article}
                  fix={t("weight.us_axleFix")}
                >
                  <span className="mt-2 block h-2 w-full max-w-sm overflow-hidden rounded-full bg-surface" aria-hidden>
                    <span className={`block h-full ${color}`} style={{ width: `${Math.min(ratio / 1.25, 1) * 100}%` }} />
                  </span>
                </Item>
              );
            }
            if (item.code === "eu_gross" || item.code === "eu_driving_share") {
              return (
                <Item
                  key={item.code}
                  testId={item.code}
                  mark={itemMark(item)}
                  title={
                    item.code === "eu_gross"
                      ? t("weight.eu_gross", { gross: tonnes(v.gross_kg ?? 0), limit: tonnes(v.limit_kg ?? 0) })
                      : t("weight.eu_driving_share", { share: format.number(v.share ?? 0, { style: "percent", maximumFractionDigits: 0 }) })
                  }
                  detail={t(`weight.${item.code}Explain` as never)}
                  article={item.article}
                  fix={t(`weight.${item.code}Fix` as never)}
                />
              );
            }
            if (item.code === "us_axle" || item.code === "bridge") {
              const ratio = v.ratio ?? 0;
              const color = ratio > 1 ? "bg-fail" : ratio > 0.9 ? "bg-amber" : "bg-pass";
              const load = measure.weight(v.load_kg ?? 0, { lb: v.load_lb });
              const limit = measure.weight(v.limit_kg ?? 0, { lb: v.limit_lb, metric: false });
              return (
                <Item
                  key={`${item.code}-${index}`}
                  testId={item.code === "bridge" ? "bridge" : `axle-${item.unit_ids[0] ?? index}`}
                  mark={itemMark(item)}
                  title={
                    item.code === "bridge"
                      ? t("weight.bridge", {
                          first: format.number(v.first ?? 1),
                          last: format.number(v.last ?? 2),
                          length: measure.length((v.length_ft ?? 0) * 0.3048),
                          load,
                          limit,
                        })
                      : t("weight.us_axle", { axle: item.unit_ids[0] ?? "rear", load, limit })
                  }
                  detail={t(item.code === "bridge" ? "weight.bridgeExplain" : "weight.us_axleExplain")}
                  article={item.article}
                  fix={t(item.code === "bridge" ? "weight.bridgeFix" : "weight.us_axleFix")}
                >
                  <span className="mt-2 block h-2 w-full max-w-sm overflow-hidden rounded-full bg-surface" aria-hidden>
                    <span className={`block h-full ${color}`} style={{ width: `${Math.min(ratio / 1.25, 1) * 100}%` }} />
                  </span>
                </Item>
              );
            }
            if (item.code === "us_gross") {
              return (
                <Item
                  key="us_gross"
                  testId="us_gross"
                  mark={itemMark(item)}
                  title={t("weight.us_gross", {
                    gross: measure.weight(v.gross_kg ?? 0, { lb: v.gross_lb }),
                    limit: measure.weight(v.limit_kg ?? 0, { lb: v.limit_lb, metric: false }),
                  })}
                  detail={t("weight.us_grossExplain")}
                  article={item.article}
                  fix={t("weight.us_grossFix")}
                />
              );
            }
            if (item.code === "axle") {
              const ratio = v.ratio ?? 0;
              const color = ratio > 1 ? "bg-fail" : ratio > 0.9 ? "bg-amber" : "bg-pass";
              return (
                <Item
                  key={`axle-${index}`}
                  testId={`axle-${item.unit_ids[0] ?? index}`}
                  mark={itemMark(item)}
                  title={t("weight.axle", { axle: item.unit_ids[0] ?? "rear", load: tonnes(v.load_kg ?? 0), limit: tonnes(v.limit_kg ?? 0) })}
                  detail={
                    <>
                      {t("weight.axleExplain", { tolerance: tonnes(v.tolerance_kg ?? 0) })}
                      {v.weighed_on_gross_only ? ` ${t("weight.axleGrossOnly", { regulatory: tonnes(v.regulatory_gross_kg ?? 0) })}` : null}
                    </>
                  }
                  article={item.article}
                  fix={t("weight.axleFix")}
                >
                  <span className="mt-2 block h-2 w-full max-w-sm overflow-hidden rounded-full bg-surface" aria-hidden>
                    <span className={`block h-full ${color}`} style={{ width: `${Math.min(ratio / 1.25, 1) * 100}%` }} />
                  </span>
                </Item>
              );
            }
            const title =
              item.code === "payload"
                ? t("weight.payload", { cargo: tonnes(v.cargo_kg ?? 0), payload: tonnes(v.payload_kg ?? 0) })
                : item.code === "gross"
                  ? t("weight.gross", { gross: tonnes(v.gross_kg ?? 0), limit: tonnes(v.limit_kg ?? 0) })
                  : item.code === "lateral_balance"
                    ? t(item.status === "pass" ? "weight.lateralOk" : "weight.lateral", { offset: measure.short(Math.abs(v.offset_m ?? 0)) })
                    : t(item.status === "pass" ? "weight.frontOk" : "weight.front", { share: format.number(v.share ?? 0, { style: "percent", maximumFractionDigits: 0 }) });
            return (
              <Item
                key={item.code}
                testId={item.code}
                mark={itemMark(item)}
                title={title}
                detail={t((us && item.code === "payload" ? "weight.payloadUsExplain" : eu && item.code === "payload" ? "weight.payloadEuExplain" : `weight.${item.code}Explain`) as never)}
                article={item.kind === "advice" ? t("advice") : item.article}
                fix={t(`weight.${item.code}Fix` as never)}
              />
            );
          })}
          {!weightItems.length && <Item mark="na" title={t("weight.none")} />}
        </Theme>

        <Theme id="physics" title={t("themes.physics")} marks={situations.map((s) => situationMark(s, country))}>
          {situations.map((situation) => {
            const outcome = outcomeOf(situation, country);
            return (
              <Item
                key={situation.id}
                testId={situation.id}
                mark={situationMark(situation, country)}
                title={t(`outcome.${outcome}` as never, { situation: situationName(situation.id) } as never)}
                detail={t("physicsExplain", {
                  speed: measure.speed(situation.event.speed_kmh),
                  situation: situationName(situation.id),
                })}
                article={t(eu ? "physicsArticleEu" : us ? "physicsArticleUs" : "physicsArticle")}
                fix={t("physicsFix")}
              >
                {onOpenSituation && (
                  <button
                    type="button"
                    onClick={() => onOpenSituation(situation.id)}
                    className="type-small mt-1 min-h-11 text-ink underline decoration-1 underline-offset-4 sm:min-h-8"
                    data-testid={`open-${situation.id}`}
                  >
                    {t("seeIt")}
                  </button>
                )}
              </Item>
            );
          })}
        </Theme>

        <Theme id="protection" title={t("themes.protection")} marks={protectionItems.map(itemMark)}>
          {protectionItems.map((item) => (
            <Item
              key={item.code}
              testId={item.code}
              mark={itemMark(item)}
              title={
                item.code === "headboard_height"
                  ? t(item.status === "pass" ? "protection.headboardKnown" : "protection.headboardConfirm", {
                      height: metres(item.values.height_m ?? 0),
                      top: metres(item.values.load_top_m ?? 0),
                    })
                  : t(`protection.${item.code}.${item.status === "pass" ? "pass" : item.status === "not_applicable" ? "na" : "advice"}` as never)
              }
              detail={t(`protection.${item.code === "headboard_height" ? (us ? "headboardExplainUs" : "headboardExplain") : `${item.code}.explain`}` as never)}
              article={item.kind === "advice" ? `${t("advice")} · ${item.article}` : item.article}
              fix={item.code === "headboard_height" ? null : t(`protection.${item.code}.fix` as never)}
            >
              {item.code === "headboard_height" && !readOnly && onHeadboard && (
                <HeadboardInput initial={item.values.height_m ?? 1.2} onSubmit={onHeadboard} />
              )}
            </Item>
          ))}
        </Theme>

        <Theme id="dimensions" title={t(`${themes}.dimensions` as never)} marks={dimensionItems.map(itemMark)}>
          {dimensionItems
            // The overall length is known only on the EU presets.
            .filter((item) => !(item.code === "eu_length" && item.status === "not_applicable"))
            .map((item) => (
            <Item
              key={item.code}
              testId={item.code}
              mark={itemMark(item)}
              title={t(`dimensions.${item.code}` as never, {
                value: metres(item.values.height_m ?? item.values.width_m ?? item.values.length_m ?? item.values.overhang_m ?? 0),
                limit: metres(item.values.limit_m ?? 0),
              } as never)}
              detail={t(
                (us && item.code === "width" ? "dimensions.widthUsExplain" : `dimensions.${item.code}Explain`) as never,
              )}
              article={item.article}
              fix={t(`dimensions.${item.code}Fix` as never)}
            />
          ))}
          {!dimensionItems.length && <Item mark="na" title={t("weight.none")} />}
        </Theme>
      </div>
    </section>
  );
}

/** Units with the same EN 12195-1 answer, as one line ("Unit 1, Unit 2: 1 strap; asks for 2"). */
function groupEn(checks: Battery["en_12195_1"]) {
  const groups: { check: Battery["en_12195_1"][number]; ids: string[] }[] = [];
  for (const check of checks) {
    const same = groups.find(
      (g) =>
        g.check.meets_standard === check.meets_standard &&
        g.check.installed_lashings === check.installed_lashings &&
        g.check.required_lashings === check.required_lashings,
    );
    if (same) same.ids.push(check.unit_id);
    else groups.push({ check, ids: [check.unit_id] });
  }
  return groups;
}

/** US: the declared forward rating of the headboard or front wall, from its plate (lb or kg). */
function FrontEndRatingInput({ onSubmit }: { onSubmit: (kg: number) => void }) {
  const t = useTranslations("Driver.checks.fmcsa.front_end_structure");
  const id = useId();
  const units = useShownUnits();
  const [value, setValue] = useState("");
  const number = units.weightIn(Number(value.replace(/[,\s]/g, "")));
  const valid = Number.isFinite(number) && number > 0 && number <= 100_000;
  return (
    <span className="mt-2 flex flex-wrap items-end gap-2">
      <span>
        <label htmlFor={id} className="type-small block text-gray">
          {t("ratingLabel", { unit: units.weightUnit })}
        </label>
        <input
          id={id}
          inputMode="numeric"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="mt-1 h-11 w-28 rounded border border-control bg-paper px-2 font-mono"
          data-testid="front-end-rating-input"
        />
      </span>
      <button type="button" disabled={!valid} onClick={() => onSubmit(Math.round(number))} className={pill({ variant: "secondary", className: "h-11 px-4" })} data-testid="front-end-rating-save">
        {t("ratingSave")}
      </button>
    </span>
  );
}

function HeadboardInput({ initial, onSubmit }: { initial: number; onSubmit: (heightM: number) => void }) {
  const t = useTranslations("Driver.checks.protection");
  const id = useId();
  const units = useShownUnits();
  const [value, setValue] = useState(String(Math.round(units.lengthOut(initial) * 100) / 100));
  const typed = Number(value.replace(",", "."));
  const number = units.lengthIn(typed);
  const valid = Number.isFinite(number) && number > 0.2 && number <= 4;
  return (
    <span className="mt-2 flex flex-wrap items-end gap-2">
      <span>
        <label htmlFor={id} className="type-small block text-gray">
          {t("headboardLabel", { unit: units.lengthUnit })}
        </label>
        <input
          id={id}
          inputMode="decimal"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="mt-1 h-11 w-24 rounded border border-control bg-paper px-2 font-mono"
          data-testid="headboard-input"
        />
      </span>
      <button type="button" disabled={!valid} onClick={() => onSubmit(Math.round(number * 100) / 100)} className={pill({ variant: "secondary", className: "h-11 px-4" })} data-testid="headboard-save">
        {t("headboardSave")}
      </button>
    </span>
  );
}
