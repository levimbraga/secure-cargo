"use client";

import dynamic from "next/dynamic";
import { memo, type ReactNode, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { RotateCcw, StepBack, StepForward } from "lucide-react";

import { LabControlsPanel } from "@/components/lab/lab-controls";
import { LabProgress, LabResult } from "@/components/lab/lab-result";
import { type PushDirection, useLabClock } from "@/components/lab/use-lab-clock";
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
  ResultRows,
  Scrubber,
  SpeedChoice,
  Swatch,
  useReplayText,
  VariantToggle,
  ViewChoice,
} from "@/components/scenario/replay-shared";
import type { CameraView, PushProps, ViewMode } from "@/components/scene/keyframe-player";
import { UnitPanel } from "@/components/scene/unit-panel";
import { pill } from "@/components/ui/pill";
import { SectionLabel } from "@/components/ui/section-label";
import { Link } from "@/i18n/navigation";
import type { DemoId, Variant } from "@/lib/demo";
import { displacement, sampleFrame } from "@/lib/keyframes";
import { paritySummary } from "@/lib/live/parity";
import type { EventKind } from "@/lib/live/scenario";
import { type LiveLab as LiveLabState, useLiveLab } from "@/lib/live/use-live-lab";
import { buildSeries, criticalWindow, headboardImpacts, playbackRate, type Speed } from "@/lib/replay";
import { unitDetails } from "@/lib/unit-details";
import { REDUCED_MOTION, useMediaQuery } from "@/lib/use-media-query";
import { useSceneVisibility } from "@/lib/use-scene-visibility";

// three.js is only needed once the scene is on screen, and never on the server.
const KeyframePlayer = dynamic(() => import("@/components/scene/keyframe-player"), { ssr: false });

/** Sideways events read best from behind the truck; the others from its side. */
const VIEW: Partial<Record<EventKind, CameraView>> = { lane_change: "rear", sharp_curve: "rear" };
const DIRECTIONS: PushDirection[] = ["forward", "back", "left", "right"];
/** Buttons of the lab are 44 px tall on phones, where a finger has to hit them. */
const TALL = "max-sm:h-11";

export type LabState = "loading" | "running" | "ready" | "error";

