"use client";

/**
 * The explorer's list of units under the top view: one row per unit on the floor (a stack is
 * one row), opened to change its cargo, size, weight and straps, to duplicate or remove it; and
 * a row to add units of any cargo, several at once. Every change is an edit of the load draft;
 * the editor simulates it again once the visitor pauses.
 *
 * Sizes and weights are shown and typed in the country's units (feet and pounds in US mode);
 * the draft keeps metres and kilograms. An empty weight is the cargo's usual one.
 */

import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import { useReplayText } from "@/components/scenario/replay-shared";
import { pill } from "@/components/ui/pill";
import { useShownCountry } from "@/components/units-context";
import { CARGOES, MAX_STRAPS_PER_UNIT, type Cargo } from "@/lib/explorer/config";
import { type Footprint, lashedUnit, type LoadDraft, setStraps, strapRoom } from "@/lib/explorer/draft";
import { addUnits, duplicateUnit, MAX_ADD, MAX_UNITS, massOf } from "@/lib/explorer/edit";
import { removeUnit, resizeUnit, ROUND_CARGO, setCargo, setUnit, sizeOf } from "@/lib/inspection/review";
import { FOOT_M, LB_KG } from "@/lib/units";

import { addLashing, lashingsOf, setLashings } from "@/lib/explorer/lashings";

import { LashingList } from "./lashing-list";
import type { EditorLoad } from "./load-editor";

type Refusal = "overlap" | "full" | { added: number; asked: number } | null;

