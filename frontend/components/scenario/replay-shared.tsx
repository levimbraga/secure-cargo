"use client";

/**
 * What the replay page and the live lab have in common: the wording and number formats of a
 * run, and the small controls around the 3D scene (version and view choice, read-out, timeline,
 * event markers, playback speed, legend, MuJoCo's own render, result rows, findings).
 */

import type { ReactNode, Ref } from "react";
import { useFormatter, useTranslations } from "next-intl";

import { useUnitPlaces } from "@/components/scenario/unit-names";
import { useShownUnits } from "@/components/units-context";
import type { ChartsLabels } from "@/components/scenario/charts";
import type { LabelFormat, ViewMode } from "@/components/scene/keyframe-player";
import type { UnitPanelLabels } from "@/components/scene/unit-panel";
import { DataRow } from "@/components/ui/data-row";
import { pill } from "@/components/ui/pill";
import { type Finding, type RunSummary, unitName, type Variant, VARIANTS } from "@/lib/demo";
import type { KeyframesDoc, Vec3 } from "@/lib/keyframes";
import { GRAVITY, type Speed, SPEEDS } from "@/lib/replay";
import { REPOSITORY_URL } from "@/lib/site";

/** How often the read-outs update while playing; the 3D scene itself runs every frame. */
export const READOUT_INTERVAL_MS = 80;
/** Accelerations below this are shown as "steady". */
export const STEADY_G = 0.02;
export const MODES: ViewMode[] = ["realistic", "engineering"];
/** Phones: the engineering view shows numbered markers and a panel instead of text labels. */
export const COMPACT = "(max-width: 480px)";

const MARKERS = [
  "braking_start",
  "truck_stopped",
  "lane_change_start",
  "lane_change_end",
  "curve_start",
  "curve_end",
  "speed_bump",
  "pothole",
  "vibration_start",
  "pulse_start",
  "segment_mountain_descent",
  "segment_speed_bump",
  "segment_emergency_braking",
  "segment_lane_change",
  "segment_sharp_curve",
  "segment_pothole",
  "segment_long_vibration",
] as const;
type Marker = (typeof MARKERS)[number];

const UNIT_KINDS = ["pallet", "crate", "machine", "stack", "cabinet", "coil", "carton", "sacks", "pipe", "drum", "unit"] as const;
type UnitKind = (typeof UNIT_KINDS)[number];

