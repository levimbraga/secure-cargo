"use client";

/**
 * Review: the photo with a numbered box over each unit Claude saw, next to the top view of the
 * bed prefilled from the analysis (on phones, two tabs). The user moves, resizes, adds and
 * removes units and straps and sets the weights; what they change is marked as theirs. "Confirm
 * load" waits until every unit has a weight and the weights add up to the cargo weight.
 */

import { useFormatter, useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { LoadEditor } from "@/components/explorer/load-editor";
import { useReplayText } from "@/components/scenario/replay-shared";
import { pill } from "@/components/ui/pill";
import { CARGOES, MAX_STRAPS_PER_UNIT, RESTRAINTS, type Cargo, type Restraint } from "@/lib/explorer/config";
import { footprints, type LoadDraft, strapRoom } from "@/lib/explorer/draft";
import { addUnit, removeUnit, resizeUnit, setCargo, setUnit, sizeOf, splitWeight, weightOf, weightsComplete } from "@/lib/inspection/review";
import type { UnitLink } from "@/lib/inspection/types";
import type { useInspectionFlow } from "@/lib/inspection/use-flow";

import { ErrorLine } from "./steps";

type Flow = ReturnType<typeof useInspectionFlow>;

/** "3 × Steel pipe", or "Mixed load (5 units)". */
export function loadTitle(draft: LoadDraft, cargoName: (cargo: string) => string, mixed: string): string {
  const kinds = new Set(draft.units.map((unit) => unit.cargo));
  const first = draft.units[0];
  if (kinds.size === 1 && first) return `${draft.units.length} × ${cargoName(first.cargo)}`;
  return `${mixed} (${draft.units.length})`;
}

export function ReviewStep({ flow }: { flow: Flow }) {
  const t = useTranslations("Flow");
  const options = useTranslations("Explorer.options");
  const format = useFormatter();
  const { state } = flow;
  const [tab, setTab] = useState<"photo" | "load">("load");
  const [selected, setSelected] = useState<string | null>(null);
  const [photoIndex, setPhotoIndex] = useState(0);
  const draft = state.draft;
  const load = state.load;
  const links = useMemo(() => state.perception?.links ?? [], [state.perception]);
  const numberOf = useMemo(() => {
    const byUnit = new Map(links.map((link) => [link.unit_id, link.number]));
    return (id: string, index: number) => byUnit.get(id) ?? Number(/-(\d+)$/.exec(id)?.[1] ?? index + 1);
  }, [links]);
  if (!draft || !load) return null;

  const total = flow.simulatedKg ?? 0;
  const sum = weightOf(draft);
  const complete = weightsComplete(draft, flow.simulatedKg);
  const warnings = state.perception?.warnings ?? [];

  const select = (id: string) => {
    setSelected(id);
    const link = links.find((item) => item.unit_id === id);
    if (link) setPhotoIndex(Math.min(link.photo, state.photos.length - 1));
  };

  return (
    <section aria-labelledby="review-title">
      <p className="type-label">{t("steps.review")}</p>
      <h1 id="review-title" className="type-hero mt-4 text-balance">
        {t("review.title")}
      </h1>
      <p className="type-body mt-3 text-pretty">{t("review.sentence")}</p>
      {warnings.length > 0 && (
        <ul className="type-small mt-3 space-y-1 text-gray" data-testid="review-warnings">
          {warnings.map((warning) => (
            <li key={warning}>· {t(`warnings.${warning}`)}</li>
          ))}
        </ul>
      )}

      {/* Phones: two tabs. Wide screens: photo and load side by side. */}
      <div className="mt-6 inline-flex rounded-full bg-surface p-1 lg:hidden" role="tablist">
        {(["photo", "load"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={pill({ variant: tab === value ? "primary" : "secondary", className: "h-10 px-5" })}
          >
            {t(`review.tab.${value}`)}
          </button>
        ))}
      </div>

      <div className="mt-6 grid gap-10 lg:grid-cols-2">
        <div className={tab === "photo" ? "" : "max-lg:hidden"}>
          <PhotoOverlay
            photos={state.photos}
            index={photoIndex}
            onIndex={setPhotoIndex}
            links={links}
            selected={selected}
            onSelect={(id) => {
              select(id);
              setTab("load");
            }}
          />
        </div>
        <div className={tab === "load" ? "" : "max-lg:hidden"}>
          <LoadEditor
            load={load}
            draft={draft}
            onEdit={(next) => {
              const moved = next.units.filter((unit) => {
                const before = draft.units.find((item) => item.id === unit.id);
                return before && (before.x_m !== unit.x_m || before.y_m !== unit.y_m);
              });
              flow.edit(next, moved.map((unit) => ({ unit: unit.id, field: "position" })));
            }}
            selected={selected}
            onSelect={select}
            numberOf={(unit) => numberOf(unit.id, unit.index)}
            hideUnitList
          />
          <RestraintChoice draft={draft} onChange={(restraint) => flow.edit({ ...draft, restraint })} />
          <UnitPanel
            flow={flow}
            draft={draft}
            load={load}
            selected={selected}
            onSelect={setSelected}
            numberOf={numberOf}
            links={links}
          />
        </div>
      </div>

      <div className="sticky bottom-0 mt-10 border-t border-hairline bg-paper/95 py-4 backdrop-blur" data-testid="weights-summary">
        <p className={`font-mono text-[0.875rem] ${complete ? "text-pass" : "text-fail"}`}>
          {t("review.weights", {
            sum: format.number(sum, { maximumFractionDigits: 0 }),
            total: format.number(total, { maximumFractionDigits: 0 }),
          })}
        </p>
        {!complete && <p className="type-small mt-1 text-gray">{t("review.weightsMissing")}</p>}
        <div className="mt-3 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={!complete || state.busy !== null}
            onClick={() => void flow.confirm(loadTitle(draft, (cargo) => options(`cargo.${cargo}` as never), t("review.mixed")))}
            className={pill({ className: "h-12 px-6" })}
            data-testid="confirm-load"
          >
            {t("review.confirm")}
          </button>
          {!complete && total > 0 && (
            <button type="button" onClick={() => flow.edit(splitWeight(draft, total))} className={pill({ variant: "secondary", className: "h-12 px-5" })}>
              {t("review.split")}
            </button>
          )}
          <button type="button" onClick={() => flow.goTo("result")} className={pill({ variant: "secondary", className: "h-12 px-5" })}>
            {t("back")}
          </button>
        </div>
        <ErrorLine code={state.error} />
      </div>
    </section>
  );
}

function PhotoOverlay({
  photos,
  index,
  onIndex,
  links,
  selected,
  onSelect,
}: {
  photos: { url: string; width: number; height: number }[];
  index: number;
  onIndex: (index: number) => void;
  links: UnitLink[];
  selected: string | null;
  onSelect: (unitId: string) => void;
}) {
  const t = useTranslations("Flow");
  const photo = photos[index] ?? photos[0];
  if (!photo) return <p className="type-small text-gray">{t("review.noPhoto")}</p>;
  const shown = links.filter((link) => link.photo === index);
  return (
    <figure>
      <div className="relative overflow-hidden rounded bg-surface" data-testid="photo-overlay">
        {/* eslint-disable-next-line @next/next/no-img-element -- the user's photo or a processed sample */}
        <img src={photo.url} alt={t("photos.alt", { number: index + 1 })} width={photo.width} height={photo.height} className="block h-auto w-full" />
        {shown.map((link) => {
          const [x0, y0, x1, y1] = link.box;
          if (x1 <= x0 || y1 <= y0) return null;
          const active = selected === link.unit_id;
          return (
            <button
              key={link.number}
              type="button"
              onClick={() => onSelect(link.unit_id)}
              aria-label={t("review.unitOnPhoto", { number: link.number })}
              className={`absolute border-2 ${active ? "border-amber bg-amber/20" : "border-paper/90 bg-ink/10"}`}
              style={{ left: `${x0 * 100}%`, top: `${y0 * 100}%`, width: `${(x1 - x0) * 100}%`, height: `${(y1 - y0) * 100}%` }}
            >
              <span className={`absolute top-0 left-0 inline-flex size-7 items-center justify-center text-[0.8125rem] font-medium ${active ? "bg-amber text-ink" : "bg-ink text-paper"}`}>
                {link.number}
              </span>
            </button>
          );
        })}
      </div>
      <figcaption className="type-small mt-2 text-gray">{t("review.photoHint")}</figcaption>
      {photos.length > 1 && (
        <div className="mt-3 flex gap-2">
          {photos.map((item, n) => (
            <button key={item.url} type="button" aria-pressed={n === index} onClick={() => onIndex(n)} className={`size-14 overflow-hidden rounded ${n === index ? "ring-2 ring-ink" : "opacity-70"}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- thumbnail */}
              <img src={item.url} alt={t("photos.alt", { number: n + 1 })} className="size-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </figure>
  );
}

function RestraintChoice({ draft, onChange }: { draft: LoadDraft; onChange: (restraint: Restraint) => void }) {
  const t = useTranslations("Flow");
  const options = useTranslations("Explorer.options");
  return (
    <div className="mt-6">
      <label htmlFor="restraint" className="type-label">
        {t("review.restraint")}
      </label>
      <select
        id="restraint"
        value={draft.restraint}
        onChange={(event) => onChange(event.target.value as Restraint)}
        className="mt-2 block h-11 w-full max-w-xs rounded-full border border-control bg-paper px-3 text-sm"
      >
        {RESTRAINTS.map((restraint) => (
          <option key={restraint} value={restraint}>
            {options(`restraint.${restraint}` as never)}
          </option>
        ))}
      </select>
    </div>
  );
}

function Mark({ confirmed, confidence }: { confirmed: boolean; confidence: number | null }) {
  const t = useTranslations("Flow");
  return confirmed ? (
    <span className="ml-2 rounded-full bg-pass-tint px-2 py-0.5 text-[0.75rem] text-pass">{t("review.yours")}</span>
  ) : confidence !== null ? (
    <span className="ml-2 rounded-full bg-surface px-2 py-0.5 text-[0.75rem] text-gray">{t("review.ai", { percent: Math.round(confidence * 100) })}</span>
  ) : null;
}

function UnitPanel({
  flow,
  draft,
  load,
  selected,
  onSelect,
  numberOf,
  links,
}: {
  flow: Flow;
  draft: LoadDraft;
  load: NonNullable<Flow["state"]["load"]>;
  selected: string | null;
  onSelect: (id: string | null) => void;
  numberOf: (id: string, index: number) => number;
  links: UnitLink[];
}) {
  const t = useTranslations("Flow");
  const options = useTranslations("Explorer.options");
  const { nameOf } = useReplayText();
  const [adding, setAdding] = useState<Cargo>("wood_pallet");
  const [refused, setRefused] = useState(false);
  const bed = load.scenario.bed;
  const units = footprints(draft, load.scenario);
  const confirmed = flow.state.confirmed;
  const mark = (id: string, field: string) => (confirmed[id] ?? []).includes(field);

  const apply = (next: LoadDraft | null, unit: string, field: string) => {
    setRefused(next === null);
    if (next) flow.edit(next, [{ unit, field }]);
  };

  return (
    <div className="mt-8">
      <h3 className="type-label">{t("review.units")}</h3>
      <ul className="mt-2 border-b border-hairline" data-testid="unit-panel">
        {draft.units.map((unit, index) => {
          const open = selected === unit.id;
          const link = links.find((item) => item.unit_id === unit.id);
          const [l, w, h] = sizeOf(unit);
          const footprint = units.find((item) => item.id === unit.id);
          const room = footprint ? Math.min(strapRoom(load.scenario, footprint), MAX_STRAPS_PER_UNIT) : 0;
          const carried = draft.units.some((item) => item.on === unit.id);
          return (
            <li key={unit.id} className="border-t border-hairline" data-unit-row={unit.id}>
              <button type="button" onClick={() => onSelect(open ? null : unit.id)} aria-expanded={open} className="flex min-h-12 w-full items-center gap-3 py-2 text-left">
                <span className="inline-flex size-7 items-center justify-center bg-ink font-mono text-[0.8125rem] text-paper">{numberOf(unit.id, index)}</span>
                <span className="min-w-0 flex-1 truncate text-ink">
                  {options(`cargo.${unit.cargo}` as never)}
                  {unit.on && ` · ${t("review.onTopOf", { unit: nameOf(unit.on) })}`}
                </span>
                <span className={`font-mono text-[0.8125rem] ${unit.mass_kg ? "text-gray" : "text-fail"}`}>
                  {unit.mass_kg ? `${Math.round(unit.mass_kg)} kg` : t("review.noWeight")}
                </span>
              </button>
              {open && (
                <div className="space-y-4 pb-4">
                  {link?.uncertain && <p className="type-small text-gray">{t("review.uncertain", { note: link.uncertain })}</p>}
                  <label className="block">
                    <span className="type-label">
                      {t("review.cargo")}
                      <Mark confirmed={mark(unit.id, "cargo")} confidence={link?.confidence ?? null} />
                    </span>
                    <select
                      value={unit.cargo}
                      onChange={(event) => apply(setCargo(draft, bed, unit.id, event.target.value as Cargo), unit.id, "cargo")}
                      className="mt-1 block h-11 w-full max-w-xs rounded-full border border-control bg-paper px-3 text-sm"
                    >
                      {CARGOES.map((cargo) => (
                        <option key={cargo} value={cargo}>
                          {options(`cargo.${cargo}` as never)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div>
                    <span className="type-label">
                      {t("review.size")}
                      <Mark confirmed={mark(unit.id, "size")} confidence={link?.confidence ?? null} />
                    </span>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {(["length", "width", "height"] as const).map((axis, n) => (
                        <label key={axis} className="flex items-center gap-1 text-sm text-gray">
                          {t(`review.${axis}`)}
                          <input
                            type="number"
                            inputMode="decimal"
                            step={0.05}
                            min={0.1}
                            defaultValue={[l, w, h][n]}
                            key={`${unit.id}-${axis}-${[l, w, h][n]}`}
                            onBlur={(event) => {
                              const value = Number(event.target.value);
                              if (!Number.isFinite(value) || value <= 0) return;
                              const size: [number, number, number] = [l, w, h];
                              size[n] = value;
                              apply(resizeUnit(draft, bed, unit.id, size), unit.id, "size");
                            }}
                            className="h-11 w-20 rounded border border-control bg-paper px-2 font-mono text-sm sm:h-9"
                          />
                          m
                        </label>
                      ))}
                    </div>
                  </div>
                  <label className="block">
                    <span className="type-label">
                      {t("review.weight")}
                      <Mark confirmed={mark(unit.id, "weight")} confidence={null} />
                    </span>
                    <span className="mt-1 flex items-center gap-2">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        step={1}
                        value={unit.mass_kg ?? ""}
                        onChange={(event) =>
                          apply(setUnit(draft, unit.id, { mass_kg: event.target.value ? Number(event.target.value) : null }), unit.id, "weight")
                        }
                        className="h-11 w-32 rounded border border-control bg-paper px-2 font-mono text-sm sm:h-9"
                        data-testid="unit-weight"
                      />
                      <span className="text-sm text-gray">kg</span>
                    </span>
                  </label>
                  {!unit.on || !carried ? (
                    <div>
                      <span className="type-label">
                        {t("review.straps")}
                        <Mark confirmed={mark(unit.id, "straps")} confidence={link?.confidence ?? null} />
                      </span>
                      <span className="mt-1 flex items-center gap-2">
                        <button
                          type="button"
                          disabled={unit.straps <= 0}
                          onClick={() => apply(setUnit(draft, unit.id, { straps: unit.straps - 1 }), unit.id, "straps")}
                          className="size-11 rounded-full bg-surface text-ink disabled:opacity-40"
                          aria-label={t("review.fewerStraps")}
                        >
                          −
                        </button>
                        <span className="w-10 text-center font-mono text-sm">{unit.straps}</span>
                        <button
                          type="button"
                          disabled={unit.straps >= room}
                          onClick={() => apply(setUnit(draft, unit.id, { straps: unit.straps + 1 }), unit.id, "straps")}
                          className="size-11 rounded-full bg-surface text-ink disabled:opacity-40"
                          aria-label={t("review.moreStraps")}
                        >
                          +
                        </button>
                        <span className="type-small text-gray">{t("review.strapRoom", { room })}</span>
                      </span>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      const next = removeUnit(draft, unit.id);
                      if (next) {
                        onSelect(null);
                        flow.edit(next);
                      }
                    }}
                    disabled={draft.units.length <= 1}
                    className="text-sm text-fail underline decoration-1 underline-offset-4 disabled:opacity-40"
                  >
                    {t("review.remove")}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="add-cargo">
          {t("review.cargo")}
        </label>
        <select
          id="add-cargo"
          value={adding}
          onChange={(event) => setAdding(event.target.value as Cargo)}
          className="h-11 rounded-full border border-control bg-paper px-3 text-sm"
        >
          {CARGOES.map((cargo) => (
            <option key={cargo} value={cargo}>
              {options(`cargo.${cargo}` as never)}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => {
            const next = addUnit(draft, bed, adding);
            setRefused(next === null);
            if (next) {
              const added = next.units[next.units.length - 1];
              flow.edit(next, added ? [{ unit: added.id, field: "cargo" }] : []);
              if (added) onSelect(added.id);
            }
          }}
          className={pill({ variant: "secondary", className: "h-11 px-4" })}
        >
          {t("review.add")}
        </button>
      </div>
      {refused && (
        <p role="status" className="type-small mt-2 text-fail">
          {t("review.refused")}
        </p>
      )}
    </div>
  );
}
