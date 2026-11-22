"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { Charts } from "@/components/scenario/charts";
import { ReplayBoundary, supportsWebGL } from "@/components/scenario/replay-boundary";
import {
  COMPACT,
  EventMarkers,
  Findings,
  Hud,
  Legend,
  MethodLink,
  PlayButton,
  RawVideo,
  READOUT_INTERVAL_MS,
  ResultRows,
  Scrubber,
  SpeedChoice,
  useReplayText,
  VariantToggle,
  ViewChoice,
} from "@/components/scenario/replay-shared";
import type { CameraView, ViewMode } from "@/components/scene/keyframe-player";
import { UnitPanel } from "@/components/scene/unit-panel";
import { pill } from "@/components/ui/pill";
import { SectionLabel } from "@/components/ui/section-label";
import { VerdictBadge } from "@/components/ui/verdict-badge";
import { Link } from "@/i18n/navigation";
import { type DemoId, fetchKeyframes, type RunSummary, type TripEvent, type Variant, VARIANTS } from "@/lib/demo";
import { type KeyframesDoc, sampleFrame } from "@/lib/keyframes";
import { buildSeries, criticalWindow, headboardImpacts, playbackRate, type Speed } from "@/lib/replay";
import { sceneConditions } from "@/lib/scene/motion";
import { unitDetails } from "@/lib/unit-details";
import { useMediaQuery } from "@/lib/use-media-query";
import { useSceneVisibility } from "@/lib/use-scene-visibility";

// three.js is only needed once the replay is on screen, and never on the server.
const KeyframePlayer = dynamic(() => import("@/components/scene/keyframe-player"), { ssr: false });

/** Sideways events read best from behind the truck; the others from its side. */
const VIEW: Record<DemoId, CameraView> = {
  "emergency-braking": "hero",
  "weigh-station": "hero",
  "rope-lashing": "rear",
  "sharp-curve": "rear",
  "steel-coil": "hero",
  "box-truck": "hero",
  "dirt-road": "hero",
  "anti-slip-mat": "hero",
  "full-trip": "hero",
  "curtain-sider": "rear",
  "potholed-road": "hero",
  "overloaded-strap": "hero",
  "us-steel-coils": "hero",
  "eu-curtain-pallets": "rear",
};

export type ScenarioReplayProps = {
  id: DemoId;
  event: TripEvent;
  runs: Record<Variant, RunSummary>;
};

/**
 * One demo scenario: the sentence that answers "is it safe?", a toggle between the load as it
 * arrived and the fixed one, the replay of the simulation (3D scene, MuJoCo's own render and
 * charts on one clock), and the numbers of the run.
 */
