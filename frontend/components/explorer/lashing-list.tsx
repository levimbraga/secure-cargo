"use client";

/**
 * A unit's lashings, one row each, set by hand: the device (web strap, chain, rope), the route
 * (over the top, or a diagonal from a corner) and the lashing point it uses, with the angles
 * that follow (α to the bed, β to the length of the truck, as EN 12195-1 names them). Adding,
 * removing or changing one makes the unit's lashings the list itself; "Back to the usual ones"
 * returns to what the load's securing gives.
 */

import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import { useShownUnits } from "@/components/units-context";
import { type DraftLashing, type Footprint, type LoadDraft, strapPairs } from "@/lib/explorer/draft";
import {
  addLashing,
  anglesOf,
  CAPACITY_DAN,
  CORNERS,
  type Corner,
  defaultDiagonalAnchor,
  KINDS,
  lashingsOf,
  MAX_LASHINGS,
  resetLashings,
  setLashings,
  sidePoints,
} from "@/lib/explorer/lashings";
import type { Scenario } from "@/lib/live/scenario";

const SELECT = "h-11 rounded-full border border-control bg-paper px-3 text-sm sm:h-9";

export function LashingList({
  scenario,
  draft,
  unit,
  onEdit,
}: {
  scenario: Scenario;
  draft: LoadDraft;
  /** The unit the lashings go over: the top of its stack. */
  unit: Footprint;
  onEdit: (next: LoadDraft) => void;
}) {
  const t = useTranslations("Explorer.lashings");
  const format = useFormatter();
  const units = useShownUnits();
  const [kind, setKind] = useState<DraftLashing["kind"]>("strap");
  const custom = Boolean(draft.units.find((item) => item.id === unit.id)?.lashings);
  const list = lashingsOf(draft, scenario, unit);
  const pairs = strapPairs(scenario, unit);
  const halfBed = scenario.bed.length_m / 2;
  const fromFront = (x: number) => units.length(Math.max(0, halfBed - x));
  const degrees = (value: number) => format.number(value, { maximumFractionDigits: 0 });

  const change = (next: DraftLashing[]) => onEdit(setLashings(draft, unit.id, next));
  const update = (index: number, patch: Partial<DraftLashing>) =>
    change(list.map((item, n) => (n === index ? { ...item, ...patch } : item)));

  return (
    <div data-testid="lashing-list" data-custom={custom}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="type-label">{t("title")}</span>
        {custom ? (
          <button
            type="button"
            onClick={() => onEdit(resetLashings(draft, unit.id))}
            className="min-h-11 text-sm text-ink underline decoration-1 underline-offset-4 sm:min-h-8"
            data-testid="lashings-reset"
          >
            {t("reset")}
          </button>
        ) : (
          <span className="type-small text-gray">{t("usual")}</span>
        )}
      </div>
      {list.length === 0 && <p className="type-small mt-1 text-gray">{t("none")}</p>}
      <ol className="mt-2 space-y-3">
        {list.map((lashing, index) => {
          const angles = anglesOf(lashing, scenario, unit);
          const left = lashing.corner ? lashing.corner.endsWith("left") : true;
          return (
            <li key={index} className="rounded border border-hairline p-3" data-lashing-row={index} data-kind={lashing.kind} data-routing={lashing.routing}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex size-6 items-center justify-center bg-ink font-mono text-[0.75rem] text-paper">{index + 1}</span>
                <label className="sr-only" htmlFor={`lashing-kind-${unit.id}-${index}`}>
                  {t("kind")}
                </label>
                <select
                  id={`lashing-kind-${unit.id}-${index}`}
                  value={lashing.kind}
                  onChange={(event) => update(index, { kind: event.target.value as DraftLashing["kind"] })}
                  className={SELECT}
                  data-testid="lashing-kind"
                >
                  {KINDS.map((item) => (
                    <option key={item} value={item}>
                      {t(`kinds.${item}`)}
                    </option>
                  ))}
                </select>
                <span className="text-sm text-ink">{t(`routes.${lashing.routing}`)}</span>
                <button
                  type="button"
                  onClick={() => change(list.filter((_, n) => n !== index))}
                  aria-label={t("remove", { number: index + 1 })}
                  className="ml-auto size-11 rounded-full text-gray hover:text-fail sm:size-8"
                  data-testid="lashing-remove"
                >
                  ×
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {lashing.routing === "top_over" ? (
                  <label className="flex items-center gap-2 text-sm text-gray">
                    {t("at")}
                    <select
                      value={lashing.anchors[0]}
                      onChange={(event) => {
                        const pair = pairs.find((item) => item.left === event.target.value);
                        if (pair) update(index, { anchors: [pair.left, pair.right] });
                      }}
                      className={SELECT}
                      data-testid="lashing-pair"
                    >
                      {!pairs.some((pair) => pair.left === lashing.anchors[0]) && <option value={lashing.anchors[0]}>{t("offUnit")}</option>}
                      {pairs.map((pair) => (
                        <option key={pair.left} value={pair.left}>
                          {t("fromFront", { distance: fromFront(pair.x) })}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <>
                    <label className="flex items-center gap-2 text-sm text-gray">
                      {t("corner")}
                      <select
                        value={lashing.corner ?? "front_left"}
                        onChange={(event) => {
                          const corner = event.target.value as Corner;
                          update(index, { corner, anchors: [defaultDiagonalAnchor(scenario, unit, corner)] });
                        }}
                        className={SELECT}
                        data-testid="lashing-corner"
                      >
                        {CORNERS.map((corner) => (
                          <option key={corner} value={corner}>
                            {t(`corners.${corner}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex items-center gap-2 text-sm text-gray">
                      {t("to")}
                      <select
                        value={lashing.anchors[0]}
                        onChange={(event) => update(index, { anchors: [event.target.value] })}
                        className={SELECT}
                        data-testid="lashing-anchor"
                      >
                        {sidePoints(scenario, left).map((anchor) => (
                          <option key={anchor.id} value={anchor.id}>
                            {t(left ? "pointLeft" : "pointRight", { distance: fromFront(anchor.position_m[0]) })}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
              </div>
              <p className="type-small mt-2 font-mono text-gray" data-testid="lashing-angles">
                {angles
                  ? angles.beta === null
                    ? t("angleOver", { alpha: degrees(angles.alpha) })
                    : t("angleDiagonal", { alpha: degrees(angles.alpha), beta: degrees(angles.beta) })
                  : ""}
                {" · "}
                {t("capacity", { value: format.number(CAPACITY_DAN[lashing.kind]) })}
              </p>
            </li>
          );
        })}
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`lashing-add-kind-${unit.id}`}>
          {t("kind")}
        </label>
        <select id={`lashing-add-kind-${unit.id}`} value={kind} onChange={(event) => setKind(event.target.value as DraftLashing["kind"])} className={SELECT}>
          {KINDS.map((item) => (
            <option key={item} value={item}>
              {t(`kinds.${item}`)}
            </option>
          ))}
        </select>
        {(["top_over", "direct"] as const).map((routing) => (
          <button
            key={routing}
            type="button"
            disabled={list.length >= MAX_LASHINGS || (routing === "top_over" && pairs.length === 0)}
            onClick={() => {
              const next = addLashing(list, scenario, unit, routing, kind);
              if (next) change(next);
            }}
            className="h-11 rounded-full bg-surface px-4 text-sm text-ink disabled:opacity-40 sm:h-9"
            data-testid={`lashing-add-${routing}`}
          >
            {t(`add.${routing}`)}
          </button>
        ))}
      </div>
      {list.some((lashing) => lashing.kind === "rope") && <p className="type-small mt-2 text-warn">{t("ropeNote")}</p>}
    </div>
  );
}
