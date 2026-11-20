"use client";

import { type PointerEvent, type ReactNode, useMemo } from "react";

import type { KeyframesDoc } from "@/lib/keyframes";
import { type Series, seriesAt } from "@/lib/replay";

/**
 * Colours of the chart series, in fixed order. Checked with the palette validator of the
 * data-visualization guidelines against the page background (#F8F8F3): lightness band, chroma,
 * colour-blind separation and contrast all pass.
 */
const SERIES_COLORS = ["#3b6fd4", "#c8501e", "#168f7a"] as const;
const NEUTRAL = "#8a8a86";
const INK = "#191918";

/** Plot coordinates: the SVG stretches to the column, so x runs 0..1000 and y 0..100. */
const WIDTH = 1000;
const HEIGHT = 100;
/** Slides beyond this are off the chart [cm]: a unit that left the bed keeps going. */
const SLIDE_CAP_CM = 150;

type Line = { name: string; color: string; values: number[]; width?: number; value: string };
type Reference = { y: number; label: string };

export type ChartsLabels = {
  acceleration: string;
  slide: string;
  force: string;
  braking: string;
  sideways: string;
  vertical: string;
  highest: string;
  others: string;
  capacity: (daN: number) => string;
  noLashing: string;
  slowMotion: string;
  time: string;
  table: string;
  unit: (index: number) => string;
  number: (value: number, digits: number) => string;
};

export type ChartsProps = {
  doc: KeyframesDoc;
  series: Series;
  /** Replay time shown by the cursor [s]. */
  time: number;
  critical: { start: number; end: number } | null;
  onSeek: (seconds: number) => void;
  labels: ChartsLabels;
};

/**
 * Three small charts under the scene, on the same time axis as the replay: what the truck
 * does, how far each unit slides, and what the lashings carry against their capacity. The
 * vertical cursor is the replay clock; dragging on a chart moves it.
 */