/** The words and number formats of a run, in the visitor's language. */
export function useReplayText() {
  const t = useTranslations("Scenario");
  const format = useFormatter();

  const number = (value: number, digits = 1) =>
    format.number(value, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const percent = (ratio: number) => format.number(ratio, { style: "percent", maximumFractionDigits: 0 });

  const places = useUnitPlaces();

  function nameOf(unitId: string | null): string {
    const { kind, number: index } = unitName(unitId ?? "");
    const name = (UNIT_KINDS as readonly string[]).includes(kind)
      ? t(`units.${kind as UnitKind}`, { number: index ?? 1 })
      : t("units.other", { id: unitId ?? "" });
    // On a page that knows where the units sit: "Unit 1 (front)", the same in every sentence.
    const place = unitId ? places?.get(unitId) : undefined;
    return place ? t("units.placed", { name, place }) : name;
  }

  /** Formatting used by the labels the 3D scene writes itself. */
  function labelFormat(doc: KeyframesDoc | undefined): LabelFormat {
    return {
      force: (newtons) => `${number(newtons / 10, 0)} daN`,
      ofCapacity: (ratio) => t("labels.ofCapacity", { percent: percent(ratio) }),
      kilonewtons: (newtons) => `${number(newtons / 1000, 1)} kN`,
      inertia: "m·a",
      friction: "μ·N",
      unitMarker: (index) => t("details.open", { unit: nameOf(doc?.units[index]?.id ?? null) }),
    };
  }

  function chartLabels(doc: KeyframesDoc | undefined): ChartsLabels {
    return {
      acceleration: t("charts.acceleration"),
      slide: t("charts.slide"),
      force: t("charts.force"),
      braking: t("charts.braking"),
      sideways: t("charts.sideways"),
      vertical: t("charts.vertical"),
      highest: t("charts.highest"),
      others: t("charts.others"),
      capacity: (daN) => t("charts.capacity", { value: number(daN, 0) }),
      noLashing: t("charts.noLashing"),
      slowMotion: t("charts.slowMotion"),
      time: t("charts.time"),
      table: t("charts.table"),
      unit: (index) => nameOf(doc?.units[index]?.id ?? null),
      number,
    };
  }

  /** Labels of the panel with the numbers of one unit (phone layout of the engineering view). */
  function panelLabels(doc: KeyframesDoc, unitIndex: number): UnitPanelLabels {
    return {
      region: t("details.region", { unit: nameOf(doc.units[unitIndex]?.id ?? null) }),
      title: nameOf(doc.units[unitIndex]?.id ?? null),
      close: t("details.close"),
      inertia: t("details.inertia"),
      friction: t("details.friction"),
      floor: t("details.floor"),
      slide: t("details.slide"),
      lashing: (index) => t("details.lashing", { number: index }),
      tension: (tension, capacity) =>
        capacity === null
          ? t("details.tensionOnly", { force: number(tension / 10, 0) })
          : t("details.tension", {
              force: number(tension / 10, 0),
              capacity: number(capacity / 10, 0),
              percent: percent(tension / capacity),
            }),
      noLashing: t("details.noLashing"),
      kilonewtons: (newtons) => `${number(newtons / 1000, 1)} kN`,
      centimetres: (metres) => `${number(metres * 100, 1)} cm`,
    };
  }

  /** What the truck is doing, from the acceleration of its bed: "0.76 g braking". */
  function truckState([ax, ay, az]: Readonly<Vec3>): string {
    const forward = -ax / GRAVITY;
    const sideways = Math.abs(ay) / GRAVITY;
    const vertical = Math.abs(az) / GRAVITY;
    const largest = Math.max(forward, sideways, vertical);
    if (largest < STEADY_G) return t("hud.steady");
    if (largest === vertical) return t("hud.vertical", { value: number(vertical, 2) });
    if (largest === sideways) return t("hud.sideways", { value: number(sideways, 2) });
    return t("hud.braking", { value: number(forward, 2) });
  }

  /** The EN 12195-1 check in a few words: "not met, 1 of 2 per unit". */
  function standardValue(summary: RunSummary): string {
    const assessed = summary.en_12195_1.filter((check) => check.meets_standard !== null);
    const met = assessed.length > 0 && assessed.every((check) => check.meets_standard);
    // When every unit is under top-over lashing with the same counts, show them.
    const [first] = assessed;
    const uniform =
      first !== undefined &&
      first.required_lashings !== null &&
      assessed.every(
        (check) =>
          check.method === "top_over" &&
          check.installed_lashings === first.installed_lashings &&
          check.required_lashings === first.required_lashings,
      );
    if (uniform && first.required_lashings !== null) {
      return t(met ? "values.metDetail" : "values.notMetDetail", {
        installed: first.installed_lashings,
        required: first.required_lashings,
      });
    }
    return t(met ? "values.met" : "values.notMet");
  }

  function peakAcceleration(summary: RunSummary): string {
    const parts: string[] = [];
    const peak = (key: string) => Number(summary.profile[key] ?? 0);
    if (peak("peak_forward_g") >= STEADY_G) {
      parts.push(t("values.peakForward", { g: number(peak("peak_forward_g"), 2) }));
    }
    if (peak("peak_lateral_g") >= STEADY_G) {
      parts.push(t("values.peakLateral", { g: number(peak("peak_lateral_g"), 2) }));
    }
    if (peak("peak_vertical_g") >= STEADY_G) {
      parts.push(t("values.peakVertical", { g: number(peak("peak_vertical_g"), 2) }));
    }
    return parts.join(" · ") || "–";
  }

  function findingSentence(finding: Finding): string {
    const unit = nameOf(finding.unit_id);
    switch (finding.code) {
      case "unit_slid":
      case "unit_rolled":
        return t(`findings.${finding.code}`, { unit, distance: number(finding.value * 100) });
      case "unit_tilted":
        return t("findings.unit_tilted", { unit, angle: number(finding.value) });
      case "axle_overloaded":
        return t("findings.axle_overloaded", {
          axle: finding.axle_group_id ?? "rear",
          load: number(finding.value / 1000, 2),
          limit: number(finding.limit / 1000, 0),
        });
      case "lashing_overloaded":
        return t("findings.lashing_overloaded", { unit, percent: percent(finding.value / finding.limit) });
      case "headboard_overloaded":
        return t("findings.headboard_overloaded");
      default:
        return t(`findings.${finding.code}`, { unit });
    }
  }

  /** Name of a marker of the event on the timeline. */
  function markerLabel(kind: string): string {
    // A segment of a full trip is "segment:<event>".
    const key = kind.replace(/^segment:/, "segment_");
    return (MARKERS as readonly string[]).includes(key) ? t(`markers.${key as Marker}`) : kind;
  }

  return {
    t,
    format,
    number,
    percent,
    nameOf,
    labelFormat,
    chartLabels,
    panelLabels,
    truckState,
    standardValue,
    peakAcceleration,
    findingSentence,
    markerLabel,
  };
}

/** A unit that fell off the truck needs no separate line for how far it slid or tilted. */
function relevant(findings: Finding[]): Finding[] {
  const fell = new Set(
    findings.filter((finding) => finding.code === "unit_left_bed").map((finding) => finding.unit_id),
  );
  return findings.filter(
    (finding) =>
      !(fell.has(finding.unit_id) && (finding.code === "unit_slid" || finding.code === "unit_tilted")),
  );
}

/** Small text choice: the selected option is ink and underlined, the others gray. */
export function Choice({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`min-h-8 px-1 font-mono text-[0.8125rem] underline-offset-4 ${
        selected ? "text-ink underline decoration-1" : "text-gray hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

/** The two pills "As loaded / Fixed"; the selected one is the primary. */
export function VariantToggle({ variant, onChoose }: { variant: Variant; onChoose: (next: Variant) => void }) {
  const t = useTranslations("Scenario");
  return (
    <div role="group" aria-label={t("variant.label")} className="flex gap-2">
      {VARIANTS.map((name) => (
        <button
          key={name}
          type="button"
          aria-pressed={variant === name}
          onClick={() => onChoose(name)}
          className={pill({ variant: variant === name ? "primary" : "secondary" })}
        >
          {t(`variant.${name}`)}
        </button>
      ))}
    </div>
  );
}

/** The view choice "Realistic / Engineering". */
export function ViewChoice({ mode, onChange }: { mode: ViewMode; onChange: (next: ViewMode) => void }) {
  const t = useTranslations("Scenario");
  return (
    <div role="group" aria-label={t("view.label")} className="flex gap-3">
      {MODES.map((name) => (
        <Choice key={name} selected={mode === name} onSelect={() => onChange(name)}>
          {t(`view.${name}`)}
        </Choice>
      ))}
    </div>
  );
}

/** Speed of the truck and what it is doing, in the corner of the scene. */
export function Hud({
  speedMps,
  bedAccel,
  slow,
  children,
}: {
  speedMps: number;
  bedAccel: Readonly<Vec3>;
  /** The replay is in its slow-motion stretch right now. */
  slow: boolean;
  /** More lines, as `<dd>` elements. */
  children?: ReactNode;
}) {
  const { t, truckState } = useReplayText();
  const units = useShownUnits();
  return (
    <dl className="pointer-events-none absolute top-2 left-2 rounded-sm bg-paper/90 px-2 py-1 font-mono text-[0.75rem] leading-snug text-ink tabular-nums sm:text-[0.8125rem]">
      <dd>{t("hud.speed", { value: units.speed(Math.round(speedMps * 3.6)) })}</dd>
      <dd>{truckState(bedAccel)}</dd>
      {slow && <dd className="text-gray">{t("speed.slow")} 0.25×</dd>}
      {children}
    </dl>
  );
}

/** The play pill: "Play", "Pause", or "Play again" at the end. */
export function PlayButton({
  playing,
  ended,
  disabled,
  onToggle,
  className = "min-w-24",
}: {
  playing: boolean;
  ended: boolean;
  disabled: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const t = useTranslations("Scenario");
  return (
    <button type="button" onClick={onToggle} disabled={disabled} className={pill({ variant: "secondary", className })}>
      {playing ? t("replay.pause") : ended ? t("replay.again") : t("replay.play")}
    </button>
  );
}

/** The time of the replay as a range input, and the clock beside it. */
export function Scrubber({
  time,
  duration,
  disabled,
  onScrub,
}: {
  time: number;
  duration: number;
  disabled: boolean;
  onScrub: (seconds: number) => void;
}) {
  const { t, number } = useReplayText();
  return (
    <>
      <input
        type="range"
        aria-label={t("replay.time")}
        min={0}
        max={duration}
        step={0.01}
        value={Math.min(time, duration)}
        disabled={disabled}
        onChange={(change) => onScrub(Number(change.target.value))}
        className="h-8 min-w-0 flex-1 accent-ink"
      />
      <span className="shrink-0 text-right font-mono text-[0.8125rem] text-gray tabular-nums">
        {t("replay.clock", { now: number(time, 2), total: number(duration, 2) })}
      </span>
    </>
  );
}

/**
 * The markers of the event ("0.3 s · Braking starts"); each one moves the replay to its instant.
 * Before a pothole or a speed bump the driver only slows down: that braking is named so.
 */
export function EventMarkers({ doc, onSeek, event }: { doc: KeyframesDoc | undefined; onSeek: (seconds: number) => void; event?: string }) {
  const { t, number, markerLabel } = useReplayText();
  const slowing = event === "speed_bump" || event === "pothole";
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1">
      {doc?.events.map((marker) => (
        <li key={`${marker.kind}:${marker.t}`}>
          <button
            type="button"
            onClick={() => onSeek(marker.t)}
            className="type-label min-h-8 underline decoration-hairline underline-offset-4 hover:text-ink"
          >
            {number(marker.t, 1)} s · {slowing && marker.kind === "braking_start" ? t(`markers.slowing_${event as "speed_bump" | "pothole"}`) : markerLabel(marker.kind)}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Playback speed: Auto, 1×, 0.5×, 0.25×. */
export function SpeedChoice({ speed, onChange }: { speed: Speed; onChange: (next: Speed) => void }) {
  const t = useTranslations("Scenario");
  const format = useFormatter();
  return (
    <div role="group" aria-label={t("speed.label")} className="flex gap-2">
      {SPEEDS.map((option) => (
        <Choice key={option} selected={speed === option} onSelect={() => onChange(option)}>
          {option === "auto" ? t("speed.auto") : `${format.number(option)}×`}
        </Choice>
      ))}
    </div>
  );
}

export function Swatch({ color }: { color: string }) {
  return <span aria-hidden className="inline-block h-1 w-10 shrink-0 rounded-full" style={{ backgroundColor: color }} />;
}

/** What the arrows and colours in the scene mean. */
export function Legend({ compact, children }: { compact: boolean; children?: ReactNode }) {
  const t = useTranslations("Scenario");
  return (
    <ul className="type-label mt-4 space-y-1.5">
      <li className="flex items-center gap-2">
        <Swatch color="#191918" />
        {t("legend.inertia")}
      </li>
      <li className="flex items-center gap-2">
        <Swatch color="#136f33" />
        {t("legend.friction")} · {t("legend.scale")}
      </li>
      {children}
      <li className="flex items-center gap-2">
        <span
          aria-hidden
          className="inline-block h-1 w-10 shrink-0 rounded-full"
          style={{ background: "linear-gradient(to right, #8a8a86, #f2a100, #b42318)" }}
        />
        {t("legend.tension")}. {compact ? t("legend.hintCompact") : t("legend.hint")}
      </li>
    </ul>
  );
}

/** MuJoCo's own render of a demo run (`/demo/video/<id>.<variant>.mp4`), muted, on the page's clock. */
export function RawVideo({ clip, ref }: { clip: string; ref?: Ref<HTMLVideoElement> }) {
  const t = useTranslations("Scenario");
  return (
    <video
      key={clip}
      ref={ref}
      muted
      playsInline
      preload="metadata"
      poster={`${clip}.jpg`}
      aria-label={t("raw.alt")}
      className="aspect-[16/10] w-full rounded bg-surface object-cover"
    >
      <source src={`${clip}.mp4`} type="video/mp4" />
    </video>
  );
}

/** The numbers of a run as data rows. */
export function ResultRows({ run, event }: { run: RunSummary; event: string }) {
  const { t, number, percent, standardValue, peakAcceleration } = useReplayText();
  return (
    <dl className="mt-4 border-b border-hairline">
      <DataRow label={t("rows.verdict")}>{t(`verdict.${run.verdict.status}`)}</DataRow>
      <DataRow label={t("rows.maxSlide")}>
        {run.units.some((unit) => unit.left_bed)
          ? t("values.leftBed")
          : `${number(run.margins.max_slide_m * 100)} cm`}
      </DataRow>
      <DataRow label={t("rows.maxTilt")}>{number(run.margins.max_tilt_deg)}°</DataRow>
      <DataRow label={t("rows.frictionUse")}>
        {run.margins.peak_friction_use === null ? "–" : percent(run.margins.peak_friction_use)}
      </DataRow>
      <DataRow label={t("rows.peakLashing")}>
        {run.margins.peak_lashing_force_n === null || run.margins.peak_lashing_force_ratio === null
          ? t("values.noLashing")
          : t("values.lashing", {
              force: number(run.margins.peak_lashing_force_n / 10, 0),
              percent: percent(run.margins.peak_lashing_force_ratio),
            })}
      </DataRow>
      <DataRow label={t("rows.standard")}>{standardValue(run)}</DataRow>
      {run.axle_loads.map((axle) => (
        <DataRow
          key={axle.axle_group_id}
          label={axle.axle_group_id === "front" ? t("rows.frontAxle") : t("rows.rearAxle")}
        >
          {t("values.axle", {
            load: number(axle.load_kg / 1000, 2),
            limit: number(axle.limit_kg / 1000, 0),
          })}
        </DataRow>
      ))}
      <DataRow label={t("rows.event")}>{event}</DataRow>
      <DataRow label={t("rows.peak")}>{peakAcceleration(run)}</DataRow>
    </dl>
  );
}

/** "What went wrong": one sentence per finding; nothing when the run has none. */
export function Findings({ run }: { run: RunSummary }) {
  const { t, findingSentence } = useReplayText();
  if (run.verdict.findings.length === 0) return null;
  return (
    <>
      <h2 className="type-card-title mt-12">{t("findings.title")}</h2>
      <ul className="type-body mt-4 space-y-1.5">
        {relevant(run.verdict.findings).map((finding, index) => (
          <li key={index}>{findingSentence(finding)}</li>
        ))}
      </ul>
    </>
  );
}

/** Link to the validation of the physics against EN 12195-1. */
export function MethodLink() {
  const t = useTranslations("Scenario");
  return (
    <p className="type-small mt-10">
      <a
        href={`${REPOSITORY_URL}/blob/main/docs/validation.md`}
        className="text-gray underline decoration-hairline underline-offset-4 hover:text-ink"
      >
        {t("method")}
      </a>
    </p>
  );
}
