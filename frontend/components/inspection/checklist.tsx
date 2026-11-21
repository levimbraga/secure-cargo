"use client";

/**
 * The checklist of an inspection, by theme: how the load is secured (CONTRAN 945), weight and
 * axles (CONTRAN 882), the trip's physics (the seven situations), protection, and dimensions.
 * Every item: a mark, a plain explanation, the article or standard, and how to fix it.
 */

import { useFormatter, useTranslations } from "next-intl";
import { type ReactNode, useId, useState } from "react";

import { useReplayText } from "@/components/scenario/replay-shared";
import { pill } from "@/components/ui/pill";
import type { Finding } from "@/lib/demo";
import { type Battery, SITUATION_IDS, type SituationResult } from "@/lib/inspection/types";
import { holds, physicalFindings } from "@/lib/inspection/verdict";

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
}: {
  mark: Mark;
  title: ReactNode;
  detail?: ReactNode;
  article?: string | null;
  fix?: ReactNode;
  children?: ReactNode;
  testId?: string;
}) {
  const t = useTranslations("Driver.checks");
  return (
    <li className="flex items-start gap-3 border-t border-hairline py-3" data-check={testId} data-mark={mark}>
      <MarkIcon mark={mark} />
      <span className="min-w-0 flex-1">
        <span className="block text-ink">{title}</span>
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
export function outcomeOf(situation: Pick<SituationResult, "findings">): string {
  const findings = physicalFindings(situation.findings as Finding[]).filter((f) => f.severity === "fail");
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
  readOnly = false,
}: {
  battery: Battery;
  onOpenSituation?: (id: SituationResult["id"]) => void;
  /** Re-check with the headboard height the driver gives (m). */
  onHeadboard?: (heightM: number) => void;
  readOnly?: boolean;
}) {
  const t = useTranslations("Driver.checks");
  const flow = useTranslations("Flow");
  const format = useFormatter();
  const { nameOf } = useReplayText();
  const units = (ids: string[]) => ids.map((id) => nameOf(id)).join(", ");
  const tonnes = (kg: number) => format.number(kg / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const metres = (m: number) => format.number(m, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const checklist = battery.checklist;
  const situations = SITUATION_IDS.map((id) => battery.situations.find((s) => s.id === id)).filter((s): s is SituationResult => Boolean(s));

  const contranMarks = battery.contran_945.map((check) => contranMark(check.status));
  const weightItems = checklist?.weight ?? [];
  const protectionItems = checklist?.protection ?? [];
  const dimensionItems = checklist?.dimensions ?? [];
  const en = battery.en_12195_1;

  return (
    <section className="mt-14" aria-labelledby="checklist-title" data-testid="checklist">
      <h2 id="checklist-title" className="type-card-title">
        {t("title")}
      </h2>
      <p className="type-small mt-1 text-gray">{t("sentence")}</p>
      <div className="mt-4 border-t border-hairline">
        <Theme id="securing" title={t("themes.securing")} marks={[...contranMarks, ...en.map((c) => (c.meets_standard === false ? "advice" : "pass") as Mark)]}>
          {battery.contran_945.map((check) => (
            <Item
              key={check.code}
              testId={check.code}
              mark={contranMark(check.status)}
              title={t(`contran.${check.code}.${check.status === "fail" ? "fail" : check.status === "to_confirm" ? "confirm" : check.status === "not_applicable" ? "na" : "pass"}` as never)}
              detail={
                <>
                  {t(`contran.${check.code}.explain`)}
                  {check.unit_ids.length > 0 && check.status !== "pass" && ` ${t("units", { units: units(check.unit_ids) })}`}
                </>
              }
              article={`CONTRAN 945/2022, ${check.article}`}
              fix={t(`contran.${check.code}.fix`)}
            />
          ))}
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

        <Theme id="weight" title={t("themes.weight")} marks={weightItems.map(itemMark)}>
          {weightItems.map((item, index) => {
            const v = item.values;
            if (item.code === "axle") {
              const ratio = v.ratio ?? 0;
              const color = ratio > 1 ? "bg-fail" : ratio > 0.9 ? "bg-amber" : "bg-pass";
              return (
                <Item
                  key={`axle-${index}`}
                  testId={`axle-${item.unit_ids[0] ?? index}`}
                  mark={itemMark(item)}
                  title={t("weight.axle", { axle: item.unit_ids[0] ?? "rear", load: tonnes(v.load_kg ?? 0), limit: tonnes(v.limit_kg ?? 0) })}
                  detail={t("weight.axleExplain", { tolerance: tonnes(v.tolerance_kg ?? 0) })}
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
                    ? t(item.status === "pass" ? "weight.lateralOk" : "weight.lateral", { offset: format.number(Math.abs((v.offset_m ?? 0) * 100), { maximumFractionDigits: 0 }) })
                    : t(item.status === "pass" ? "weight.frontOk" : "weight.front", { share: format.number(v.share ?? 0, { style: "percent", maximumFractionDigits: 0 }) });
            return (
              <Item
                key={item.code}
                testId={item.code}
                mark={itemMark(item)}
                title={title}
                detail={t(`weight.${item.code}Explain` as never)}
                article={item.kind === "advice" ? t("advice") : item.article}
                fix={t(`weight.${item.code}Fix` as never)}
              />
            );
          })}
          {!weightItems.length && <Item mark="na" title={t("weight.none")} />}
        </Theme>

        <Theme id="physics" title={t("themes.physics")} marks={situations.map((s) => (holds(s) ? (s.status === "warning" ? "warn" : "pass") : "fail"))}>
          {situations.map((situation) => {
            const outcome = outcomeOf(situation);
            return (
              <Item
                key={situation.id}
                testId={situation.id}
                mark={holds(situation) ? (situation.status === "warning" ? "warn" : "pass") : "fail"}
                title={t(`outcome.${outcome}` as never, { situation: flow(`situations.${situation.id}.name`) } as never)}
                detail={t("physicsExplain", {
                  speed: format.number(situation.event.speed_kmh),
                  situation: flow(`situations.${situation.id}.name`),
                })}
                article={t("physicsArticle")}
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
              detail={t(`protection.${item.code === "headboard_height" ? "headboardExplain" : `${item.code}.explain`}` as never)}
              article={item.kind === "advice" ? `${t("advice")} · ${item.article}` : item.article}
              fix={item.code === "headboard_height" ? null : t(`protection.${item.code}.fix` as never)}
            >
              {item.code === "headboard_height" && !readOnly && onHeadboard && (
                <HeadboardInput initial={item.values.height_m ?? 1.2} onSubmit={onHeadboard} />
              )}
            </Item>
          ))}
        </Theme>

        <Theme id="dimensions" title={t("themes.dimensions")} marks={dimensionItems.map(itemMark)}>
          {dimensionItems.map((item) => (
            <Item
              key={item.code}
              testId={item.code}
              mark={itemMark(item)}
              title={t(`dimensions.${item.code}` as never, {
                value: metres(item.values.height_m ?? item.values.width_m ?? item.values.overhang_m ?? 0),
                limit: metres(item.values.limit_m ?? 0),
              } as never)}
              detail={t(`dimensions.${item.code}Explain` as never)}
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

function HeadboardInput({ initial, onSubmit }: { initial: number; onSubmit: (heightM: number) => void }) {
  const t = useTranslations("Driver.checks.protection");
  const id = useId();
  const [value, setValue] = useState(String(initial));
  const number = Number(value.replace(",", "."));
  const valid = Number.isFinite(number) && number > 0.2 && number <= 4;
  return (
    <span className="mt-2 flex flex-wrap items-end gap-2">
      <span>
        <label htmlFor={id} className="type-small block text-gray">
          {t("headboardLabel")}
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