export function ScenarioReplay({ id, event, runs }: ScenarioReplayProps) {
  const text = useReplayText();
  const { t, format } = text;
  const lab = useTranslations("Lab");

  const [variant, setVariant] = useState<Variant>("as_loaded");
  const [mode, setMode] = useState<ViewMode>("realistic");
  const [speed, setSpeed] = useState<Speed>("auto");
  const [docs, setDocs] = useState<Partial<Record<Variant, KeyframesDoc>>>({});
  const [failed, setFailed] = useState(false);
  // Unknown until the page runs in a browser; then whether it can draw 3D at all.
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [playing, setPlaying] = useState(false);
  // The unit whose numbers are open in the panel under the scene (phone layout only).
  const [selectedUnit, setSelectedUnit] = useState<number | null>(null);
  const compact = useMediaQuery(COMPACT);
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
  // The road the truck drives on: the event's surface and fog, the grade the run reports.
  const conditions = useMemo(
    () => sceneConditions(run.profile, { surface: event.road_surface, fog: event.fog }),
    [run.profile, event.road_surface, event.fog],
  );

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

  // The canvas is created once the frame is in or near the viewport, and draws only while
  // some of it is on screen and the tab is visible.
  const visibility = useSceneVisibility(frame, {
    onScreenChange: (watched) => {
      onScreen.current = watched;
      start.current();
    },
  });
  const { pageVisible } = visibility;

  // The clock of the replay. The scene reads `time` every frame; React state follows slowly.
  // It stands still while the tab is hidden and goes on when the tab is back.
  useEffect(() => {
    if (!playing || !pageVisible) {
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
  }, [playing, pageVisible, duration, speed, critical]);

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

  const status = run.verdict.status;
  const sample = doc ? sampleFrame(doc, shownTime) : undefined;
  const slowNow = speed === "auto" && critical !== null && playbackRate(speed, shownTime, critical) < 1;
  const clip = `/demo/video/${id}.${variant}`;
  const rawVideo = <RawVideo clip={clip} ref={video} />;
  // Without WebGL the engine's own video takes the place of the 3D scene. With it, the scene
  // (and three.js) is only set up once the frame has been on screen.
  const showScene = Boolean(doc && derived && webgl);
  const mountScene = showScene && visibility.seen;
  // The panel of a unit: only where its markers are, in the engineering view on a phone.
  const openUnit = compact && mode === "engineering" && mountScene ? selectedUnit : null;
  const openDetails = doc && sample && openUnit !== null ? unitDetails(doc, sample, openUnit) : null;
  const panelLabels = doc && openUnit !== null ? text.panelLabels(doc, openUnit) : null;

  function closePanel() {
    const marker = overlay.current?.querySelector<HTMLElement>(`[data-unit="${selectedUnit}"]`);
    setSelectedUnit(null);
    // Back to the marker that opened the panel, so the keyboard does not lose its place.
    marker?.focus();
  }
  const sceneFallback = (message: string) =>
    webgl === false || failed ? (
      <div className="absolute inset-0">
        {rawVideo}
        <p className="type-label absolute inset-x-0 bottom-0 bg-paper/85 px-3 py-2">{message}</p>
      </div>
    ) : (
      <p className="type-label absolute inset-0 flex items-center justify-center px-6 text-center">{message}</p>
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
        <VariantToggle variant={variant} onChoose={choose} />
        <ViewChoice mode={mode} onChange={setMode} />
      </div>

      <figure
        className="mt-4"
        onKeyDown={(event) => {
          // Escape on a marker closes the panel it opened.
          if (event.key === "Escape" && openUnit !== null) closePanel();
        }}
      >
        <div
          ref={frame}
          className="relative aspect-[4/3] w-full overflow-hidden rounded bg-surface sm:aspect-[16/10]"
        >
          {mountScene && doc && derived ? (
            <ReplayBoundary fallback={sceneFallback(t("replay.unsupported"))}>
              {/* The drawing is one image to a screen reader; the markers over it are buttons. */}
              <div role="img" aria-label={t("replay.label")} className="absolute inset-0">
                <KeyframePlayer
                  doc={doc}
                  series={derived.series}
                  impacts={derived.impacts}
                  time={time}
                  mode={mode}
                  view={VIEW[id]}
                  overlay={overlay}
                  format={text.labelFormat(doc)}
                  active={visibility.active}
                  playing={playing}
                  revision={shownTime}
                  compactLabels={compact}
                  selectedUnit={openUnit}
                  onSelectUnit={(index) => setSelectedUnit((current) => (current === index ? null : index))}
                  conditions={conditions}
                />
              </div>
              <div ref={overlay} className="pointer-events-none absolute inset-0 overflow-hidden" />
            </ReplayBoundary>
          ) : (
            sceneFallback(
              failed ? t("replay.error") : webgl === false ? t("replay.unsupported") : t("replay.loading"),
            )
          )}
          {/* Speed of the truck and what it is doing, read from the keyframes. */}
          {sample && <Hud speedMps={sample.truckSpeed} bedAccel={sample.bedAccel} slow={slowNow} />}
        </div>
        {openUnit !== null && openDetails && panelLabels && (
          <UnitPanel number={openUnit + 1} details={openDetails} labels={panelLabels} onClose={closePanel} />
        )}
        <figcaption className="type-label mt-2">
          {t("replay.source", {
            version: run.engine.mujoco_version,
            step: format.number(run.engine.timestep_s * 1000),
          })}
        </figcaption>
      </figure>

      <div className="mt-3 flex items-center gap-3">
        <PlayButton playing={playing} ended={shownTime >= duration} disabled={!doc} onToggle={togglePlay} />
        <Scrubber time={shownTime} duration={duration} disabled={!doc} onScrub={scrub} />
      </div>

      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
        <EventMarkers doc={doc} onSeek={scrub} />
        <SpeedChoice speed={speed} onChange={setSpeed} />
      </div>

      {/* The same load in the live lab: change the event and the lashing, push the cargo. */}
      <p className="type-small mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 text-gray">
        <Link
          href={{ pathname: `/app/lab/${id}`, query: { variant } }}
          className={pill({ variant: "secondary" })}
        >
          {lab("open")}
        </Link>
        <span className="min-w-0 flex-1 basis-56">{lab("openHint")}</span>
      </p>

      <Legend compact={compact} />

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
              labels={text.chartLabels(doc)}
            />
          </div>
        </div>
      )}

      <h2 className="type-card-title mt-12">{t("rows.title")}</h2>
      <ResultRows run={run} event={t(`events.${id}`, { speed: event.speed_kmh })} />

      <Findings run={run} />

      <MethodLink />
    </section>
  );
}
