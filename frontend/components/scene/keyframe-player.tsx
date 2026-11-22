"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { type RefObject, useEffect, useMemo, useRef } from "react";
import { type Group, Vector3 } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { type KeyframesDoc, type Sample, sampleFrame, type Vec3 } from "@/lib/keyframes";
import { type Quality, QUALITY_SETTINGS } from "@/lib/quality";
import type { Impact, Series } from "@/lib/replay";
import { lookOf } from "@/lib/scene/look";
import { buildScenePath, type Conditions, DRY, truckPose } from "@/lib/scene/motion";
import { REDUCED_MOTION, useMediaQuery } from "@/lib/use-media-query";
import { useQuality } from "@/lib/use-quality";
import { usePageVisible } from "@/lib/use-scene-visibility";

import { AxisTriad, Units } from "./cargo";
import { ContactShadow, Lighting, Rain, RoadScene, WheelSpray } from "./environment";
import { Contacts, ForceArrows, ImpactFlash, type LabelFormat, Labels, Lashings, PushArrow } from "./forces";
import { type PushProps, useUnitPush } from "./push";
import type { Live, ViewMode } from "./shared";
import { TruckBody, Wheels } from "./truck";

export type CameraView = "hero" | "side" | "rear" | "top";
export type { Conditions, LabelFormat, PushProps, Quality, ViewMode };

/**
 * The state of a model that is being stepped right now, drawn instead of the keyframes.
 * `time` is the event time it has reached [s]; it keeps growing after the end of the event.
 */
export type LiveState = { sample: Sample; time: number };

/** At most this wide [CSS px], the engineering view uses numbered markers instead of text labels. */
export const COMPACT_LABELS_MAX_WIDTH = 480;

const VIEW_DIRECTION: Record<CameraView, Vec3> = {
  hero: [-0.42, 0.4, 1],
  side: [0, 0.16, 1],
  rear: [-1, 0.5, 0.62],
  top: [-0.12, 1, 0.35],
};
/** The camera looks at a point just above the middle of the truck. */
const TARGET: Vec3 = [0.7, 1.35, 0];
/** Camera distance per view at a 16:10 frame, chosen so the truck fills most of it. */
const VIEW_DISTANCE: Record<CameraView, number> = { hero: 11.4, side: 12.4, rear: 12, top: 13.5 };

export type KeyframePlayerProps = {
  doc: KeyframesDoc;
  series: Series;
  impacts: Impact[];
  /** Replay time in seconds, written by the page; the scene reads it every frame. */
  time: RefObject<number>;
  mode: ViewMode;
  view?: CameraView;
  /** Element over the canvas that receives the text labels. */
  overlay: RefObject<HTMLDivElement | null>;
  format: LabelFormat;
  /** Render frames only while the scene is on screen. */
  active?: boolean;
  /** While playing the scene renders every frame; otherwise only when something changes. */
  playing: boolean;
  /** Changes whenever the replay time changes while paused (scrubbing), to draw a new frame. */
  revision: number;
  /** Keep the last frame readable from the canvas, for captures. */
  capture?: boolean;
  /** Rendering quality. Default: picked for this device (`useQuality`). */
  quality?: Quality;
  /**
   * Phone labelling of the engineering view: one numbered marker per unit instead of text.
   * Default: when the canvas is at most `COMPACT_LABELS_MAX_WIDTH` wide.
   */
  compactLabels?: boolean;
  /** Index of the unit whose marker is drawn as selected (its details are open), or `null`. */
  selectedUnit?: number | null;
  /** A unit marker was tapped or activated from the keyboard. Without it the markers are not buttons. */
  onSelectUnit?: (unitIndex: number) => void;
  /**
   * The live lab: a function that returns the state of the engine it is stepping, or `null`
   * to draw the keyframes at `time`. It is asked once per frame.
   */
  sampler?: RefObject<(() => LiveState | null) | null>;
  /** The live lab: pressing on a unit and dragging pushes it (see `useUnitPush`). */
  push?: PushProps;
  /** Road surface, fog and grade of the run (`sceneConditions`); a dry road by default. */
  conditions?: Conditions;
};

