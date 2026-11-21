"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useId, useState } from "react";

import { useShownUnits } from "@/components/units-context";
import { DIMENSIONS, type Dimension, type ExplorerConfig, SPEED_MAX, SPEED_MIN } from "@/lib/explorer/config";

const SELECT =
  "h-11 min-w-0 max-w-[62%] rounded-sm border border-control bg-paper px-2 text-[0.9375rem] text-ink sm:h-9";
const RANGE = "block h-11 w-full accent-ink sm:h-8";
const STEPPER =
  "flex size-11 shrink-0 items-center justify-center rounded-full bg-surface font-mono text-base text-ink hover:bg-hairline disabled:pointer-events-none disabled:opacity-50 sm:size-9";

function Field({ label, htmlFor, value, children }: { label: string; htmlFor: string; value?: string; children: ReactNode }) {
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

/** The dimensions a draft from outside cannot change: they would replace its units. */
const LAYOUT: Dimension[] = ["cargo", "position"];

/**
 * One selector per dimension of the load and the trip. Every change rebuilds the load and
 * simulates it again; the speed waits until the slider is let go.
 */
export function Selectors({
  config,
  units,
  massKg,
  origin,
  onChoose,
}: {
  config: ExplorerConfig;
  /** Units on the floor and their mass, as built. */
  units: number | null;
  massKg: number | null;
  origin: "config" | "draft";
  onChoose: <K extends Dimension | "speed_kmh" | "count" | "mass_kg">(dimension: K, value: ExplorerConfig[K]) => void;
}) {
  const t = useTranslations("Explorer");
  const shown = useShownUnits();
  const id = useId();
  const [speed, setSpeed] = useState<number | null>(null);
  const shownSpeed = speed ?? config.speed_kmh;
  const fromOutside = origin === "draft";

  const dimensions = Object.keys(DIMENSIONS) as Dimension[];
  const trip: Dimension[] = ["road", "weather", "event"];

  const select = (dimension: Dimension) => (
    <Field key={dimension} label={t(`dims.${dimension}`)} htmlFor={`${id}-${dimension}`}>
      <select
        id={`${id}-${dimension}`}
        data-testid={`explorer-${dimension}`}
        className={SELECT}
        value={config[dimension]}
        disabled={fromOutside && LAYOUT.includes(dimension)}
        onChange={(event) => onChoose(dimension, event.target.value as ExplorerConfig[typeof dimension])}
      >
        {DIMENSIONS[dimension].map((option) => (
          <option key={option} value={option}>
            {t(`options.${dimension}.${option}` as never)}
          </option>
        ))}
      </select>
    </Field>
  );

  return (
    <section aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="type-label">
        {t("selectors.load")}
      </h2>
      <div className="mt-2 border-b border-hairline">
        {dimensions.filter((dimension) => !trip.includes(dimension)).map(select)}
        {units !== null && !fromOutside && (
          <Field label={t("dims.count")} htmlFor={`${id}-count`}>
            <span className="flex items-center gap-2">
              <button
                type="button"
                className={STEPPER}
                aria-label={t("selectors.fewerUnits")}
                disabled={units <= 1}
                onClick={() => onChoose("count", units - 1)}
              >
                −
              </button>
              <output id={`${id}-count`} className="w-8 text-center font-mono text-[0.9375rem] text-ink">
                {units}
              </output>
              <button
                type="button"
                className={STEPPER}
                aria-label={t("selectors.moreUnits")}
                disabled={units >= 20}
                onClick={() => onChoose("count", units + 1)}
              >
                +
              </button>
            </span>
          </Field>
        )}
        {massKg !== null && !fromOutside && (
          <Field
            label={t("dims.mass")}
            htmlFor={`${id}-mass`}
            value={t("selectors.massValue", { value: shown.mass(massKg) })}
          >
            <input
              id={`${id}-mass`}
              type="range"
              className={RANGE}
              min={Math.max(10, Math.round(massKg / 4 / 10) * 10)}
              max={Math.min(30_000, Math.round((massKg * 2) / 10) * 10)}
              step={10}
              defaultValue={massKg}
              key={massKg}
              onPointerUp={(event) => onChoose("mass_kg", Number(event.currentTarget.value))}
              onKeyUp={(event) => onChoose("mass_kg", Number(event.currentTarget.value))}
            />
          </Field>
        )}
      </div>

      <h2 className="type-label mt-6">{t("selectors.trip")}</h2>
      <div className="mt-2 border-b border-hairline">
        <Field
          label={t("dims.speed")}
          htmlFor={`${id}-speed`}
          value={t("selectors.speedValue", { value: shown.speed(shownSpeed) })}
        >
          <input
            id={`${id}-speed`}
            data-testid="explorer-speed"
            type="range"
            className={RANGE}
            min={SPEED_MIN}
            max={SPEED_MAX}
            step={10}
            value={shownSpeed}
            onChange={(event) => setSpeed(Number(event.target.value))}
            onPointerUp={() => {
              if (speed !== null && speed !== config.speed_kmh) onChoose("speed_kmh", speed);
              setSpeed(null);
            }}
            onKeyUp={() => {
              if (speed !== null && speed !== config.speed_kmh) onChoose("speed_kmh", speed);
              setSpeed(null);
            }}
          />
        </Field>
        {trip.map(select)}
      </div>
      {fromOutside && <p className="type-small mt-3 text-pretty text-gray">{t("selectors.fromOutside")}</p>}
    </section>
  );
}
