"use client";

/**
 * The clock of the live lab.
 *
 * While playing, a run that the browser simulated is stepped again by MuJoCo in real time
 * (`LiveRun.seek` + `stepLive`) and the scene draws the engine's state, so the visitor can push
 * the cargo while the event runs and after it. Paused, scrubbing, or when the run came from the
 * server (or the device cannot keep up), the scene shows the keyframes of the run instead.
 */

import { type RefObject, useEffect, useRef, useState } from "react";

import type { LiveState } from "@/components/scene/keyframe-player";
import { PUSH_MAX_WEIGHTS, type UnitPush } from "@/components/scene/push";
import type { Vec3 } from "@/lib/keyframes";
import type { LiveRun } from "@/lib/live/engine";
import type { LabRun } from "@/lib/live/use-live-lab";

/** What the clock needs of a run: where it was simulated, its engine settings and keyframes. */
type ClockRun = Pick<LabRun, "source" | "summary" | "doc">;
import { GRAVITY, playbackRate, type Speed } from "@/lib/replay";

/** How often the read-outs update while playing; the 3D scene itself runs every frame. */
const READOUT_INTERVAL_MS = 80;
/** Most time one animation frame spends stepping the engine [ms]; beyond it the clock runs slower. */
const STEP_BUDGET_MS = 10;
/** Steps between two looks at the time while stepping. */
const STEP_CHUNK = 4;
/** A device that keeps under this share of the asked speed for `LAG_FALLBACK_MS` replays keyframes. */
const LAG_RATIO = 0.5;
const LAG_FALLBACK_MS = 2000;
/** After the end of the event the engine goes on for this long without a push, then pauses [ms]. */
const FREE_PLAY_IDLE_MS = 3000;
/** A push from the buttons: this share of the unit's weight for this long [s]. */
const KICK_WEIGHTS = 1;
const KICK_S = 0.25;

export type Stepping = "live" | "keyframes";
export type PushDirection = "forward" | "back" | "left" | "right";

const DIRECTION: Record<PushDirection, [number, number]> = {
  forward: [1, 0],
  back: [-1, 0],
  left: [0, 1],
  right: [0, -1],
};

export type LabClock = {
  playing: boolean;
  /** Replay time shown by the timeline and the charts [s]; it stops at the end of the event. */
  shownTime: number;
  /** The engine's state at the last read-out, or `null` while the scene shows the keyframes. */
  readout: LiveState | null;
  /** The visitor has pushed the cargo since the run was last positioned. */
  perturbed: boolean;
  /** The push at the last read-out. */
  pushing: UnitPush | null;
  /** The unit that was pushed last. */
  pushedUnit: number | null;
  /** Whether a browser run is stepped live or replayed from its keyframes (slow device). */
  stepping: Stepping;
  /** Replay time for the scene, read every frame. */
  time: RefObject<number>;
  /** For `KeyframePlayer`: the state of the engine while it is stepped. */
  sampler: RefObject<(() => LiveState | null) | null>;
  /** For `KeyframePlayer`: the push, written by a drag in the scene or by `kick`. */
  pushState: RefObject<UnitPush | null>;
  togglePlay: () => void;
  scrub: (seconds: number) => void;
  /** One keyframe forward (+1) or back (-1). */
  step: (direction: 1 | -1) => void;
  restart: () => void;
  /** A drag on a unit started (its index) or ended (`null`). */
  drag: (unitIndex: number | null) => void;
  /** A short push on a unit, for the buttons. */
  kick: (unitIndex: number, direction: PushDirection) => void;
};