/** Replays a keyframes document as a 3D scene of a flatbed truck. */
export default function KeyframePlayer({
  doc,
  series,
  impacts,
  time,
  mode,
  view = "hero",
  overlay,
  format,
  active = true,
  playing,
  revision,
  capture = false,
  quality,
  compactLabels,
  selectedUnit = null,
  onSelectUnit,
  sampler,
  push,
  conditions = DRY,
}: KeyframePlayerProps) {
  const realistic = mode === "realistic";
  const look = useMemo(() => lookOf(conditions), [conditions]);
  const reducedMotion = useMediaQuery(REDUCED_MOTION);
  // Shared by the camera and by the push: the camera stands still while a unit is dragged.
  const orbit = useRef<OrbitControls | null>(null);
  const detected = useQuality();
  const level = quality ?? detected;
  const settings = QUALITY_SETTINGS[level];
  // A hidden tab draws nothing, whatever the page asks for.
  const pageVisible = usePageVisible();
  const awake = active && pageVisible;

  return (
    <Canvas
      // The views and the quality levels use different renderer settings: a fresh canvas for each.
      key={`${mode}:${level}`}
      // ACES tone mapping for the realistic view (part of the material shaders, not a pass);
      // plain colours otherwise.
      flat={!realistic}
      // Soft shadow maps only at high quality: phones and weak GPUs get a flat contact shadow.
      shadows={realistic && settings.shadows ? "soft" : false}
      scene={{ environmentIntensity: 0.55 }}
      dpr={[1, settings.maxDpr]}
      // Idle costs nothing: frames are drawn while playing, on demand when paused, and never
      // while the scene is off screen or the tab is hidden.
      frameloop={!awake ? "never" : playing ? "always" : "demand"}
      gl={{ antialias: settings.antialias, alpha: true, preserveDrawingBuffer: capture }}
      camera={{ fov: 30, near: 0.5, far: 160 }}
      // OrbitControls turns touch gestures off on the canvas; this class keeps vertical page
      // scrolling (see `.scene-canvas` in globals.css).
      className="scene-canvas"
      data-quality={level}
    >
      <Lighting mode={mode} quality={level} look={look} />
      <CameraRig view={view} controlsRef={orbit} />
      <Stage
        doc={doc}
        series={series}
        impacts={impacts}
        time={time}
        mode={mode}
        overlay={overlay}
        format={format}
        revision={revision}
        contactShadow={realistic && !settings.shadows}
        compactLabels={compactLabels}
        selectedUnit={selectedUnit}
        onSelectUnit={onSelectUnit}
        sampler={sampler}
        push={push}
        orbit={orbit}
        conditions={conditions}
        quality={level}
        animateWeather={!reducedMotion}
      />
    </Canvas>
  );
}

function Stage({
  doc,
  series,
  impacts,
  time,
  mode,
  overlay,
  format,
  revision,
  contactShadow,
  compactLabels,
  selectedUnit,
  onSelectUnit,
  sampler,
  push,
  orbit,
  conditions,
  quality,
  animateWeather,
}: Pick<
  KeyframePlayerProps,
  | "doc"
  | "series"
  | "impacts"
  | "time"
  | "mode"
  | "overlay"
  | "format"
  | "revision"
  | "compactLabels"
  | "selectedUnit"
  | "onSelectUnit"
  | "sampler"
  | "push"
> & {
  /** Draw the flat shadow under the truck that stands in for shadow maps. */
  contactShadow: boolean;
  orbit: RefObject<OrbitControls | null>;
  conditions: Conditions;
  quality: Quality;
  /** Rain, spray and dust move (off with `prefers-reduced-motion`). */
  animateWeather: boolean;
}) {
  const invalidate = useThree((state) => state.invalidate);
  const width = useThree((state) => state.size.width);
  const compact = compactLabels ?? width <= COMPACT_LABELS_MAX_WIDTH;
  const realistic = mode === "realistic";
  // A new replay time, a new view or a pointer over the scene each ask for a fresh frame.
  useEffect(() => {
    invalidate();
  }, [invalidate, revision, mode, doc]);
  // The truck's drive on the road, rebuilt from the run (the engineering view: a flat ground).
  const path = useMemo(() => buildScenePath(doc, conditions, !realistic), [doc, conditions, realistic]);
  const look = useMemo(() => lookOf(conditions), [conditions]);
  // The instant being drawn, shared by every part of the scene.
  const live = useRef<Live>({ t: 0, sample: sampleFrame(doc, 0), distance: 0, height: 0, activeStrap: -1 });
  const view = useRef<Group>(null);
  const truck = useRef<Group>(null);
  const body = useRef<Group>(null);
  const wheelRefs = useRef<(Group | null)[]>([]);
  const axleRefs = useRef<(Group | null)[]>([]);
  const floorHeight = doc.bed.floor_height_m;
  const unitHandlers = useUnitPush({ doc, live, body, orbit, push });

  // Runs before every other part of the scene, so they all draw the same instant.
  useFrame(() => {
    const state = live.current;
    const t = Math.min(Math.max(time.current, 0), doc.duration_s);
    // A model stepped live is drawn as it is; otherwise the keyframes at the replay time. A
    // state left over from another model (other units or lashings) is not drawn.
    const stepped = sampler?.current?.() ?? null;
    const fits =
      stepped !== null &&
      stepped.sample.units.length === doc.units.length &&
      stepped.sample.straps.length === doc.straps.length;
    state.sample = fits ? stepped.sample : sampleFrame(doc, t);
    // A live model keeps stepping after the end of the event: the truck keeps driving.
    const drawn = fits ? Math.max(stepped.time, t) : t;
    state.t = t;
    const pose = truckPose(path, drawn, floorHeight);
    state.pose = pose;
    state.distance = pose.s;
    state.height = pose.heave;

    // The view follows a camera that trails the truck a little, so turns and lane changes show.
    const { cam } = pose;
    const group = view.current;
    if (group) {
      group.rotation.set(0, -cam.yaw, 0);
      const c = Math.cos(-cam.yaw);
      const s = Math.sin(-cam.yaw);
      // Position = R_y(-yaw) * -(cam in three.js coordinates: x, z, -y).
      const px = -cam.x;
      const pz = cam.y;
      group.position.set(c * px + s * pz, -cam.z, -s * px + c * pz);
    }
    truck.current?.position.set(pose.x, 0, -pose.y);
    truck.current?.rotation.set(0, pose.yaw, 0);
    pose.wheels.forEach((wheel, index) => wheelRefs.current[index]?.position.setY(wheel.centre));
    const fronts = pose.wheels.filter((wheel) => wheel.axle === "front");
    const rears = pose.wheels.filter((wheel) => wheel.axle === "rear");
    const mean = (set: typeof fronts) => set.reduce((sum, wheel) => sum + wheel.centre, 0) / Math.max(set.length, 1);
    axleRefs.current[0]?.position.setY(mean(fronts));
    axleRefs.current[1]?.position.setY(mean(rears));
    body.current?.position.setY(pose.bodyZ);
    // three.js: +x rotation leans the top to the right, +z raises the nose.
    body.current?.rotation.set(pose.bodyRoll, 0, pose.bodyPitch);
  }, -1);

  const scene = { doc, series, impacts, live, mode };
  const spray = look.spray;

  return (
    <>
      {realistic && animateWeather && look.rain > 0 && <Rain live={live} heavy={look.rain === 2} quality={quality} />}
      <group
        ref={view}
        onPointerMissed={() => {
          live.current.activeStrap = -1;
          invalidate();
        }}
        onPointerMove={() => invalidate()}
      >
        <RoadScene path={path} look={look} mode={mode} />
        {realistic && animateWeather && spray !== "none" && (
          <WheelSpray path={path} live={live} kind={spray} quality={quality} bed={doc.bed} />
        )}
        <group ref={truck}>
          {contactShadow && <ContactShadow path={path} live={live} bed={doc.bed} />}
          <Wheels bed={doc.bed} mode={mode} wheelRefs={wheelRefs} axleRefs={axleRefs} />
          <group ref={body} position={[0, floorHeight, 0]}>
            <TruckBody bed={doc.bed} mode={mode} />
            <Units {...scene} unitHandlers={unitHandlers} />
            <Lashings {...scene} />
            <ForceArrows doc={doc} live={live} />
            {push && <PushArrow doc={doc} live={live} push={push.state} />}
            <ImpactFlash impacts={impacts} live={live} />
            {mode === "engineering" && (
              <>
                <Contacts live={live} />
                <group position={[-doc.bed.length_m / 2, 0.02, -doc.bed.width_m / 2]}>
                  <AxisTriad length={0.9} />
                </group>
              </>
            )}
          </group>
        </group>
      </group>
      <Labels
        {...scene}
        overlay={overlay}
        format={format}
        anchor={body}
        compact={compact}
        selectedUnit={selectedUnit}
        onSelectUnit={onSelectUnit}
      />
    </>
  );
}

