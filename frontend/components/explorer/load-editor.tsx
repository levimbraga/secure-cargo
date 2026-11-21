"use client";

/**
 * The load editor: the truck bed seen from above, front to the right, with the exact
 * dimensions the simulation uses. Drag a unit to move it (it snaps to 5 cm and stays on the
 * bed); tap it to add a strap over it, back to none after the last one its lashing points
 * allow. The axle loads and the centre of mass follow every move, before the server is asked.
 *
 * It is also the review screen of a load that came from a photo: everything it edits is the
 * load draft (`lib/explorer/draft.ts`), nothing else.
 */

import { useFormatter, useTranslations } from "next-intl";
import { type KeyboardEvent, type PointerEvent, useMemo, useRef, useState } from "react";

import { useReplayText } from "@/components/scenario/replay-shared";
import {
  axleLoads,
  centreOfMass,
  cycleStraps,
  type ExplorerLoad,
  type Footprint,
  footprints,
  lashedUnit,
  type LoadDraft,
  moveUnit,
  setStraps,
  SNAP_M,
  strapRoom,
} from "@/lib/explorer/draft";

const CAB_M = 1.6;
const MARGIN_M = 0.35;
/** A press that moves less than this is a tap [m]. */
const TAP_M = 0.04;
const KEY_STEP_M = 0.1;

type Drag = { id: string; offsetX: number; offsetY: number; x: number; y: number; moved: boolean; valid: boolean };

/** Strap positions along a unit: the anchor pairs a top-over strap uses, spread as the server spreads them. */
function strapLines(load: EditorLoad, unit: Footprint, count: number): number[] {
  if (count <= 0) return [];
  const anchors = load.scenario.bed.anchor_points;
  const left = new Set(anchors.filter((a) => a.position_m[1] > unit.y).map((a) => a.position_m[0]));
  const xs = anchors
    .filter((a) => a.position_m[1] < unit.y && left.has(a.position_m[0]))
    .map((a) => a.position_m[0])
    .filter((x) => x > unit.x - unit.length / 2 && x < unit.x + unit.length / 2)
    .sort((a, b) => a - b);
  if (!xs.length) return [];
  return Array.from({ length: Math.min(count, xs.length) }, (_, index) => {
    const pick = Math.round(((index + 0.5) * xs.length) / count - 0.5);
    return xs[Math.min(Math.max(pick, 0), xs.length - 1)] as number;
  });
}

/** What the editor needs of a built load: the bed, its anchors and axles, the units' sizes. */
export type EditorLoad = Pick<ExplorerLoad, "scenario">;