function subscribeToLocation(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

function variantOf(search: string): Variant {
  return new URLSearchParams(search).get("variant") === "fixed" ? "fixed" : "as_loaded";
}

/** Label, title and the two versions of the load: the same before and after the lab loads. */
function Header({
  id,
  variant,
  onVariant,
  children,
}: {
  id: DemoId;
  variant: Variant;
  onVariant: (next: Variant) => void;
  children?: ReactNode;
}) {
  const t = useTranslations("Lab");
  const scenario = useTranslations("Scenario");
  return (
    <header>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <SectionLabel>{t("label")}</SectionLabel>
        <Link
          href={`/app/scenarios/${id}`}
          className="type-label underline decoration-hairline underline-offset-4 hover:text-ink"
        >
          {t("back")}
        </Link>
      </div>
      <h1 className="type-hero mt-4 text-balance">{scenario(`titles.${id}`)}</h1>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <VariantToggle variant={variant} onChoose={onVariant} />
        {children}
      </div>
    </header>
  );
}

/**
 * The live lab of a demo scenario: the load is simulated in the browser by MuJoCo WebAssembly,
 * again after every change of the controls, and stepped live while it plays so the visitor can
 * push the cargo. The version of the load comes from `?variant=` and is read in the browser.
 */
export function LiveLab({ id }: { id: DemoId }) {
  // `null` on the server and while hydrating: the address is only known in the browser.
  const search = useSyncExternalStore(
    subscribeToLocation,
    () => window.location.search,
    () => null,
  );
  const [chosen, setChosen] = useState<Variant | null>(null);

  if (search === null) {
    return (
      <section data-lab-state="loading">
        <Header id={id} variant="as_loaded" onVariant={() => undefined} />
        <div className="mt-6 max-w-[43rem]">
          <LabResult
            run={null}
            busy
            error={null}
            fallback={null}
            authored
            onReset={() => undefined}
          />
        </div>
      </section>
    );
  }

  const variant = chosen ?? variantOf(search);
  return (
    <LabSession
      id={id}
      variant={variant}
      onVariant={(next) => {
        if (next === variant) return;
        setChosen(next);
        // Keep the address shareable without a navigation.
        window.history.replaceState(null, "", `?variant=${next}`);
      }}
    />
  );
}

function LabSession({
  id,
  variant,
  onVariant,
}: {
  id: DemoId;
  variant: Variant;
  onVariant: (next: Variant) => void;
}) {
  const { progress, ...lab } = useLiveLab(id, variant);
  // The progress of a run changes many times a second: only the progress bar follows it, the
  // rest of the page (scene, charts) renders once per run.
  return (
    <LabProgress value={progress}>
      <LabBody id={id} variant={variant} onVariant={onVariant} {...lab} />
    </LabProgress>
  );
}

const LabBody = memo(function LabBody({
  id,
  variant,
  onVariant,
  ...lab
}: Omit<LiveLabState, "progress"> & {
  id: DemoId;
  variant: Variant;
  onVariant: (next: Variant) => void;
}) {
  const t = useTranslations("Lab");
  const format = useFormatter();
  const text = useReplayText();
  const scenario = text.t;
  const { run } = lab;
  const doc = run?.doc;

  const [mode, setMode] = useState<ViewMode>("realistic");
  const [speed, setSpeed] = useState<Speed>("auto");
  // The unit whose numbers are open in the panel under the scene (phone layout only).
  const [selectedUnit, setSelectedUnit] = useState<number | null>(null);
  // The unit the push buttons act on.
  const [pushUnit, setPushUnit] = useState(0);
  // Whether this browser can draw 3D at all; this component only ever renders in a browser.
  const [webgl] = useState(supportsWebGL);
  const compact = useMediaQuery(COMPACT);
  const reducedMotion = useMediaQuery(REDUCED_MOTION);
  const frame = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);

  const derived = useMemo(
    () => (doc ? { series: buildSeries(doc), impacts: headboardImpacts(doc), critical: criticalWindow(doc) } : null),
    [doc],
  );
  const critical = derived?.critical ?? null;
  const duration = doc?.duration_s ?? 0;

  // The canvas is created once the frame is in or near the viewport; the clock and the engine
  // run only while some of the frame is on screen and the tab is visible.
  const visibility = useSceneVisibility(frame);
  const clock = useLabClock({
    run,
    engine: lab.engine,
    speed,
    critical,
    // While the next run is simulated the engine belongs to it: the clock waits.
    active: visibility.active && !lab.busy,
    autoplay: !reducedMotion,
    videoRef: video,
  });
  const { shownTime, playing } = clock;

  // Pushing needs the engine of a browser run, stepped live.
  const canPush = run?.source === "browser" && clock.stepping === "live";
  const push: PushProps = { state: clock.pushState, onDrag: clock.drag };

  const state: LabState =
    lab.error && !lab.busy ? "error" : !run ? "loading" : lab.busy ? "running" : "ready";
  const result = run
    ? JSON.stringify({ ...paritySummary(run.summary), source: run.source, run_ms: Math.round(run.runMs) })
    : undefined;

  const number = text.number;
  // What the scene shows right now: the engine's state while it is stepped, else the keyframes.
  const stepped =
    doc && clock.readout && clock.readout.sample.units.length === doc.units.length ? clock.readout : null;
  const sample = doc ? (stepped?.sample ?? sampleFrame(doc, shownTime)) : undefined;
  const freePlay = stepped !== null && stepped.time >= duration;
  const slowNow =
    !freePlay && speed === "auto" && critical !== null && playbackRate(speed, shownTime, critical) < 1;

  // MuJoCo's own render exists for the scenario as authored only.
  const showRaw = lab.authored && !lab.busy && run !== null;
  const clip = `/demo/video/${id}.${variant}`;
  const rawVideo = <RawVideo clip={clip} ref={video} />;
  const showScene = Boolean(doc && derived && webgl);
  const mountScene = showScene && visibility.seen;
  // The panel of a unit: only where its markers are, in the engineering view on a phone.
  const openUnit =
    compact && mode === "engineering" && mountScene && selectedUnit !== null && doc && selectedUnit < doc.units.length
      ? selectedUnit
      : null;
  const openDetails = doc && sample && openUnit !== null ? unitDetails(doc, sample, openUnit) : null;
  const panelLabels = doc && openUnit !== null ? text.panelLabels(doc, openUnit) : null;
  const pushIndex = doc ? Math.min(pushUnit, doc.units.length - 1) : 0;
  const pushedName =
    doc && clock.pushedUnit !== null ? text.nameOf(doc.units[clock.pushedUnit]?.id ?? null) : null;

  function closePanel() {
    const marker = overlay.current?.querySelector<HTMLElement>(`[data-unit="${selectedUnit}"]`);
    setSelectedUnit(null);
    // Back to the marker that opened the panel, so the keyboard does not lose its place.
    marker?.focus();
  }

  const message = (words: string) => (
    <p className="type-label absolute inset-0 flex items-center justify-center px-6 text-center">{words}</p>
  );
  // Without WebGL the engine's own video stands in for the scene, when there is one.
  const noScene =
    !webgl && showRaw ? (
      <div className="absolute inset-0">
        {rawVideo}
        <p className="type-label absolute inset-x-0 bottom-0 bg-paper/85 px-3 py-2">{t("scene.unsupportedVideo")}</p>
      </div>
    ) : (
      message(!webgl ? t("scene.unsupported") : lab.error === "load_failed" ? t("errors.load_failed") : t("state.loading"))
    );

  const iconPill = pill({ variant: "secondary", className: `w-9 px-0 max-sm:w-11 ${TALL}` });

  return (
    <section data-lab-state={state} data-lab-result={result} data-lab-stepping={canPush ? "live" : "keyframes"}>
      <Header id={id} variant={variant} onVariant={onVariant}>
        <ViewChoice mode={mode} onChange={setMode} />
      </Header>

      <div className="mx-auto mt-6 grid max-w-[43rem] grid-cols-1 gap-y-8 lg:mx-0 lg:max-w-none lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-[auto_auto_1fr] lg:gap-x-10">
        <div className="lg:col-start-2 lg:row-start-1">
          <LabResult
            run={run}
            busy={lab.busy}
            error={lab.error}
            fallback={lab.fallback}
            authored={lab.authored}
            onReset={lab.resetControls}
          />
        </div>

        <div className="min-w-0 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <figure
            onKeyDown={(event) => {
              // Escape on a marker closes the panel it opened.
              if (event.key === "Escape" && openUnit !== null) closePanel();
            }}
          >
            <div
              ref={frame}
              className="relative aspect-[4/3] w-full overflow-hidden rounded bg-surface sm:aspect-[16/10]"
            >
              {mountScene && doc && derived && run ? (
                <ReplayBoundary fallback={message(t("scene.unsupported"))}>
                  {/* The drawing is one image to a screen reader; the markers over it are buttons. */}
                  <div
                    role="img"
                    aria-label={canPush ? t("scene.label") : t("scene.labelReplay")}
                    className="absolute inset-0"
                  >
                    <KeyframePlayer
                      doc={doc}
                      series={derived.series}
                      impacts={derived.impacts}
                      time={clock.time}
                      mode={mode}
                      view={VIEW[run.controls.event] ?? "hero"}
                      overlay={overlay}
                      format={text.labelFormat(doc)}
                      active={visibility.active}
                      playing={playing && !lab.busy}
                      revision={shownTime}
                      compactLabels={compact}
                      selectedUnit={openUnit}
                      onSelectUnit={(index) => setSelectedUnit((current) => (current === index ? null : index))}
                      sampler={clock.sampler}
                      push={canPush ? push : undefined}
                    />
                  </div>
                  <div ref={overlay} className="pointer-events-none absolute inset-0 overflow-hidden" />
                </ReplayBoundary>
              ) : (
                noScene
              )}
              {/* Speed of the truck and what it is doing, and the push of the visitor. */}
              {sample && showScene && (
                <Hud speedMps={sample.truckSpeed} bedAccel={sample.bedAccel} slow={slowNow}>
                  {freePlay && <dd className="text-gray">{t("push.freePlay")}</dd>}
                  {clock.pushing && (
                    <dd data-testid="lab-pushing">
                      {t("push.pushing", { force: number(Math.hypot(...clock.pushing.force) / 1000, 1) })}
                    </dd>
                  )}
                </Hud>
              )}
            </div>
            {openUnit !== null && openDetails && panelLabels && (
              <UnitPanel number={openUnit + 1} details={openDetails} labels={panelLabels} onClose={closePanel} />
            )}
            {run && (
              <figcaption className="type-label mt-2">
                {scenario("replay.source", {
                  version: run.summary.engine.mujoco_version,
                  step: format.number(run.summary.engine.timestep_s * 1000),
                })}
                {" · "}
                {run.source === "server"
                  ? t("scene.serverRun")
                  : clock.stepping === "live"
                    ? t("scene.stepping")
                    : t("scene.keyframes")}
              </figcaption>
            )}
          </figure>

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="flex items-center gap-2">
              <PlayButton
                playing={playing}
                ended={shownTime >= duration}
                disabled={!doc}
                onToggle={clock.togglePlay}
                className={`min-w-24 ${TALL}`}
              />
              <button
                type="button"
                aria-label={t("transport.stepBack")}
                title={t("transport.stepBack")}
                disabled={!doc}
                onClick={() => clock.step(-1)}
                className={iconPill}
              >
                <StepBack aria-hidden size={16} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                aria-label={t("transport.stepForward")}
                title={t("transport.stepForward")}
                disabled={!doc}
                onClick={() => clock.step(1)}
                className={iconPill}
              >
                <StepForward aria-hidden size={16} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                aria-label={t("transport.restart")}
                title={t("transport.restart")}
                disabled={!doc}
                onClick={clock.restart}
                className={iconPill}
              >
                <RotateCcw aria-hidden size={16} strokeWidth={1.75} />
              </button>
            </div>
            <div className="flex min-w-[14rem] flex-1 items-center gap-3">
              <Scrubber time={shownTime} duration={duration} disabled={!doc} onScrub={clock.scrub} />
            </div>
          </div>

          <div className="mt-1 flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
            <EventMarkers doc={doc} onSeek={clock.scrub} />
            <SpeedChoice speed={speed} onChange={setSpeed} />
          </div>

          {canPush && doc && (
            <div className="mt-4">
              <p className="type-label text-pretty">{t("push.hint")}</p>
              <div role="group" aria-label={t("push.title")} className="mt-2 flex flex-wrap items-center gap-2">
                <select
                  aria-label={t("push.unit")}
                  data-testid="lab-push-unit"
                  value={pushIndex}
                  onChange={(change) => setPushUnit(Number(change.target.value))}
                  className="h-11 rounded-sm border border-control bg-paper px-2 text-sm text-ink max-sm:w-full sm:h-8"
                >
                  {doc.units.map((unit, index) => (
                    <option key={unit.id} value={index}>
                      {text.nameOf(unit.id)}
                    </option>
                  ))}
                </select>
                {DIRECTIONS.map((direction) => (
                  <button
                    key={direction}
                    type="button"
                    data-testid={`lab-push-${direction}`}
                    aria-label={t("push.direction", {
                      unit: text.nameOf(doc.units[pushIndex]?.id ?? null),
                      direction,
                    })}
                    onClick={() => clock.kick(pushIndex, direction)}
                    className={pill({ variant: "secondary", className: TALL })}
                  >
                    {t(`push.${direction}`)}
                  </button>
                ))}
              </div>
              {clock.perturbed && (
                <div role="status" className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                  <p data-testid="lab-pushed" className="type-small min-w-0 flex-1 basis-64 text-pretty text-ink">
                    {t("push.note")}{" "}
                    {pushedName !== null && sample && clock.pushedUnit !== null && (
                      <span className="text-gray">
                        {t("push.moved", {
                          unit: pushedName,
                          distance: number(displacement(doc, sample, clock.pushedUnit) * 100, 0),
                        })}
                      </span>
                    )}
                  </p>
                  <button type="button" onClick={clock.restart} className={pill({ variant: "secondary", className: TALL })}>
                    {t("transport.restart")}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="lg:col-start-2 lg:row-span-2 lg:row-start-2">
          {lab.controls && lab.limits ? (
            <LabControlsPanel
              controls={lab.controls}
              limits={lab.limits}
              authored={lab.authored}
              onChange={lab.changeControls}
              onReset={lab.resetControls}
            />
          ) : null}
        </div>

        <div className="min-w-0 lg:col-start-1 lg:row-start-3">
          <Legend compact={compact}>
            {canPush && (
              <li className="flex items-center gap-2">
                <Swatch color="#3b6fd4" />
                {t("push.legend")}
              </li>
            )}
          </Legend>

          {showScene && showRaw && (
            <figure className="mt-10">
              <h2 className="type-label">{scenario("raw.title")}</h2>
              <div className="mt-2">{rawVideo}</div>
              <figcaption className="type-small mt-2 text-gray">{scenario("raw.caption")}</figcaption>
            </figure>
          )}

          {doc && derived && (
            <div className="mt-12">
              <h2 className="type-card-title">{scenario("charts.title")}</h2>
              <div className="mt-5">
                <Charts
                  doc={doc}
                  series={derived.series}
                  time={shownTime}
                  critical={critical}
                  onSeek={clock.scrub}
                  labels={text.chartLabels(doc)}
                />
              </div>
            </div>
          )}

          {run && (
            <>
              <h2 className="type-card-title mt-12">{scenario("rows.title")}</h2>
              <ResultRows
                run={run.summary}
                event={t("eventLine", {
                  event: t(`events.${run.controls.event}`),
                  speed: format.number(run.controls.speedKmh),
                  surface: t(`surfaces.${run.controls.surface}`),
                })}
              />
              <Findings run={run.summary} />
            </>
          )}

          <MethodLink />
        </div>
      </div>
    </section>
  );
});