export function Charts({ doc, series, time, critical, onSeek, labels }: ChartsProps) {
  const duration = doc.duration_s;
  const at = (values: number[]) => seriesAt(doc, values, time);
  const { number } = labels;

  const acceleration = useMemo(() => {
    const components = [
      { name: labels.braking, values: series.braking },
      { name: labels.sideways, values: series.sideways },
      { name: labels.vertical, values: series.vertical },
    ];
    // Each component keeps its colour whether or not the others are shown.
    return components
      .map((component, index) => ({ ...component, color: SERIES_COLORS[index] ?? NEUTRAL }))
      .filter((component) => component.values.some((value) => Math.abs(value) >= 0.02));
  }, [series, labels.braking, labels.sideways, labels.vertical]);

  const slide = useMemo(
    () =>
      series.slide.map((values, index) => ({
        name: labels.unit(index),
        color: SERIES_COLORS[index] ?? NEUTRAL,
        values: values.map((metres) => Math.min(metres * 100, SLIDE_CAP_CM)),
      })),
    [series, labels],
  );

  const force = useMemo(() => {
    const frames = series.t.length;
    const highest = Array.from({ length: frames }, (_, frame) =>
      Math.max(0, ...series.tension.map((values) => (values[frame] ?? 0) / 10)),
    );
    const capacities = [...new Set(doc.straps.map((strap) => (strap.lashing_capacity_n ?? 0) / 10))]
      .filter((capacity) => capacity > 0)
      .sort((a, b) => a - b);
    return { highest, others: series.tension.map((values) => values.map((newtons) => newtons / 10)), capacities };
  }, [series, doc]);

  const accelerationLines: Line[] = acceleration.map((line) => ({
    ...line,
    value: `${number(at(line.values), 2)} g`,
  }));
  const slideLines: Line[] = slide.map((line) => {
    const centimetres = at(line.values);
    return {
      ...line,
      value: centimetres >= SLIDE_CAP_CM ? `> ${SLIDE_CAP_CM} cm` : `${number(centimetres, 1)} cm`,
    };
  });
  const forceLines: Line[] =
    force.others.length === 0
      ? []
      : [
          ...(force.others.length > 1
            ? force.others.map((values, index) => ({
                name: index === 0 ? labels.others : "",
                color: NEUTRAL,
                values,
                width: 1,
                value: "",
              }))
            : []),
          { name: labels.highest, color: INK, values: force.highest, value: `${number(at(force.highest), 0)} daN` },
        ];

  const shared = { duration, time, critical, onSeek, labels };

  return (
    <div className="space-y-8">
      <Chart title={labels.acceleration} lines={accelerationLines} digits={1} {...shared} />
      <Chart title={labels.slide} lines={slideLines} digits={0} {...shared} />
      {forceLines.length > 0 ? (
        <Chart
          title={labels.force}
          lines={forceLines}
          digits={0}
          references={force.capacities.map((capacity) => ({ y: capacity, label: labels.capacity(capacity) }))}
          {...shared}
        />
      ) : (
        <div>
          <h3 className="type-label">{labels.force}</h3>
          <p className="type-small mt-2 text-gray">{labels.noLashing}</p>
        </div>
      )}

      <details className="type-small">
        <summary className="cursor-pointer text-gray hover:text-ink">{labels.table}</summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse font-mono text-[0.75rem] whitespace-nowrap">
            <thead>
              <tr className="text-left text-gray">
                <th className="py-1 pr-4 font-normal">{labels.time}</th>
                {acceleration.map((line) => (
                  <th key={line.name} className="py-1 pr-4 font-normal">
                    {line.name} (g)
                  </th>
                ))}
                {slide.map((line) => (
                  <th key={line.name} className="py-1 pr-4 font-normal">
                    {line.name} (cm)
                  </th>
                ))}
                {force.others.length > 0 && <th className="py-1 font-normal">{labels.highest} (daN)</th>}
              </tr>
            </thead>
            <tbody>
              {series.t
                .map((_, frame) => frame)
                .filter((frame) => frame % Math.round(doc.fps / 2) === 0)
                .map((frame) => (
                  <tr key={frame} className="border-t border-hairline">
                    <td className="py-1 pr-4">{number(series.t[frame] ?? 0, 1)}</td>
                    {acceleration.map((line) => (
                      <td key={line.name} className="py-1 pr-4">
                        {number(line.values[frame] ?? 0, 2)}
                      </td>
                    ))}
                    {slide.map((line) => (
                      <td key={line.name} className="py-1 pr-4">
                        {number(line.values[frame] ?? 0, 1)}
                      </td>
                    ))}
                    {force.others.length > 0 && <td className="py-1">{number(force.highest[frame] ?? 0, 0)}</td>}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/** A round upper bound for an axis: 1, 1.5, 2, 3, 4, 5 or 8 times a power of ten. */
function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const scaled = value / power;
  const step = [1, 1.5, 2, 3, 4, 5, 8, 10].find((candidate) => scaled <= candidate) ?? 10;
  return step * power;
}

function Chart({
  title,
  lines,
  references = [],
  digits,
  duration,
  time,
  critical,
  onSeek,
  labels,
}: {
  title: string;
  lines: Line[];
  references?: Reference[];
  digits: number;
  duration: number;
  time: number;
  critical: { start: number; end: number } | null;
  onSeek: (seconds: number) => void;
  labels: ChartsLabels;
}) {
  const { top, bottom, paths } = useMemo(() => {
    const all = lines.flatMap((line) => line.values);
    const highest = Math.max(0, ...all, ...references.map((reference) => reference.y));
    const lowest = Math.min(0, ...all);
    const upper = niceCeil(highest * 1.02);
    const lower = lowest < 0 ? -niceCeil(-lowest * 1.02) : 0;
    const y = (value: number) => HEIGHT - ((value - lower) / (upper - lower || 1)) * HEIGHT;
    return {
      top: upper,
      bottom: lower,
      paths: lines.map((line) =>
        line.values
          .map((value, index) => {
            const x = (index / Math.max(line.values.length - 1, 1)) * WIDTH;
            return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y(value).toFixed(2)}`;
          })
          .join(""),
      ),
    };
  }, [lines, references]);

  const yPercent = (value: number) => (1 - (value - bottom) / (top - bottom || 1)) * 100;
  const xPercent = (seconds: number) => (seconds / duration) * 100;

  function seek(event: PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    onSeek(Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1) * duration);
  }

  const legend = lines.filter((line) => line.name);
  const ticks = [top, ...(bottom < 0 ? [0, bottom] : [top / 2, 0])];
  const seconds = Array.from({ length: Math.floor(duration) + 1 }, (_, second) => second);

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="type-label">{title}</h3>
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {legend.map((line) => (
            <li key={line.name} className="flex items-center gap-1.5 text-[0.75rem] text-gray">
              <span aria-hidden className="inline-block h-0.5 w-4 rounded-full" style={{ backgroundColor: line.color }} />
              {line.name}
              {line.value && <span className="font-mono text-ink tabular-nums">{line.value}</span>}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-2 grid grid-cols-[2.75rem_1fr] gap-x-2">
        {/* Y axis: a few round values. */}
        <div className="relative h-28 font-mono text-[0.6875rem] text-gray">
          {ticks.map((tick) => (
            <span key={tick} className="absolute right-0 -translate-y-1/2" style={{ top: `${yPercent(tick)}%` }}>
              {labels.number(tick, tick === Math.round(tick) ? 0 : digits)}
            </span>
          ))}
        </div>
        <div
          className="relative h-28 cursor-ew-resize touch-pan-y select-none"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            seek(event);
          }}
          onPointerMove={(event) => {
            if (event.buttons > 0) seek(event);
          }}
        >
          {/* The stretch the replay plays in slow motion. */}
          {critical && (
            <div
              title={labels.slowMotion}
              className="absolute inset-y-0 bg-surface"
              style={{ left: `${xPercent(critical.start)}%`, width: `${xPercent(critical.end - critical.start)}%` }}
            />
          )}
          {ticks.map((tick) => (
            <div key={tick} className="absolute inset-x-0 border-t border-hairline" style={{ top: `${yPercent(tick)}%` }} />
          ))}
          {references.map((reference) => (
            <Annotation key={reference.label} top={yPercent(reference.y)}>
              {reference.label}
            </Annotation>
          ))}
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            preserveAspectRatio="none"
            className="absolute inset-0 size-full overflow-visible"
            role="img"
            aria-label={title}
          >
            {paths.map((path, index) => (
              <path
                key={index}
                d={path}
                fill="none"
                stroke={lines[index]?.color}
                strokeWidth={lines[index]?.width ?? 2}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
          {/* The replay clock. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 w-px bg-ink"
            style={{ left: `${xPercent(Math.min(time, duration))}%` }}
          />
        </div>
        <div />
        <div className="relative h-4 font-mono text-[0.6875rem] text-gray">
          {seconds.map((second) => (
            <span key={second} className="absolute top-1 -translate-x-1/2" style={{ left: `${xPercent(second)}%` }}>
              {second}
            </span>
          ))}
          <span className="absolute top-1 right-0 translate-x-0 bg-paper pl-1">s</span>
        </div>
      </div>
    </div>
  );
}

/** A reference level across the plot, such as the capacity of a lashing. */
function Annotation({ top, children }: { top: number; children: ReactNode }) {
  return (
    <div className="absolute inset-x-0 border-t border-ink" style={{ top: `${top}%` }}>
      <span className="absolute top-0.5 right-0 bg-paper/85 px-1 font-mono text-[0.6875rem] text-ink">{children}</span>
    </div>
  );
}
