"use client";

/**
 * The explorer's 3D view of the latest run: the same scene as the live lab, stepped live by
 * MuJoCo when the browser simulated the run, replayed from keyframes otherwise. The scene mounts
 * only when it is on screen and runs only while the tab is visible (mobile budget).
 */

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { type RefObject, useMemo, useRef, useState } from "react";

import { useLabClock } from "@/components/lab/use-lab-clock";
import { ReplayBoundary, supportsWebGL } from "@/components/scenario/replay-boundary";
import {
  COMPACT,
  EventMarkers,
  Hud,
  PlayButton,
  Scrubber,
  SpeedChoice,
  useReplayText,
  ViewChoice,
} from "@/components/scenario/replay-shared";
import type { CameraView, ViewMode } from "@/components/scene/keyframe-player";
import type { ExplorerRun } from "@/lib/explorer/use-explorer";
import { sampleFrame } from "@/lib/keyframes";
import type { LiveRun } from "@/lib/live/engine";
import { buildSeries, criticalWindow, headboardImpacts, playbackRate, type Speed } from "@/lib/replay";
import { sceneConditions } from "@/lib/scene/motion";
import { REDUCED_MOTION, useMediaQuery } from "@/lib/use-media-query";
import { useSceneVisibility } from "@/lib/use-scene-visibility";

const KeyframePlayer = dynamic(() => import("@/components/scene/keyframe-player"), { ssr: false });

/** Sideways events read best from behind the truck; the others from its side. */
const VIEW: Record<string, CameraView> = { lane_change: "rear", sharp_curve: "rear" };

export function ExplorerScene({
  run,
  engine,
  busy,
  event,
}: {
  run: ExplorerRun | null;
  engine: RefObject<LiveRun | null>;
  busy: boolean;
  event: string;
}) {
  const t = useTranslations("Lab");
  const text = useReplayText();
  const [mode, setMode] = useState<ViewMode>("realistic");
  const [speed, setSpeed] = useState<Speed>("auto");
  const [webgl] = useState(supportsWebGL);
  const compact = useMediaQuery(COMPACT);
  const reducedMotion = useMediaQuery(REDUCED_MOTION);
  const frame = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const doc = run?.doc;

  const derived = useMemo(
    () => (doc ? { series: buildSeries(doc), impacts: headboardImpacts(doc), critical: criticalWindow(doc) } : null),
    [doc],
  );
  const critical = derived?.critical ?? null;
  // The road the truck drives on: its surface, fog and grade, as the run reports them.
  const profile = run?.summary.profile;
  const conditions = useMemo(() => sceneConditions(profile), [profile]);
  const duration = doc?.duration_s ?? 0;
  const visibility = useSceneVisibility(frame);
  const clock = useLabClock({
    run,
    engine,
    speed,
    critical,
    active: visibility.active && !busy,
    autoplay: !reducedMotion,
    videoRef: video,
  });
  const { shownTime, playing } = clock;
  const stepped =
    doc && clock.readout && clock.readout.sample.units.length === doc.units.length ? clock.readout : null;
  const sample = doc ? (stepped?.sample ?? sampleFrame(doc, shownTime)) : undefined;
  const slowNow = speed === "auto" && critical !== null && playbackRate(speed, shownTime, critical) < 1;
  const mountScene = Boolean(doc && derived && webgl && visibility.seen);

  return (
    <figure>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <h2 className="type-label">{t("scene.labelReplay").split(".")[0]}</h2>
        <ViewChoice mode={mode} onChange={setMode} />
      </div>
      <div ref={frame} className="relative mt-2 aspect-[4/3] w-full overflow-hidden rounded bg-surface sm:aspect-[16/10]">
        {mountScene && doc && derived ? (
          <ReplayBoundary fallback={<p className="type-label absolute inset-0 flex items-center justify-center">{t("scene.unsupported")}</p>}>
            <div role="img" aria-label={t("scene.labelReplay")} className="absolute inset-0">
              <KeyframePlayer
                doc={doc}
                series={derived.series}
                impacts={derived.impacts}
                time={clock.time}
                mode={mode}
                view={VIEW[event] ?? "hero"}
                overlay={overlay}
                format={text.labelFormat(doc)}
                active={visibility.active}
                playing={playing && !busy}
                revision={shownTime}
                compactLabels={compact}
                selectedUnit={null}
                onSelectUnit={() => undefined}
                sampler={clock.sampler}
                conditions={conditions}
              />
            </div>
            <div ref={overlay} className="pointer-events-none absolute inset-0 overflow-hidden" />
          </ReplayBoundary>
        ) : (
          <p className="type-label absolute inset-0 flex items-center justify-center px-6 text-center">
            {!webgl ? t("scene.unsupported") : t("state.loading")}
          </p>
        )}
        {sample && mountScene && <Hud speedMps={sample.truckSpeed} bedAccel={sample.bedAccel} slow={slowNow} />}
      </div>
      {run && (
        <figcaption className="type-label mt-2">
          {run.source === "server" ? t("scene.serverRun") : clock.stepping === "live" ? t("scene.stepping") : t("scene.keyframes")}
        </figcaption>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <PlayButton
          playing={playing}
          ended={shownTime >= duration}
          disabled={!doc}
          onToggle={clock.togglePlay}
          className="min-w-24 max-sm:h-11"
        />
        <div className="flex min-w-[14rem] flex-1 items-center gap-3">
          <Scrubber time={shownTime} duration={duration} disabled={!doc} onScrub={clock.scrub} />
        </div>
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
        <EventMarkers doc={doc} onSeek={clock.scrub} event={event} />
        <SpeedChoice speed={speed} onChange={setSpeed} />
      </div>
    </figure>
  );
}