function CameraRig({
  view,
  controlsRef,
}: {
  view: CameraView;
  /** Receives the camera controls, so a drag on a unit can hold the camera still. */
  controlsRef: RefObject<OrbitControls | null>;
}) {
  const camera = useThree((state) => state.camera);
  const canvas = useThree((state) => state.gl.domElement);
  const aspect = useThree((state) => state.size.width / state.size.height);
  const invalidate = useThree((state) => state.invalidate);
  const touched = useRef(false);

  // Frame the whole truck: narrower viewports need the camera further away.
  useEffect(() => {
    if (touched.current) return;
    const distance = VIEW_DISTANCE[view] * Math.max(1, 1.6 / aspect);
    const direction = new Vector3(...VIEW_DIRECTION[view]).normalize();
    camera.position.set(
      TARGET[0] + direction.x * distance,
      TARGET[1] + direction.y * distance,
      TARGET[2] + direction.z * distance,
    );
    camera.lookAt(...TARGET);
    controlsRef.current?.update();
    invalidate();
  }, [aspect, camera, view, invalidate, controlsRef]);

  useEffect(() => {
    const orbit = new OrbitControls(camera, canvas);
    orbit.target.set(...TARGET);
    orbit.enablePan = false;
    orbit.enableZoom = false; // the page keeps the scroll wheel
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.08;
    orbit.rotateSpeed = 0.6;
    orbit.minPolarAngle = 0.35;
    orbit.maxPolarAngle = 1.5; // never below the road
    const onStart = () => {
      touched.current = true;
    };
    const onChange = () => invalidate();
    orbit.addEventListener("start", onStart);
    orbit.addEventListener("change", onChange);
    orbit.update();
    controlsRef.current = orbit;
    return () => {
      orbit.removeEventListener("start", onStart);
      orbit.removeEventListener("change", onChange);
      orbit.dispose();
      controlsRef.current = null;
    };
  }, [camera, canvas, invalidate, controlsRef]);

  useFrame(() => controlsRef.current?.update());
  return null;
}
