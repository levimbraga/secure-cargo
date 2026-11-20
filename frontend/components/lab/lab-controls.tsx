"use client";

import { type ReactNode, useId, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";

import { type LabControls, MASS_FACTOR_RANGE, PRETENSION_RANGE, SPEED_RANGE } from "@/lib/live/controls";
import { EVENT_KINDS, type EventKind, ROAD_SURFACES, type RoadSurface } from "@/lib/live/scenario";
import type { LabLimits } from "@/lib/live/use-live-lab";

/** Pretension a strap gets when the load as authored has none to copy [N] (`DEFAULT_STRAP` in controls.ts). */
const DEFAULT_PRETENSION_N = 3000;

const SELECT =
  "h-11 min-w-0 max-w-[60%] rounded-sm border border-control bg-paper px-2 text-[0.9375rem] text-ink sm:h-9";
const STEPPER =
  "flex size-11 shrink-0 items-center justify-center rounded-full bg-surface font-mono text-base text-ink hover:bg-hairline disabled:pointer-events-none disabled:opacity-50 sm:size-9";

/** One control: gray label and the current value on a line, hairline above. */
function Field({
  label,
  htmlFor,
  value,
  children,
}: {
  label: string;
  htmlFor: string;
  /** The current value in words, when the control does not show it itself (a slider). */
  value?: string;
  children: ReactNode;
}) {
  return (
    <div className="border-t border-hairline py-1.5">
      <div className="flex min-h-11 items-center justify-between gap-4 sm:min-h-9">
        <label htmlFor={htmlFor} className="text-[0.9375rem] text-gray">
          {label}
        </label>
        {value === undefined ? (
          children
        ) : (
          <output htmlFor={htmlFor} className="text-right font-mono text-[0.9375rem] text-ink tabular-nums">
            {value}
          </output>
        )}
      </div>
      {value !== undefined && children}
    </div>
  );
}

const RANGE = "block h-11 w-full accent-ink disabled:opacity-50 sm:h-8";

/**
 * The controls of the live lab. Every change is applied at once (`onChange`), and the lab
 * simulates the load again. A control set back to the value the load was authored with counts
 * as unchanged, so the scenario as authored (and its raw MuJoCo render) comes back.
 */
export function LabControlsPanel({
  controls,
  limits,
  authored,
  onChange,
  onReset,
}: {
  controls: LabControls;
  limits: LabLimits;
  authored: boolean;
  onChange: (change: Partial<LabControls>) => void;
  onReset: () => void;
}) {
  const t = useTranslations("Lab");
  const format = useFormatter();
  const id = useId();
  // What is typed in the strap field while it is not a number yet (empty, for example).
  const [strapDraft, setStrapDraft] = useState<string | null>(null);

  const straps = controls.strapsPerUnit ?? limits.authoredStraps;
  const setStraps = (count: number) => {
    const next = Math.min(Math.max(Math.round(count), 0), limits.maxStraps);
    onChange({ strapsPerUnit: next === limits.authoredStraps ? null : next });
  };

  const pretension = controls.pretensionN ?? limits.authoredPretension;
  // No top-over lashing on the load: there is nothing to tension.
  const noStraps = straps === 0;
  const shownPretension = pretension ?? DEFAULT_PRETENSION_N;

  const [firstMass] = limits.unitMassesKg;
  const sameMass = firstMass !== undefined && limits.unitMassesKg.every((mass) => mass === firstMass);
  const massValue = sameMass
    ? t("controls.massValue", { value: format.number(Math.round(firstMass * controls.massFactor * 10) / 10) })
    : t("controls.massFactor", {
        value: format.number(controls.massFactor, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
      });

  const mat = controls.antiSlipMat ?? limits.authoredMat;

  return (
    <section aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="type-card-title">
        {t("controls.title")}
      </h2>
      <p className="type-small mt-1.5 text-gray">{t("controls.hint")}</p>

      <div className="mt-3 border-b border-hairline">
        <Field label={t("controls.event")} htmlFor={`${id}-event`}>
          <select
            id={`${id}-event`}
            data-testid="lab-event"
            value={controls.event}
            onChange={(change) => onChange({ event: change.target.value as EventKind })}
            className={SELECT}
          >
            {EVENT_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t(`events.${kind}`)}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label={t("controls.speed")}
          htmlFor={`${id}-speed`}
          value={t("controls.speedValue", { value: format.number(controls.speedKmh) })}
        >
          <input
            id={`${id}-speed`}
            data-testid="lab-speed"
            type="range"
            min={SPEED_RANGE.min}
            max={SPEED_RANGE.max}
            step={SPEED_RANGE.step}
            value={controls.speedKmh}
            onChange={(change) => onChange({ speedKmh: Number(change.target.value) })}
            className={RANGE}
          />
        </Field>

        <Field label={t("controls.surface")} htmlFor={`${id}-surface`}>
          <select
            id={`${id}-surface`}
            data-testid="lab-surface"
            value={controls.surface}
            onChange={(change) => onChange({ surface: change.target.value as RoadSurface })}
            className={SELECT}
          >
            {ROAD_SURFACES.map((surface) => (
              <option key={surface} value={surface}>
                {t(`surfaces.${surface}`)}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("controls.straps")} htmlFor={`${id}-straps`}>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label={t("controls.fewer")}
              disabled={straps !== null && straps <= 0}
              onClick={() => setStraps((straps ?? 1) - 1)}
              className={STEPPER}
            >
              −
            </button>
            <input
              id={`${id}-straps`}
              data-testid="lab-straps"
              type="number"
              inputMode="numeric"
              min={0}
              max={limits.maxStraps}
              step={1}
              placeholder={t("controls.strapsAsLoaded")}
              value={strapDraft ?? (straps === null ? "" : String(straps))}
              onChange={(change) => {
                const typed = change.target.value;
                const count = Number(typed);
                if (typed.trim() === "" || !Number.isFinite(count)) {
                  setStrapDraft(typed);
                  return;
                }
                setStrapDraft(null);
                setStraps(count);
              }}
              onBlur={() => setStrapDraft(null)}
              className="h-11 w-16 rounded-sm border border-control bg-paper px-1 text-center font-mono text-[0.9375rem] text-ink tabular-nums placeholder:text-[0.75rem] placeholder:text-gray sm:h-9"
            />
            <button
              type="button"
              aria-label={t("controls.more")}
              disabled={straps !== null && straps >= limits.maxStraps}
              onClick={() => setStraps((straps ?? 0) + 1)}
              className={STEPPER}
            >
              +
            </button>
          </div>
        </Field>

        <Field
          label={t("controls.pretension")}
          htmlFor={`${id}-pretension`}
          value={
            noStraps
              ? t("controls.pretensionNone")
              : pretension === null && limits.authoredStraps !== 0
                ? // Lashings with different pretensions: they stay as they are until the slider moves.
                  t("controls.strapsAsLoaded")
                : t("controls.pretensionValue", { value: format.number(Math.round(shownPretension / 10)) })
          }
        >
          <input
            id={`${id}-pretension`}
            data-testid="lab-pretension"
            type="range"
            min={PRETENSION_RANGE.min / 10}
            max={PRETENSION_RANGE.max / 10}
            step={PRETENSION_RANGE.step / 10}
            value={Math.min(Math.max(shownPretension, PRETENSION_RANGE.min), PRETENSION_RANGE.max) / 10}
            disabled={noStraps}
            onChange={(change) => {
              const newtons = Number(change.target.value) * 10;
              onChange({ pretensionN: newtons === limits.authoredPretension ? null : newtons });
            }}
            className={RANGE}
          />
        </Field>

        <Field label={t("controls.mass")} htmlFor={`${id}-mass`} value={massValue}>
          <input
            id={`${id}-mass`}
            data-testid="lab-mass"
            type="range"
            min={MASS_FACTOR_RANGE.min}
            max={MASS_FACTOR_RANGE.max}
            step={MASS_FACTOR_RANGE.step}
            value={controls.massFactor}
            onChange={(change) => onChange({ massFactor: Math.round(Number(change.target.value) * 10) / 10 })}
            className={RANGE}
          />
        </Field>

        <Field label={t("controls.mat")} htmlFor={`${id}-mat`}>
          <span className="flex items-center gap-2">
            <span aria-hidden className="font-mono text-[0.9375rem] text-ink">
              {mat ? t("controls.matOn") : t("controls.matOff")}
            </span>
            <span className="flex size-11 items-center justify-center sm:size-9">
              <input
                id={`${id}-mat`}
                data-testid="lab-mat"
                type="checkbox"
                checked={mat}
                onChange={(change) =>
                  onChange({ antiSlipMat: change.target.checked === limits.authoredMat ? null : change.target.checked })
                }
                className="size-5 accent-ink"
              />
            </span>
          </span>
        </Field>
      </div>

      {!authored && (
        <button
          type="button"
          onClick={onReset}
          className="mt-3 min-h-11 text-left text-sm text-gray underline decoration-hairline underline-offset-4 hover:text-ink sm:min-h-8"
        >
          {t("reset")}
        </button>
      )}
    </section>
  );
}