export function useLabClock({
  run,
  engine,
  speed,
  critical,
  active,
  autoplay,
  videoRef,
}: {
  run: ClockRun | null;
  /** The engine of the latest browser run; read fresh on every frame. */
  engine: RefObject<LiveRun | null>;
  speed: Speed;
  critical: { start: number; end: number } | null;
  /** The scene is on screen and the tab is visible: the clock runs only then. */
  active: boolean;
  /** Start playing when a run arrives. */
  autoplay: boolean;
  /** MuJoCo's own render of the run as authored, kept on the same clock. */
  videoRef: RefObject<HTMLVideoElement | null>;
}): LabClock {
  const [playing, setPlaying] = useState(false);
  const [shownTime, setShownTime] = useState(0);
  const [readout, setReadout] = useState<LiveState | null>(null);
  const [perturbed, setPerturbed] = useState(false);
  const [pushing, setPushing] = useState<UnitPush | null>(null);
  const [pushedUnit, setPushedUnit] = useState<number | null>(null);
  const [stepping, setStepping] = useState<Stepping>("live");

  const time = useRef(0);
  const liveState = useRef<LiveState | null>(null);
  const sampler = useRef<(() => LiveState | null) | null>(null);
  const pushState = useRef<UnitPush | null>(null);
  /** The engine has to be put at `time` before it is stepped. */
  const needSeek = useRef(true);
  /** The engine `seek` was last called on: a new run brings a new one. */
  const synced = useRef<LiveRun | null>(null);
  /** Fraction of a step carried to the next frame. */
  const carry = useRef(0);
  /** Steps a push from the buttons still lasts. */
  const kickSteps = useRef(0);
  /** Time spent after the end of the event without a push [ms]. */
  const idle = useRef(0);
  /** Since when the engine has not kept up [ms timestamp], or 0. */
  const laggingSince = useRef(0);

  // A new run starts from its beginning.
  const [shownRun, setShownRun] = useState<ClockRun | null>(null);
  if (run !== shownRun) {
    setShownRun(run);
    setShownTime(0);
    setReadout(null);
    setPerturbed(false);
    setPushing(null);
    setPushedUnit(null);
    setPlaying(run !== null && autoplay);
  }
  useEffect(() => {
    time.current = 0;
    liveState.current = null;
    pushState.current = null;
    needSeek.current = true;
    kickSteps.current = 0;
    idle.current = 0;
  }, [run]);

  useEffect(() => {
    sampler.current = () => liveState.current;
    return () => {
      sampler.current = null;
    };
  }, []);

  const duration = run?.doc.duration_s ?? 0;
  const fps = run?.doc.fps ?? 30;
  const frames = run?.doc.frames.length ?? 1;
  const timestep = run?.summary.engine.timestep_s ?? 0.002;
  const browser = run?.source === "browser";

  useEffect(() => {
    if (!playing || !active || !run) {
      videoRef.current?.pause();
      return;
    }
    let request = 0;
    let previous = performance.now();
    let lastReadout = 0;
    void videoRef.current?.play().catch(() => undefined);

    /** Steps the engine by the replay time that passed. Returns false when the engine cannot be used. */
    const stepLive = (current: LiveRun, elapsed: number, now: number): boolean => {
      if (needSeek.current || synced.current !== current) {
        current.seek(Math.min(Math.round(time.current * fps), frames - 1));
        synced.current = current;
        needSeek.current = false;
        carry.current = 0;
        laggingSince.current = 0;
      }
      const inEvent = current.liveTime < duration;
      const rate = inEvent ? playbackRate(speed, current.liveTime, critical) : speed === "auto" ? 1 : speed;
      const push = pushState.current;
      current.setPush(push?.unit ?? 0, push?.force ?? null);

      carry.current += (elapsed * rate) / timestep;
      const wanted = Math.floor(carry.current);
      carry.current -= wanted;
      let done = 0;
      const started = performance.now();
      while (done < wanted) {
        const chunk = Math.min(wanted - done, STEP_CHUNK);
        current.stepLive(chunk);
        done += chunk;
        // A slow device slows the clock instead of freezing the page.
        if (performance.now() - started > STEP_BUDGET_MS) break;
      }
      if (kickSteps.current > 0) {
        kickSteps.current -= done;
        if (kickSteps.current <= 0) pushState.current = null;
      }
      liveState.current = { sample: current.sample(), time: current.liveTime };
      time.current = Math.min(current.liveTime, duration);

      // Far behind for a while: this device replays the keyframes from now on.
      if (wanted > 0 && done < wanted * LAG_RATIO) {
        if (laggingSince.current === 0) laggingSince.current = now;
        else if (now - laggingSince.current > LAG_FALLBACK_MS) return false;
      } else {
        laggingSince.current = 0;
      }
      return true;
    };

    const tick = (now: number) => {
      const wall = now - previous;
      const elapsed = Math.min(wall / 1000, 0.1);
      previous = now;
      const current = stepping === "live" ? engine.current : null;
      let ended = false;
      if (current) {
        let usable = true;
        try {
          usable = stepLive(current, elapsed, now);
        } catch {
          // The push made the model unstable: back to the undisturbed run at this instant.
          pushState.current = null;
          kickSteps.current = 0;
          liveState.current = null;
          needSeek.current = true;
          setPerturbed(false);
        }
        if (!usable) {
          liveState.current = null;
          pushState.current = null;
          setStepping("keyframes");
          setPerturbed(false);
        }
        if (current.liveTime >= duration) {
          // Free play: the bed is at rest and the cargo can still be pushed.
          idle.current = pushState.current ? 0 : idle.current + wall;
          ended = idle.current > FREE_PLAY_IDLE_MS;
        }
      } else {
        const rate = playbackRate(speed, time.current, critical);
        time.current = Math.min(time.current + elapsed * rate, duration);
        ended = time.current >= duration;
      }

      if (ended || now - lastReadout > READOUT_INTERVAL_MS) {
        lastReadout = now;
        setShownTime(time.current);
        setReadout(liveState.current);
        setPushing(pushState.current);
        // MuJoCo's own render runs on the same clock.
        const clip = videoRef.current;
        if (clip) {
          clip.playbackRate = playbackRate(speed, time.current, critical);
          if (Math.abs(clip.currentTime - time.current) > 0.2) clip.currentTime = time.current;
        }
      }
      if (ended) setPlaying(false);
      else request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [playing, active, run, engine, videoRef, speed, critical, duration, fps, frames, timestep, stepping]);

  /** Puts the replay at an instant of the undisturbed run. */
  function position(seconds: number) {
    time.current = seconds;
    liveState.current = null;
    pushState.current = null;
    needSeek.current = true;
    kickSteps.current = 0;
    idle.current = 0;
    setShownTime(seconds);
    setReadout(null);
    setPerturbed(false);
    setPushing(null);
    if (videoRef.current) videoRef.current.currentTime = seconds;
  }

  function scrub(seconds: number) {
    setPlaying(false);
    position(seconds);
  }

  function step(direction: 1 | -1) {
    setPlaying(false);
    const frame = Math.min(Math.max(Math.round(time.current * fps) + direction, 0), frames - 1);
    position(Math.min(frame / fps, duration));
  }

  function restart() {
    position(0);
    setPlaying(run !== null);
  }

  function togglePlay() {
    if (!playing && time.current >= duration) position(0);
    setPlaying(!playing);
  }

  /** A push starts the engine if it stands still, from where it is. */
  function pushed(unitIndex: number) {
    idle.current = 0;
    setPerturbed(true);
    setPushedUnit(unitIndex);
    setPlaying(true);
  }

  function drag(unitIndex: number | null) {
    if (unitIndex === null || !browser || stepping !== "live") return;
    kickSteps.current = 0;
    pushed(unitIndex);
  }

  function kick(unitIndex: number, direction: PushDirection) {
    const mass = run?.doc.units[unitIndex]?.mass_kg;
    if (!browser || stepping !== "live" || mass === undefined) return;
    const size = Math.min(KICK_WEIGHTS, PUSH_MAX_WEIGHTS) * mass * GRAVITY;
    const [x, y] = DIRECTION[direction];
    const force: Vec3 = [x * size, y * size, 0];
    pushState.current = { unit: unitIndex, force };
    kickSteps.current = Math.round(KICK_S / timestep);
    pushed(unitIndex);
  }

  return {
    playing,
    shownTime,
    readout,
    perturbed,
    pushing,
    pushedUnit,
    stepping,
    time,
    sampler,
    pushState,
    togglePlay,
    scrub,
    step,
    restart,
    drag,
    kick,
  };
}
