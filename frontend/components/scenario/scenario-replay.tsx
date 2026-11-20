"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";

import { Charts, type ChartsLabels } from "@/components/scenario/charts";
import { ReplayBoundary, supportsWebGL } from "@/components/scenario/replay-boundary";
import type { CameraView, LabelFormat, ViewMode } from "@/components/scene/keyframe-player";
import { DataRow } from "@/components/ui/data-row";
import { pill } from "@/components/ui/pill";
import { SectionLabel } from "@/components/ui/section-label";
import { VerdictBadge } from "@/components/ui/verdict-badge";
import {
  type DemoId,
  fetchKeyframes,
  type Finding,
  type RunSummary,
  type TripEvent,
  unitName,
  type Variant,
  VARIANTS,
} from "@/lib/demo";
import { type KeyframesDoc, sampleFrame } from "@/lib/keyframes";
import {
  buildSeries,
  criticalWindow,
  GRAVITY,
  headboardImpacts,
  playbackRate,
  type Speed,
  SPEEDS,
} from "@/lib/replay";
import { REPOSITORY_URL } from "@/lib/site";

// three.js is only needed once the replay is on screen, and never on the server.
const KeyframePlayer = dynamic(() => import("@/components/scene/keyframe-player"), { ssr: false });

/** How often the read-outs update while playing; the 3D scene itself runs every frame. */
const READOUT_INTERVAL_MS = 80;
/** Accelerations below this are shown as "steady". */
const STEADY_G = 0.02;
const MODES: ViewMode[] = ["realistic", "engineering"];

/** Sideways events read best from behind the truck; the others from its side. */
const VIEW: Record<DemoId, CameraView> = {
  "emergency-braking": "hero",
  "weigh-station": "hero",
  "rope-lashing": "rear",
  "sharp-curve": "rear",
};

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
] as const;
type Marker = (typeof MARKERS)[number];

const UNIT_KINDS = ["pallet", "crate", "machine", "stack", "cabinet"] as const;
type UnitKind = (typeof UNIT_KINDS)[number];

export type ScenarioReplayProps = {
  id: DemoId;
  event: TripEvent;
  runs: Record<Variant, RunSummary>;
};