export function LoadEditor({
  load,
  draft,
  onEdit,
  selected = null,
  onSelect,
  numberOf,
  hideUnitList = false,
}: {
  load: EditorLoad;
  draft: LoadDraft;
  onEdit: (next: LoadDraft) => void;
  /** Review mode: a tap selects a unit (straps are set in the review's own panel). */
  selected?: string | null;
  onSelect?: (id: string) => void;
  /** The number shown on a unit (the photo's numbering); its position in the list by default. */
  numberOf?: (unit: Footprint) => number;
  hideUnitList?: boolean;
}) {
  const t = useTranslations("Explorer.editor");
  const format = useFormatter();
  const { nameOf } = useReplayText();
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [refused, setRefused] = useState<string | null>(null);

  const bed = load.scenario.bed;
  const halfL = bed.length_m / 2;
  const halfW = bed.width_m / 2;
  const units = useMemo(() => footprints(draft, load.scenario), [draft, load.scenario]);
  // While dragging, the unit (and its stack) is drawn where the pointer is.
  const shown = useMemo(() => {
    if (!drag) return units;
    const stack = new Set<string>();
    for (let id: string | null = drag.id; id; id = units.find((unit) => unit.id === id)?.carries ?? null) stack.add(id);
    return units.map((unit) => (stack.has(unit.id) ? { ...unit, x: drag.x, y: drag.y } : unit));
  }, [units, drag]);
  const floor = shown.filter((unit) => !unit.on);
  const axles = axleLoads(load.scenario.vehicle, shown);
  const centre = centreOfMass(shown);

  const view = {
    x: -halfL - MARGIN_M,
    y: -halfW - MARGIN_M,
    width: bed.length_m + MARGIN_M + CAB_M,
    height: bed.width_m + 2 * MARGIN_M,
  };

  function toBed(event: PointerEvent): { x: number; y: number } | null {
    const element = svg.current;
    const matrix = element?.getScreenCTM();
    if (!element || !matrix) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: -point.y };
  }

  function place(id: string, x: number, y: number): LoadDraft | null {
    return moveUnit(draft, units, id, x, y, bed);
  }

  function onPointerDown(event: PointerEvent<SVGGElement>, unit: Footprint) {
    const at = toBed(event);
    if (!at) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setRefused(null);
    setDrag({ id: unit.id, offsetX: at.x - unit.x, offsetY: at.y - unit.y, x: unit.x, y: unit.y, moved: false, valid: true });
  }

  function onPointerMove(event: PointerEvent<SVGGElement>) {
    if (!drag) return;
    const at = toBed(event);
    if (!at) return;
    const unit = units.find((item) => item.id === drag.id);
    if (!unit) return;
    const x = at.x - drag.offsetX;
    const y = at.y - drag.offsetY;
    const moved = drag.moved || Math.hypot(x - unit.x, y - unit.y) > TAP_M;
    const next = place(drag.id, x, y);
    const placed = next?.units.find((item) => item.id === drag.id);
    // Off the grid or off the bed: show where it would land; on another unit: show it refused.
    const limitX = halfL - unit.length / 2;
    const limitY = halfW - unit.width / 2;
    const snapped = (value: number, limit: number) =>
      Math.min(Math.max(Math.round(value / SNAP_M) * SNAP_M, -limit), limit);
    setDrag({
      ...drag,
      moved,
      x: placed?.x_m ?? snapped(x, limitX),
      y: placed?.y_m ?? snapped(y, limitY),
      valid: next !== null,
    });
  }

  function onPointerUp(unit: Footprint) {
    if (!drag) return;
    const current = drag;
    setDrag(null);
    if (!current.moved) {
      if (onSelect) onSelect(unit.id);
      else onEdit(cycleStraps(draft, units, unit.id, strapRoom(load.scenario, unit)));
      return;
    }
    const next = place(current.id, current.x, current.y);
    if (next) onEdit(next);
    else setRefused(current.id);
  }

  function onKeyDown(event: KeyboardEvent<SVGGElement>, unit: Footprint) {
    const steps: Record<string, [number, number]> = {
      ArrowRight: [KEY_STEP_M, 0],
      ArrowLeft: [-KEY_STEP_M, 0],
      ArrowUp: [0, KEY_STEP_M],
      ArrowDown: [0, -KEY_STEP_M],
    };
    const step = steps[event.key];
    if (step) {
      event.preventDefault();
      const next = place(unit.id, unit.x + step[0], unit.y + step[1]);
      if (next) onEdit(next);
      else setRefused(unit.id);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (onSelect) onSelect(unit.id);
      else onEdit(cycleStraps(draft, units, unit.id, strapRoom(load.scenario, unit)));
    }
  }

  const tonnes = (kg: number) => format.number(kg / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const strapsOf = (unit: Footprint) => lashedUnit(shown, unit.id)?.straps ?? 0;
  const stackSize = (unit: Footprint) => {
    let size = 1;
    for (let id = unit.carries; id; id = shown.find((item) => item.id === id)?.carries ?? null) size += 1;
    return size;
  };
  const direct = load.scenario.lashings.filter((lashing) => lashing.routing === "direct");
  const anchors = new Map(bed.anchor_points.map((anchor) => [anchor.id, anchor.position_m]));
  const blocks = (load.scenario.bed as { blocks?: { id: string; size_m: number[]; position_m: number[] }[] }).blocks ?? [];

  return (
    <section aria-labelledby="editor-title">
      <h2 id="editor-title" className="type-label">
        {t("title")}
      </h2>
      <p className="type-small mt-1 text-pretty text-gray">{onSelect ? t("hintSelect") : t("hint")}</p>

      <svg
        ref={svg}
        role="group"
        aria-label={t("label")}
        viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
        className="mt-3 block w-full touch-none select-none rounded bg-surface"
        data-testid="load-editor"
      >
        {/* Cab ahead of the bed, and the bed itself. */}
        <rect x={halfL + 0.15} y={-halfW + 0.1} width={CAB_M - 0.3} height={bed.width_m - 0.2} rx={0.12} fill="#d6d6cf" />
        <text x={halfL + 0.15 + (CAB_M - 0.3) / 2} y={0.06} fontSize={0.2} textAnchor="middle" fill="#636361" className="font-mono">
          {t("front")}
        </text>
        <rect x={-halfL} y={-halfW} width={bed.length_m} height={bed.width_m} fill="#f8f8f3" stroke="#8a8a86" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {/* Headboard or front wall. */}
        <line x1={halfL} y1={-halfW} x2={halfL} y2={halfW} stroke="#191918" strokeWidth={3} vectorEffect="non-scaling-stroke" />
        {(bed.side_rail_height_m ?? 0) > 0 && (
          <rect x={-halfL} y={-halfW} width={bed.length_m} height={bed.width_m} fill="none" stroke="#191918" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        )}
        {/* Axle groups. */}
        {(load.scenario.vehicle?.axle_groups ?? []).map((axle) => (
          <line
            key={axle.id}
            x1={axle.position_x_m}
            x2={axle.position_x_m}
            y1={-halfW - 0.2}
            y2={halfW + 0.2}
            stroke="#8a8a86"
            strokeDasharray="4 3"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {/* Lashing points along both edges. */}
        {bed.anchor_points.map((anchor) => (
          <circle key={anchor.id} cx={anchor.position_m[0]} cy={-anchor.position_m[1]} r={0.035} fill="#8a8a86" />
        ))}
        {blocks.map((block) => (
          <rect
            key={block.id}
            x={(block.position_m[0] ?? 0) - (block.size_m[0] ?? 0) / 2}
            y={-(block.position_m[1] ?? 0) - (block.size_m[1] ?? 0) / 2}
            width={block.size_m[0]}
            height={block.size_m[1]}
            fill="#9b7648"
          />
        ))}

        {floor.map((unit) => {
          const dragging = drag?.id === unit.id;
          const invalid = (dragging && !drag.valid) || refused === unit.id;
          const highlighted = dragging || selected === unit.id;
          const straps = strapsOf(unit);
          const name = nameOf(unit.id);
          const stack = stackSize(unit);
          const left = unit.x - unit.length / 2;
          const top = -unit.y - unit.width / 2;
          const standing = unit.round && unit.length === unit.width;
          return (
            <g
              key={unit.id}
              role="button"
              tabIndex={0}
              aria-label={t("unit", { unit: name, straps, stack })}
              data-unit={unit.id}
              className="cursor-grab outline-none focus-visible:[&>.unit-body]:stroke-[#191918]"
              onPointerDown={(event) => onPointerDown(event, unit)}
              onPointerMove={onPointerMove}
              onPointerUp={() => onPointerUp(unit)}
              onPointerCancel={() => setDrag(null)}
              onKeyDown={(event) => onKeyDown(event, unit)}
            >
              {standing ? (
                <circle
                  className="unit-body"
                  cx={unit.x}
                  cy={-unit.y}
                  r={unit.length / 2}
                  fill={invalid ? "#fbe9e7" : "#e2d2b4"}
                  stroke={invalid ? "#b42318" : highlighted ? "#191918" : "#8a6a43"}
                  strokeWidth={highlighted ? 2.5 : 1}
                  vectorEffect="non-scaling-stroke"
                />
              ) : (
                <rect
                  className="unit-body"
                  x={left}
                  y={top}
                  width={unit.length}
                  height={unit.width}
                  rx={unit.round ? Math.min(unit.length, unit.width) / 2 : 0.02}
                  fill={invalid ? "#fbe9e7" : stack > 1 ? "#d9c49a" : "#e2d2b4"}
                  stroke={invalid ? "#b42318" : highlighted ? "#191918" : "#8a6a43"}
                  strokeWidth={highlighted ? 2.5 : 1}
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {strapLines(load, { ...unit }, straps).map((x) => (
                <line
                  key={x}
                  x1={x}
                  x2={x}
                  y1={-halfW}
                  y2={halfW}
                  stroke="#f2a100"
                  strokeWidth={3}
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                />
              ))}
              {/* The number sits in a corner, clear of the strap lines and the centre of mass. */}
              <text
                x={standing ? unit.x : left + 0.06}
                y={standing ? -unit.y + 0.07 : top + Math.min(0.22, unit.width * 0.4)}
                fontSize={Math.min(0.2, unit.width * 0.35)}
                textAnchor={standing ? "middle" : "start"}
                fill="#191918"
                pointerEvents="none"
                className="font-mono"
              >
                {numberOf ? numberOf(unit) : unit.index + 1}
                {stack > 1 ? ` ×${stack}` : ""}
              </text>
            </g>
          );
        })}

        {/* Diagonal lashings, from their anchor to the unit as it is now. */}
        {direct.map((lashing) => {
          const unit = shown.find((item) => item.id === lashing.unit_id);
          const anchor = anchors.get(lashing.anchor_ids[0] ?? "");
          const point = lashing.attachment_point_m;
          if (!unit || !anchor || !point) return null;
          return (
            <line
              key={lashing.id}
              x1={anchor[0]}
              y1={-anchor[1]}
              x2={unit.x + point[0]}
              y2={-(unit.y + point[1])}
              stroke={lashing.kind === "chain" ? "#636361" : "#f2a100"}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          );
        })}

        {centre && (
          <g pointerEvents="none" aria-hidden>
            <line x1={centre.x - 0.15} x2={centre.x + 0.15} y1={-centre.y} y2={-centre.y} stroke="#191918" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            <line x1={centre.x} x2={centre.x} y1={-centre.y - 0.15} y2={-centre.y + 0.15} stroke="#191918" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          </g>
        )}
      </svg>
      <p className="type-label mt-2 flex flex-wrap gap-x-4 gap-y-1" aria-hidden>
        <span>{t("legendFront")}</span>
        <span>
          <span className="mr-1 inline-block h-[3px] w-4 bg-amber align-middle" />
          {t("legendStrap")}
        </span>
        <span>{t("legendCentre")}</span>
      </p>
      {refused && (
        <p role="status" className="type-small mt-2 text-fail">
          {t("refused")}
        </p>
      )}

      <AxleBars axles={axles} tonnes={tonnes} />

      {!hideUnitList && <UnitList load={load} draft={draft} units={units} onEdit={onEdit} />}
    </section>
  );
}

function UnitList({
  load,
  draft,
  units,
  onEdit,
}: {
  load: EditorLoad;
  draft: LoadDraft;
  units: Footprint[];
  onEdit: (next: LoadDraft) => void;
}) {
  const t = useTranslations("Explorer.editor");
  const format = useFormatter();
  const { nameOf } = useReplayText();
  const stackSize = (unit: Footprint) => {
    let size = 1;
    for (let id = unit.carries; id; id = units.find((item) => item.id === id)?.carries ?? null) size += 1;
    return size;
  };
  return (
    <>
      <h3 className="type-label mt-6">{t("units")}</h3>
      <ul className="mt-2 border-b border-hairline">
        {units
          .filter((unit) => !unit.on)
          .map((unit) => {
            const lashed = lashedUnit(units, unit.id);
            const straps = lashed?.straps ?? 0;
            const room = Math.min(strapRoom(load.scenario, unit), 6);
            const name = nameOf(unit.id);
            const stack = stackSize(unit);
            return (
              <li key={unit.id} className="flex min-h-11 items-center gap-3 border-t border-hairline py-1.5">
                <span className="min-w-0 flex-1 truncate text-sm text-ink">
                  {unit.index + 1}. {name}
                  {stack > 1 ? ` ×${stack}` : ""}
                </span>
                <span className="font-mono text-[0.8125rem] text-gray">
                  {format.number(unit.mass * stack, { maximumFractionDigits: 0 })} kg
                </span>
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={t("fewer", { unit: name })}
                    disabled={straps <= 0 || !lashed}
                    onClick={() => lashed && onEdit(setStraps(draft, lashed.id, straps - 1))}
                    className="size-11 rounded-full bg-surface text-ink disabled:opacity-40 sm:size-8"
                  >
                    −
                  </button>
                  <span className="w-20 text-center font-mono text-[0.8125rem] whitespace-nowrap text-ink" aria-live="polite">
                    {t("straps", { count: straps })}
                  </span>
                  <button
                    type="button"
                    aria-label={t("more", { unit: name })}
                    disabled={straps >= room || !lashed}
                    onClick={() => lashed && onEdit(setStraps(draft, lashed.id, straps + 1))}
                    className="size-11 rounded-full bg-surface text-ink disabled:opacity-40 sm:size-8"
                  >
                    +
                  </button>
                </span>
              </li>
            );
          })}
      </ul>
    </>
  );
}

/** Load on each axle group against its legal limit, updated while units move. */
export function AxleBars({ axles, tonnes }: { axles: ReturnType<typeof axleLoads>; tonnes: (kg: number) => string }) {
  const t = useTranslations("Explorer.editor");
  const format = useFormatter();
  if (!axles.length) return null;
  return (
    <div className="mt-5" data-testid="axle-loads">
      <h3 className="type-label">{t("axles")}</h3>
      <ul className="mt-2 space-y-2">
        {axles.map((axle) => {
          const over = axle.ratio > 1;
          const close = axle.ratio > 0.9;
          const color = over ? "bg-fail" : close ? "bg-amber" : "bg-pass";
          return (
            <li key={axle.id} data-axle={axle.id} data-ratio={axle.ratio.toFixed(3)}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-ink">{t("axle", { axle: axle.id })}</span>
                <span className={`font-mono text-[0.8125rem] ${over ? "text-fail" : "text-gray"}`}>
                  {t("axleValue", {
                    load: tonnes(axle.loadKg),
                    limit: format.number(axle.limitKg / 1000, { maximumFractionDigits: 1 }),
                    percent: format.number(axle.ratio, { style: "percent", maximumFractionDigits: 0 }),
                  })}
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface" aria-hidden>
                <div className={`h-full ${color}`} style={{ width: `${Math.min(axle.ratio / 1.25, 1) * 100}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