export function UnitPanel({
  load,
  draft,
  units,
  open,
  onOpen,
  onEdit,
}: {
  load: EditorLoad;
  draft: LoadDraft;
  units: Footprint[];
  open: string | null;
  onOpen: (id: string | null) => void;
  onEdit: (next: LoadDraft) => void;
}) {
  const t = useTranslations("Explorer.editor");
  const review = useTranslations("Flow.review");
  const options = useTranslations("Explorer.options");
  const format = useFormatter();
  const { nameOf } = useReplayText();
  const imperial = useShownCountry() === "US";
  const [adding, setAdding] = useState<Cargo>("wood_pallet");
  const [count, setCount] = useState(1);
  const [refused, setRefused] = useState<Refusal>(null);
  const bed = load.scenario.bed;

  const lengthUnit = imperial ? "ft" : "m";
  const weightUnit = imperial ? "lb" : "kg";
  const toLength = (m: number) => Number((imperial ? m / FOOT_M : m).toFixed(2));
  const fromLength = (value: number) => (imperial ? value * FOOT_M : value);
  const toWeight = (kg: number) => Math.round(imperial ? kg / LB_KG : kg);
  const fromWeight = (value: number) => (imperial ? value * LB_KG : value);

  const apply = (next: LoadDraft | null) => {
    setRefused(next ? null : "overlap");
    if (next) onEdit(next);
  };
  const stackOf = (unit: Footprint) => {
    const ids = [unit.id];
    for (let id = unit.carries; id; id = units.find((item) => item.id === id)?.carries ?? null) ids.push(id);
    return ids;
  };
  const totalKg = draft.units.reduce((sum, unit) => sum + massOf(unit), 0);

  return (
    <div className="mt-6" data-testid="unit-panel">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="type-label">{t("units")}</h3>
        <span className="font-mono text-[0.8125rem] text-gray" data-testid="unit-total">
          {t("total", { count: units.length, weight: `${format.number(toWeight(totalKg))} ${weightUnit}` })}
        </span>
      </div>
      <ul className="mt-2 border-b border-hairline">
        {units
          .filter((unit) => !unit.on)
          .map((unit) => {
            const lashed = lashedUnit(units, unit.id);
            const straps = lashed?.straps ?? 0;
            const byHand = Boolean(lashed && draft.units.find((entry) => entry.id === lashed.id)?.lashings);
            // A unit with lashings set by hand: − and + take off or add a strap over the top in its list.
            const strapsTo = (count: number) => {
              if (!lashed) return;
              if (!byHand) {
                onEdit(setStraps(draft, lashed.id, count));
                return;
              }
              const list = lashingsOf(draft, load.scenario, lashed);
              if (count > straps) {
                const next = addLashing(list, load.scenario, lashed, "top_over", "strap");
                if (next) onEdit(setLashings(draft, lashed.id, next));
              } else {
                const last = list.map((item) => item.routing).lastIndexOf("top_over");
                if (last >= 0) onEdit(setLashings(draft, lashed.id, list.filter((_, n) => n !== last)));
              }
            };
            const room = Math.min(strapRoom(load.scenario, unit), MAX_STRAPS_PER_UNIT);
            const name = nameOf(unit.id);
            const stack = stackOf(unit);
            const expanded = open === unit.id;
            const item = draft.units.find((entry) => entry.id === unit.id);
            if (!item) return null;
            const [l, w, h] = sizeOf(item);
            const round = ROUND_CARGO.has(item.cargo);
            return (
              <li key={unit.id} className="border-t border-hairline" data-unit-row={unit.id}>
                <div className="flex min-h-11 items-center gap-3 py-1.5">
                  <button
                    type="button"
                    onClick={() => onOpen(expanded ? null : unit.id)}
                    aria-expanded={expanded}
                    aria-controls={`unit-edit-${unit.id}`}
                    className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left text-sm text-ink sm:min-h-8"
                  >
                    <span aria-hidden className={`text-gray transition-transform ${expanded ? "rotate-90" : ""}`}>
                      ›
                    </span>
                    <span className="truncate">
                      {unit.index + 1}. {name}
                      {stack.length > 1 ? ` ×${stack.length}` : ""}
                    </span>
                  </button>
                  <span className="font-mono text-[0.8125rem] text-gray">
                    {format.number(toWeight(stack.reduce((sum, id) => sum + (units.find((u) => u.id === id)?.mass ?? 0), 0)))} {weightUnit}
                  </span>
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label={t("fewer", { unit: name })}
                      disabled={straps <= 0 || !lashed}
                      onClick={() => strapsTo(straps - 1)}
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
                      onClick={() => strapsTo(straps + 1)}
                      className="size-11 rounded-full bg-surface text-ink disabled:opacity-40 sm:size-8"
                    >
                      +
                    </button>
                  </span>
                </div>
                {expanded && (
                  <div id={`unit-edit-${unit.id}`} className="space-y-4 pb-4 pl-5" data-testid="unit-edit">
                    <label className="block">
                      <span className="type-label">{review("cargo")}</span>
                      <select
                        value={item.cargo}
                        onChange={(event) => apply(setCargo(draft, bed, unit.id, event.target.value as Cargo))}
                        className="mt-1 block h-11 w-full max-w-xs rounded-full border border-control bg-paper px-3 text-sm"
                        data-testid="unit-cargo"
                      >
                        {CARGOES.map((cargo) => (
                          <option key={cargo} value={cargo}>
                            {options(`cargo.${cargo}` as never)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div>
                      <span className="type-label">{review("size")}</span>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {(["length", "width", "height"] as const).map((axis, n) => {
                          const value = [l, w, h][n] as number;
                          const fixed = round && n > 0; // a drum's or a coil's cross-section is fixed
                          return (
                            <label key={axis} className="flex items-center gap-1 text-sm text-gray">
                              {review(axis)}
                              <input
                                type="number"
                                inputMode="decimal"
                                step={imperial ? 0.5 : 0.05}
                                min={0.1}
                                disabled={fixed}
                                defaultValue={toLength(value)}
                                key={`${unit.id}-${axis}-${value}-${imperial}`}
                                onBlur={(event) => {
                                  const typed = Number(event.target.value);
                                  if (!Number.isFinite(typed) || typed <= 0) return;
                                  const size: [number, number, number] = [l, w, h];
                                  size[n] = fromLength(typed);
                                  apply(resizeUnit(draft, bed, unit.id, size));
                                }}
                                className="h-11 w-20 rounded border border-control bg-paper px-2 font-mono text-sm disabled:opacity-50 sm:h-9"
                                data-testid={`unit-${axis}`}
                              />
                              {lengthUnit}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                    <label className="block">
                      <span className="type-label">{review("weight")}</span>
                      <span className="mt-1 flex items-center gap-2">
                        <input
                          type="number"
                          inputMode="numeric"
                          min={1}
                          step={1}
                          placeholder={String(toWeight(unit.mass || massOf(item)))}
                          defaultValue={item.mass_kg ? toWeight(item.mass_kg) : ""}
                          key={`${unit.id}-mass-${item.mass_kg}-${imperial}`}
                          onBlur={(event) => {
                            const typed = event.target.value ? Number(event.target.value) : null;
                            if (typed !== null && (!Number.isFinite(typed) || typed <= 0)) return;
                            const kg = typed === null ? null : Math.round(fromWeight(typed));
                            if (kg !== (item.mass_kg ?? null)) onEdit(setUnit(draft, unit.id, { mass_kg: kg }));
                          }}
                          className="h-11 w-32 rounded border border-control bg-paper px-2 font-mono text-sm sm:h-9"
                          data-testid="unit-weight"
                        />
                        <span className="text-sm text-gray">{weightUnit}</span>
                      </span>
                      {!item.mass_kg && <span className="type-small mt-1 block text-gray">{t("usualWeight")}</span>}
                    </label>
                    {lashed && <LashingList scenario={load.scenario} draft={draft} unit={lashed} onEdit={onEdit} />}
                    <div className="flex flex-wrap gap-x-5 gap-y-2">
                      <button
                        type="button"
                        onClick={() => {
                          const copy = duplicateUnit(draft, bed, unit.id);
                          setRefused(copy ? null : "full");
                          if (copy) {
                            onEdit(copy.draft);
                            onOpen(copy.id);
                          }
                        }}
                        disabled={draft.units.length >= MAX_UNITS}
                        className="min-h-11 text-sm text-ink underline decoration-1 underline-offset-4 disabled:opacity-40 sm:min-h-8"
                        data-testid="unit-duplicate"
                      >
                        {t("duplicate")}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const next = removeUnit(draft, unit.id);
                          if (next) {
                            onOpen(null);
                            onEdit(next);
                          }
                        }}
                        disabled={draft.units.filter((entry) => !entry.on).length <= 1}
                        className="min-h-11 text-sm text-fail underline decoration-1 underline-offset-4 disabled:opacity-40 sm:min-h-8"
                        data-testid="unit-remove"
                      >
                        {stack.length > 1 ? t("removeStack") : review("remove")}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
      </ul>

      <div className="mt-4 flex flex-wrap items-center gap-2" data-testid="unit-add">
        <label className="sr-only" htmlFor="explorer-add-count">
          {t("quantity")}
        </label>
        <select
          id="explorer-add-count"
          value={count}
          onChange={(event) => setCount(Number(event.target.value))}
          className="h-11 rounded-full border border-control bg-paper px-3 font-mono text-sm"
        >
          {Array.from({ length: MAX_ADD }, (_, n) => n + 1).map((n) => (
            <option key={n} value={n}>
              {n} ×
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="explorer-add-cargo">
          {review("cargo")}
        </label>
        <select
          id="explorer-add-cargo"
          value={adding}
          onChange={(event) => setAdding(event.target.value as Cargo)}
          className="h-11 min-w-0 rounded-full border border-control bg-paper px-3 text-sm"
        >
          {CARGOES.map((cargo) => (
            <option key={cargo} value={cargo}>
              {options(`cargo.${cargo}` as never)}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={draft.units.length >= MAX_UNITS}
          onClick={() => {
            const result = addUnits(draft, bed, adding, count);
            if (!result.added.length) {
              setRefused("full");
              return;
            }
            setRefused(result.added.length < count ? { added: result.added.length, asked: count } : null);
            onEdit(result.draft);
            if (result.added.length === 1) onOpen(result.added[0] ?? null);
          }}
          className={pill({ variant: "secondary", className: "h-11 px-4" })}
        >
          {t("add")}
        </button>
      </div>
      {refused && (
        <p role="status" className="type-small mt-2 text-fail">
          {refused === "overlap"
            ? review("refused")
            : refused === "full"
              ? t("full")
              : t("partly", { added: refused.added, asked: refused.asked })}
        </p>
      )}
    </div>
  );
}