/** Small text choice: the selected option is ink and underlined, the others gray. */
function Choice({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
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

/**
 * One demo scenario: the sentence that answers "is it safe?", a toggle between the load as it
 * arrived and the fixed one, the replay of the simulation (3D scene, MuJoCo's own render and
 * charts on one clock), and the numbers of the run.
 */
export function ScenarioReplay({ id, event, runs }: ScenarioReplayProps) {
  const t = useTranslations("Scenario");
  const format = useFormatter();

  const [variant, setVariant] = useState<Variant>("as_loaded");
  const [mode, setMode] = useState<ViewMode>("realistic");
  const [speed, setSpeed] = useState<Speed>("auto");
  const [docs, setDocs] = useState<Partial<Record<Variant, KeyframesDoc>>>({});
  const [failed, setFailed] = useState(false);
  // Unknown until the page runs in a browser; then whether it can draw 3D at all.
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [visible, setVisible] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [shownTime, setShownTime] = useState(0);
  const time = useRef(0);
  const started = useRef(false);
  const loaded = useRef(false);
  const onScreen = useRef(false);
  const frame = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);

  const run = runs[variant];
  const doc = docs[variant];
  const duration = doc?.duration_s ?? run.duration_s;
  const derived = useMemo(
    () => (doc ? { series: buildSeries(doc), impacts: headboardImpacts(doc), critical: criticalWindow(doc) } : null),
    [doc],
  );
  const critical = derived?.critical ?? null;

  // The replay starts by itself the first time it is both loaded and on screen, unless the
  // visitor asked for less motion.
  const startOnce = () => {
    if (started.current || !loaded.current || !onScreen.current) return;
    started.current = true;
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) setPlaying(true);
  };
  const start = useRef(startOnce);
  useEffect(() => {
    start.current = startOnce;
  });

  // Fetch both versions once, so switching between them is instant.
  useEffect(() => {
    const controller = new AbortController();
    Promise.all(VARIANTS.map((name) => fetchKeyframes(id, name, controller.signal))).then(
      ([asLoaded, fixed]) => {
        setWebgl(supportsWebGL());
        setDocs({ as_loaded: asLoaded, fixed });
        loaded.current = true;
        start.current();
      },
      () => {
        if (!controller.signal.aborted) setFailed(true);
      },
    );
    return () => controller.abort();
  }, [id]);

  // The scene only renders frames while it is on screen.
  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        onScreen.current = Boolean(entry?.isIntersecting);
        setVisible(onScreen.current);
        start.current();
      },
      { threshold: 0.35 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // The clock of the replay. The scene reads `time` every frame; React state follows slowly.
  useEffect(() => {
    if (!playing) {
      video.current?.pause();
      return;
    }
    let request = 0;
    let previous = performance.now();
    let lastReadout = 0;
    void video.current?.play().catch(() => undefined);
    const tick = (now: number) => {
      const rate = playbackRate(speed, time.current, critical);
      time.current = Math.min(time.current + Math.min((now - previous) / 1000, 0.1) * rate, duration);
      previous = now;
      const ended = time.current >= duration;
      if (ended || now - lastReadout > READOUT_INTERVAL_MS) {
        lastReadout = now;
        setShownTime(time.current);
        // MuJoCo's own render runs on the same clock.
        const clip = video.current;
        if (clip) {
          clip.playbackRate = rate;
          if (Math.abs(clip.currentTime - time.current) > 0.2) clip.currentTime = time.current;
        }
      }
      if (ended) setPlaying(false);
      else request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [playing, duration, speed, critical]);

  function seek(seconds: number) {
    time.current = seconds;
    setShownTime(seconds);
    if (video.current) video.current.currentTime = seconds;
  }

  function scrub(seconds: number) {
    setPlaying(false);
    seek(seconds);
  }

  function choose(next: Variant) {
    if (next === variant) return;
    setVariant(next);
    seek(0);
    setPlaying(Boolean(docs[next]));
  }

  function togglePlay() {
    if (!playing && shownTime >= duration) seek(0);
    setPlaying(!playing);
  }

  const number = (value: number, digits = 1) =>
    format.number(value, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const percent = (ratio: number) => format.number(ratio, { style: "percent", maximumFractionDigits: 0 });

  function nameOf(unitId: string | null): string {
    const { kind, number: index } = unitName(unitId ?? "");
    return (UNIT_KINDS as readonly string[]).includes(kind)
      ? t(`units.${kind as UnitKind}`, { number: index ?? 1 })
      : t("units.other", { id: unitId ?? "" });
  }

  // Formatting used by the labels the 3D scene writes itself.
  const labelFormat: LabelFormat = {
    force: (newtons) => `${number(newtons / 10, 0)} daN`,
    ofCapacity: (ratio) => t("labels.ofCapacity", { percent: percent(ratio) }),
    kilonewtons: (newtons) => `${number(newtons / 1000, 1)} kN`,
    inertia: "m·a",
    friction: "μ·N",
  };
  const chartLabels: ChartsLabels = {
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

  const status = run.verdict.status;
  const sample = doc ? sampleFrame(doc, shownTime) : undefined;
  const slowNow = speed === "auto" && critical !== null && playbackRate(speed, shownTime, critical) < 1;
  const clip = `/demo/video/${id}.${variant}`;
  const rawVideo = (
    <video
      key={clip}
      ref={video}
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
  // Without WebGL the engine's own video takes the place of the 3D scene.
  const showScene = Boolean(doc && derived && webgl);
  const sceneFallback = (text: string) =>
    webgl === false || failed ? (
      <div className="absolute inset-0">
        {rawVideo}
        <p className="type-label absolute inset-x-0 bottom-0 bg-paper/85 px-3 py-2">{text}</p>
      </div>
    ) : (
      <p className="type-label absolute inset-0 flex items-center justify-center px-6 text-center">{text}</p>
    );

  return (
    <section>
      <SectionLabel>
        {t("label")} · {t(`titles.${id}`)}
      </SectionLabel>
      <div aria-live="polite">
        <h1 className="type-hero mt-5 text-balance">{t(`sentences.${id}.${variant}`)}</h1>
        <VerdictBadge verdict={status === "pass" ? "pass" : "fail"} className="mt-4">
          {t(`verdict.${status}`)}
        </VerdictBadge>
      </div>
      <p className="type-body mt-5 text-pretty">{t(`explanations.${id}.${variant}`)}</p>

      <div className="mt-7 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div role="group" aria-label={t("variant.label")} className="flex gap-2">
          {VARIANTS.map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={variant === name}
              onClick={() => choose(name)}
              className={pill({ variant: variant === name ? "primary" : "secondary" })}
            >
              {t(`variant.${name}`)}
            </button>
          ))}
        </div>
        <div role="group" aria-label={t("view.label")} className="flex gap-3">
          {MODES.map((name) => (
            <Choice key={name} selected={mode === name} onSelect={() => setMode(name)}>
              {t(`view.${name}`)}
            </Choice>
          ))}
        </div>
      </div>

      <figure className="mt-4">
        <div
          ref={frame}
          role="img"
          aria-label={t("replay.label")}
          className="relative aspect-[4/3] w-full overflow-hidden rounded bg-surface sm:aspect-[16/10]"
        >
          {showScene && doc && derived ? (
            <ReplayBoundary fallback={sceneFallback(t("replay.unsupported"))}>
              <KeyframePlayer
                doc={doc}
                series={derived.series}
                impacts={derived.impacts}
                time={time}
                mode={mode}
                view={VIEW[id]}
                overlay={overlay}
                format={labelFormat}
                active={visible}
              />
              <div ref={overlay} className="pointer-events-none absolute inset-0 overflow-hidden" />
            </ReplayBoundary>
          ) : (
            sceneFallback(failed ? t("replay.error") : webgl === false ? t("replay.unsupported") : t("replay.loading"))
          )}
          {/* Speed of the truck and what it is doing, read from the keyframes. */}
          {sample && (
            <dl className="pointer-events-none absolute top-2 left-2 rounded-sm bg-paper/90 px-2 py-1 font-mono text-[0.75rem] leading-snug text-ink tabular-nums sm:text-[0.8125rem]">
              <dd>{t("hud.speed", { value: number(sample.truckSpeed * 3.6, 0) })}</dd>
              <dd>{truckState(sample.bedAccel)}</dd>
              {slowNow && <dd className="text-gray">{t("speed.slow")} 0.25×</dd>}
            </dl>
          )}
        </div>
        <figcaption className="type-label mt-2">
          {t("replay.source", {
            version: run.engine.mujoco_version,
            step: format.number(run.engine.timestep_s * 1000),
          })}
        </figcaption>
      </figure>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={togglePlay}
          disabled={!doc}
          className={pill({ variant: "secondary", className: "min-w-24" })}
        >
          {playing ? t("replay.pause") : shownTime >= duration ? t("replay.again") : t("replay.play")}
        </button>
        <input
          type="range"
          aria-label={t("replay.time")}
          min={0}
          max={duration}
          step={0.01}
          value={Math.min(shownTime, duration)}
          disabled={!doc}
          onChange={(change) => scrub(Number(change.target.value))}
          className="h-8 min-w-0 flex-1 accent-ink"
        />
        <span className="shrink-0 text-right font-mono text-[0.8125rem] text-gray tabular-nums">
          {t("replay.clock", { now: number(shownTime, 2), total: number(duration, 2) })}
        </span>
      </div>

      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {doc?.events.map((marker) => (
            <li key={`${marker.kind}:${marker.t}`}>
              <button
                type="button"
                onClick={() => scrub(marker.t)}
                className="type-label min-h-8 underline decoration-hairline underline-offset-4 hover:text-ink"
              >
                {number(marker.t, 1)} s ·{" "}
                {(MARKERS as readonly string[]).includes(marker.kind)
                  ? t(`markers.${marker.kind as Marker}`)
                  : marker.kind}
              </button>
            </li>
          ))}
        </ul>
        <div role="group" aria-label={t("speed.label")} className="flex gap-2">
          {SPEEDS.map((option) => (
            <Choice key={option} selected={speed === option} onSelect={() => setSpeed(option)}>
              {option === "auto" ? t("speed.auto") : `${format.number(option)}×`}
            </Choice>
          ))}
        </div>
      </div>

      {/* What the arrows and colours in the scene mean. */}
      <ul className="type-label mt-4 space-y-1.5">
        <li className="flex items-center gap-2">
          <Swatch color="#191918" />
          {t("legend.inertia")}
        </li>
        <li className="flex items-center gap-2">
          <Swatch color="#136f33" />
          {t("legend.friction")} · {t("legend.scale")}
        </li>
        <li className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block h-1 w-10 shrink-0 rounded-full"
            style={{ background: "linear-gradient(to right, #8a8a86, #f2a100, #b42318)" }}
          />
          {t("legend.tension")}. {t("legend.hint")}
        </li>
      </ul>

      {showScene && (
        <figure className="mt-10">
          <h2 className="type-label">{t("raw.title")}</h2>
          <div className="mt-2">{rawVideo}</div>
          <figcaption className="type-small mt-2 text-gray">{t("raw.caption")}</figcaption>
        </figure>
      )}

      {doc && derived && (
        <div className="mt-12">
          <h2 className="type-card-title">{t("charts.title")}</h2>
          <div className="mt-5">
            <Charts
              doc={doc}
              series={derived.series}
              time={shownTime}
              critical={critical}
              onSeek={scrub}
              labels={chartLabels}
            />
          </div>
        </div>
      )}

      <h2 className="type-card-title mt-12">{t("rows.title")}</h2>
      <dl className="mt-4 border-b border-hairline">
        <DataRow label={t("rows.verdict")}>{t(`verdict.${status}`)}</DataRow>
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
        <DataRow label={t("rows.event")}>{t(`events.${id}`, { speed: event.speed_kmh })}</DataRow>
        <DataRow label={t("rows.peak")}>{peakAcceleration(run)}</DataRow>
      </dl>

      {run.verdict.findings.length > 0 && (
        <>
          <h2 className="type-card-title mt-12">{t("findings.title")}</h2>
          <ul className="type-body mt-4 space-y-1.5">
            {relevant(run.verdict.findings).map((finding, index) => (
              <li key={index}>{findingSentence(finding)}</li>
            ))}
          </ul>
        </>
      )}

      <p className="type-small mt-10">
        <a
          href={`${REPOSITORY_URL}/blob/main/docs/validation.md`}
          className="text-gray underline decoration-hairline underline-offset-4 hover:text-ink"
        >
          {t("method")}
        </a>
      </p>
    </section>
  );

  function truckState([ax, ay, az]: readonly [number, number, number]): string {
    const forward = -ax / GRAVITY;
    const sideways = Math.abs(ay) / GRAVITY;
    const vertical = Math.abs(az) / GRAVITY;
    const largest = Math.max(forward, sideways, vertical);
    if (largest < STEADY_G) return t("hud.steady");
    if (largest === vertical) return t("hud.vertical", { value: number(vertical, 2) });
    if (largest === sideways) return t("hud.sideways", { value: number(sideways, 2) });
    return t("hud.braking", { value: number(forward, 2) });
  }

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

  function findingSentence(finding: Finding): string {
    const unit = nameOf(finding.unit_id);
    switch (finding.code) {
      case "unit_slid":
        return t("findings.unit_slid", { unit, distance: number(finding.value * 100) });
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
}

function Swatch({ color }: { color: string }) {
  return <span aria-hidden className="inline-block h-1 w-10 shrink-0 rounded-full" style={{ backgroundColor: color }} />;
}
