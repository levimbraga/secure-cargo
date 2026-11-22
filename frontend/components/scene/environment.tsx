"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { type RefObject, useEffect, useMemo, useRef } from "react";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  type InstancedMesh,
  type LineSegments,
  type Mesh,
  Object3D,
  PMREMGenerator,
  type Points,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

import { type Quality, QUALITY_SETTINGS } from "@/lib/quality";
import type { Look } from "@/lib/scene/look";
import { poseAt, roadFrame, roadHeight, roadPoint, type ScenePath, shadowGrid } from "@/lib/scene/motion";
import {
  bumpPaintMesh,
  markingsMesh,
  type MeshData,
  pathLineMesh,
  puddles as puddleSpots,
  roadSurfaceMesh,
  shoulderMeshes,
} from "@/lib/scene/road-mesh";
import { WHEEL_RADIUS, wheelLayout } from "@/lib/scene/truck-geometry";

import { COLOR, type Live, type ViewMode } from "./shared";
import { checkerTexture, puffTexture, ROAD_TILING, roadTexture, shadowTexture } from "./textures";

/**
 * Light and sky of each view. At high quality the realistic view is lit by an image of a studio
 * room generated in the browser (no file to download) plus one sun with soft shadows; at low
 * quality (phones, weak GPUs) the same sun and a sky light stand in for the image, and nothing
 * casts a shadow map. Rain and fog dim the sun and grey the sky (`lib/scene/look.ts`).
 */
export function Lighting({ mode, quality = "high", look }: { mode: ViewMode; quality?: Quality; look: Look }) {
  const gl = useThree((state) => state.gl);
  const realistic = mode === "realistic";
  const settings = QUALITY_SETTINGS[quality];
  const imageLit = realistic && settings.environment;

  const environment = useMemo(() => {
    if (!imageLit) return null;
    const generator = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const target = generator.fromScene(room, 0.04);
    generator.dispose();
    room.dispose();
    return target;
  }, [gl, imageLit]);
  useEffect(() => () => environment?.dispose(), [environment]);


  const sun = look.sun;
  const fog = realistic ? look.fog : ([38, 95] as const);
  return (
    <>
      {/* A grey sky behind a wet or foggy road; the page's own colour otherwise. */}
      {realistic && look.sky && <color attach="background" args={[look.sky]} />}
      {/* The far end of the road fades into the sky (or the colour of the page). */}
      <fog attach="fog" args={[realistic ? look.fogColor : COLOR.surface, fog[0], fog[1]]} />
      {environment ? (
        <>
          <primitive attach="environment" object={environment.texture} />
          <hemisphereLight args={[look.hemisphere[0], look.hemisphere[1], 0.55 * Math.max(sun, 0.6)]} />
          <directionalLight
            position={[-7, 13, 8]}
            intensity={2.4 * sun}
            castShadow={settings.shadows}
            shadow-mapSize={[1024, 1024]}
            shadow-camera-left={-9}
            shadow-camera-right={9}
            shadow-camera-top={9}
            shadow-camera-bottom={-9}
            shadow-camera-near={1}
            shadow-camera-far={40}
            shadow-bias={-0.0004}
            shadow-radius={5}
          />
        </>
      ) : realistic ? (
        <>
          {/* No image to light from: a brighter sky, the same sun and a fill from the camera side. */}
          <hemisphereLight args={[look.hemisphere[0], look.hemisphere[1], 2.5 * Math.max(sun, 0.6)]} />
          <directionalLight position={[-7, 13, 8]} intensity={2.2 * sun} />
          <directionalLight position={[6, 4, 10]} intensity={0.6} />
        </>
      ) : (
        <>
          <ambientLight intensity={2.1} />
          <directionalLight position={[-5, 9, 6]} intensity={1.6} />
        </>
      )}
    </>
  );
}

function toGeometry(mesh: MeshData): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("uv", new BufferAttribute(mesh.uvs, 2));
  geometry.setAttribute("color", new BufferAttribute(mesh.colors, 3));
  geometry.setIndex(new BufferAttribute(mesh.indices, 1));
  geometry.computeVertexNormals();
  return geometry;
}

function rgb(hex: string): [number, number, number] {
  const color = new Color(hex);
  return [color.r, color.g, color.b];
}

function useDisposed<T extends { dispose(): void }>(items: T[]): void {
  useEffect(() => () => items.forEach((item) => item.dispose()), [items]);
}

/**
 * The road of the run, in world coordinates: it curves where the run's sideways acceleration
 * was a curve, goes down a descent's grade, and has the run's pothole or speed bump where the
 * truck meets it. Built once per run; the view moves around the truck, not the road.
 */
export function RoadScene({ path, look, mode }: { path: ScenePath; look: Look; mode: ViewMode }) {
  return mode === "realistic" ? <RealisticRoad path={path} look={look} /> : <EngineeringGround path={path} />;
}

function RealisticRoad({ path, look }: { path: ScenePath; look: Look }) {
  const { halfWidth } = look;
  const texture = useMemo(() => roadTexture(look.road.texture), [look.road.texture]);
  const geometries = useMemo(() => {
    const tiling = ROAD_TILING[look.road.texture];
    const surface = toGeometry(roadSurfaceMesh(path, halfWidth, tiling));
    const shoulders = shoulderMeshes(path, halfWidth, rgb(look.verge), rgb(look.shoulder)).map(toGeometry);
    const markings = look.markings ? toGeometry(markingsMesh(path, halfWidth)) : null;
    const bump = bumpPaintMesh(path, halfWidth);
    return { surface, shoulders, markings, bump: bump ? toGeometry(bump) : null };
  }, [path, halfWidth, look.road.texture, look.verge, look.shoulder, look.markings]);
  const all = useMemo(
    () => [geometries.surface, ...geometries.shoulders, ...(geometries.markings ? [geometries.markings] : []), ...(geometries.bump ? [geometries.bump] : []), texture],
    [geometries, texture],
  );
  useDisposed(all);
  const wet = look.road.roughness < 0.5;

  return (
    <group>
      <mesh geometry={geometries.surface} receiveShadow>
        <meshStandardMaterial
          map={texture}
          vertexColors
          color={look.road.color}
          roughness={look.road.roughness}
          metalness={look.road.metalness}
          envMapIntensity={look.road.envIntensity}
        />
      </mesh>
      {geometries.shoulders.map((geometry, index) => (
        <mesh key={index} geometry={geometry} receiveShadow>
          <meshStandardMaterial vertexColors roughness={1} />
        </mesh>
      ))}
      {geometries.markings && (
        <mesh geometry={geometries.markings} receiveShadow>
          <meshStandardMaterial color={COLOR.marking} roughness={wet ? 0.3 : 0.7} polygonOffset polygonOffsetFactor={-2} />
        </mesh>
      )}
      {geometries.bump && (
        <mesh geometry={geometries.bump} receiveShadow>
          <meshStandardMaterial vertexColors roughness={0.6} polygonOffset polygonOffsetFactor={-2} />
        </mesh>
      )}
      {look.puddles && <Puddles path={path} halfWidth={halfWidth} />}
      <Posts path={path} halfWidth={halfWidth} />
    </group>
  );
}

/** Standing water of heavy rain: dark mirrors lying on the road. */
function Puddles({ path, halfWidth }: { path: ScenePath; halfWidth: number }) {
  const mesh = useRef<InstancedMesh>(null);
  const spots = useMemo(() => puddleSpots(path, halfWidth), [path, halfWidth]);
  useEffect(() => {
    if (!mesh.current) return;
    const dummy = new Object3D();
    spots.forEach((spot, index) => {
      const [x, y] = roadPoint(path.road, spot.s, spot.d);
      dummy.position.set(x, roadHeight(path, spot.s, spot.d) + 0.004, -y);
      dummy.rotation.set(-Math.PI / 2, 0, spot.yaw);
      dummy.scale.set(spot.length, spot.width, 1);
      dummy.updateMatrix();
      mesh.current?.setMatrixAt(index, dummy.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  }, [spots, path]);
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, spots.length]} frustumCulled={false} receiveShadow>
      <circleGeometry args={[0.5, 20]} />
      <meshStandardMaterial color="#3f454b" roughness={0.04} metalness={0.4} transparent opacity={0.8} polygonOffset polygonOffsetFactor={-3} />
    </instancedMesh>
  );
}

/** Roadside posts every 8 m on both sides: they show the speed and the bends of the road. */
function Posts({ path, halfWidth }: { path: ScenePath; halfWidth: number }) {
  const posts = useRef<InstancedMesh>(null);
  const reflectors = useRef<InstancedMesh>(null);
  const spots = useMemo(() => {
    const end = path.s[path.s.length - 1] ?? 0;
    const out: { x: number; y: number; z: number; yaw: number }[] = [];
    for (let s = -96; s < end + 180; s += 8) {
      const frame = roadFrame(path.road, s);
      for (const side of [-1, 1]) {
        const [x, y] = roadPoint(path.road, s, side * (halfWidth + 0.5));
        out.push({ x, y, z: frame.z, yaw: frame.heading });
      }
    }
    return out;
  }, [path, halfWidth]);
  useEffect(() => {
    const dummy = new Object3D();
    spots.forEach((spot, index) => {
      dummy.rotation.set(0, spot.yaw, 0);
      dummy.position.set(spot.x, spot.z + 0.5, -spot.y);
      dummy.updateMatrix();
      posts.current?.setMatrixAt(index, dummy.matrix);
      dummy.position.set(spot.x, spot.z + 0.82, -spot.y);
      dummy.updateMatrix();
      reflectors.current?.setMatrixAt(index, dummy.matrix);
    });
    if (posts.current) posts.current.instanceMatrix.needsUpdate = true;
    if (reflectors.current) reflectors.current.instanceMatrix.needsUpdate = true;
  }, [spots]);
  return (
    <>
      <instancedMesh ref={posts} args={[undefined, undefined, spots.length]} castShadow frustumCulled={false}>
        <boxGeometry args={[0.1, 1, 0.1]} />
        <meshStandardMaterial color={COLOR.marking} roughness={0.7} />
      </instancedMesh>
      <instancedMesh ref={reflectors} args={[undefined, undefined, spots.length]} frustumCulled={false}>
        <boxGeometry args={[0.02, 0.16, 0.12]} />
        <meshStandardMaterial color={COLOR.amber} roughness={0.5} />
      </instancedMesh>
    </>
  );
}

/** Engineering view: a flat checker ground and the path the truck drives over the run. */
function EngineeringGround({ path }: { path: ScenePath }) {
  const texture = useMemo(() => checkerTexture(), []);
  const line = useMemo(() => toGeometry(pathLineMesh(path)), [path]);
  useDisposed(useMemo(() => [texture, line], [texture, line]));
  const size = 240;
  useEffect(() => {
    texture.repeat.set(size / 2, size / 2);
  }, [texture]);
  // The checker is centred on the run's middle; it is big enough for the longest trips.
  const mid = Math.floor((path.s[path.s.length - 1] ?? 0) / 2 / 2) * 2;
  const [x, y] = roadPoint(path.road, mid, 0);
  const cx = Math.round(x / 2) * 2;
  const cy = Math.round(y / 2) * 2;
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0, -cy]}>
        <planeGeometry args={[size, size]} />
        <meshBasicMaterial map={texture} />
      </mesh>
      <mesh geometry={line}>
        <meshBasicMaterial color={COLOR.amber} />
      </mesh>
    </group>
  );
}

/**
 * The shadow of the truck when shadow maps are off: a soft patch lying on the road right under
 * the truck (bumps, holes and grades included), in the truck's own frame.
 */
export function ContactShadow({ path, live, bed }: { path: ScenePath; live: RefObject<Live>; bed: Parameters<typeof shadowGrid>[2] }) {
  const texture = useMemo(() => shadowTexture(), []);
  const columns = 9;
  const rows = 3;
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    const uvs = new Float32Array(columns * rows * 2);
    const indices: number[] = [];
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        uvs.set([column / (columns - 1), row / (rows - 1)], (row * columns + column) * 2);
        if (row < rows - 1 && column < columns - 1) {
          const a = row * columns + column;
          indices.push(a, a + 1, a + columns, a + 1, a + columns + 1, a + columns);
        }
      }
    }
    g.setAttribute("position", new BufferAttribute(new Float32Array(columns * rows * 3), 3));
    g.setAttribute("uv", new BufferAttribute(uvs, 2));
    g.setIndex(indices);
    return g;
  }, []);
  useDisposed(useMemo(() => [texture, geometry], [texture, geometry]));
  const mesh = useRef<Mesh>(null);
  useFrame(() => {
    const pose = live.current.pose;
    if (!pose) return;
    const attribute = geometry.getAttribute("position") as BufferAttribute;
    shadowGrid(path, pose, bed, columns, rows).forEach((point, index) => attribute.setXYZ(index, point.x, point.z, -point.y));
    attribute.needsUpdate = true;
    geometry.computeBoundingSphere();
  });
  return (
    <mesh ref={mesh} geometry={geometry} frustumCulled={false}>
      <meshBasicMaterial map={texture} color="#000000" transparent opacity={0.36} depthWrite={false} />
    </mesh>
  );
}

/** Rain drops per quality level: thin streaks around the truck, blown back by its speed. */
const RAIN_DROPS: Record<Quality, [number, number]> = { high: [1400, 2600], low: [320, 600] };
const RAIN_BOX = { x: [-26, 26], y: [0, 14], z: [-15, 15] } as const;

/** `count` tuples of `size` numbers in [0, 1): a fixed pseudo-random pattern per seed. */
function randomTuples(count: number, size: number, seed: number): number[][] {
  let state = seed;
  const out: number[][] = [];
  for (let i = 0; i < count; i++) {
    const tuple: number[] = [];
    for (let j = 0; j < size; j++) {
      state = (state * 1103515245 + 12345) % 2147483648;
      tuple.push(state / 2147483648);
    }
    out.push(tuple);
  }
  return out;
}

function wrap(value: number, low: number, high: number): number {
  const span = high - low;
  return low + ((((value - low) % span) + span) % span);
}

/**
 * Rain, in the camera's frame (the truck stays near the middle of the view). Every drop is a
 * fixed function of the replay time, so a paused replay keeps it still and two captures of
 * the same instant are the same.
 */
export function Rain({ live, heavy, quality }: { live: RefObject<Live>; heavy: boolean; quality: Quality }) {
  const count = RAIN_DROPS[quality][heavy ? 1 : 0];
  const lines = useRef<LineSegments>(null);
  const { geometry, seeds } = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(count * 6), 3));
    const s = randomTuples(count, 4, 5).map(([a = 0, b = 0, c = 0, d = 0]) => [a, b, c, 0.8 + d * 0.4] as const);
    return { geometry: g, seeds: s };
  }, [count]);
  useDisposed(useMemo(() => [geometry], [geometry]));
  useFrame(() => {
    const pose = live.current.pose;
    if (!pose) return;
    const attribute = geometry.getAttribute("position") as BufferAttribute;
    const fall = heavy ? 10 : 8.5;
    const length = heavy ? 0.55 : 0.42;
    // Seen from the truck, the rain comes at it: the streaks lean back by speed / fall speed.
    const lean = (Math.min(pose.v, 30) / fall) * length;
    const [x0, x1] = RAIN_BOX.x;
    const [y0, y1] = RAIN_BOX.y;
    const [z0, z1] = RAIN_BOX.z;
    seeds.forEach(([a, b, c, k], index) => {
      const x = wrap(x0 + a * (x1 - x0) - pose.s, x0, x1);
      const y = wrap(y0 + b * (y1 - y0) - fall * k * pose.t, y0, y1);
      const z = z0 + c * (z1 - z0);
      attribute.setXYZ(index * 2, x, y, z);
      attribute.setXYZ(index * 2 + 1, x + lean, y + length, z);
    });
    attribute.needsUpdate = true;
  });
  return (
    <lineSegments ref={lines} geometry={geometry} frustumCulled={false}>
      <lineBasicMaterial color="#eef3f6" transparent opacity={heavy ? 0.6 : 0.5} depthWrite={false} />
    </lineSegments>
  );
}

const SPRAY_PARTICLES: Record<Quality, number> = { high: 600, low: 200 };

const SPRAY_STYLE = {
  water: { color: "#e9eef2", life: 1.0, size: 0.75, lift: [0.3, 0.9], up: [1.5, 3.5], side: [0.2, 1.8], back: [0.5, 4], drag: 0.15, gravity: 4, alpha: 0.2 },
  mud: { color: "#4f3b26", life: 0.7, size: 0.32, lift: [0.2, 0.7], up: [1.0, 2.6], side: [0.2, 1.2], back: [0.5, 3], drag: 0.1, gravity: 9, alpha: 0.9 },
  dust: { color: "#a88f68", life: 2.6, size: 2.2, lift: [0.1, 0.5], up: [0.3, 1.2], side: [0.2, 1.6], back: [0.3, 2.5], drag: 0.08, gravity: -0.1, alpha: 0.7 },
} as const;

/**
 * What the tyres throw up: spray on a wet road, clods on a muddy one, dust behind the wheels
 * on gravel. Each particle is born at a rear tyre at a time that depends only on the replay
 * time, so it stays where it was left on the road, and there is more of it the faster the
 * truck goes (none when it stands still).
 */
export function WheelSpray({
  path,
  live,
  kind,
  quality,
  bed,
}: {
  path: ScenePath;
  live: RefObject<Live>;
  kind: keyof typeof SPRAY_STYLE;
  quality: Quality;
  bed: Parameters<typeof wheelLayout>[0];
}) {
  const style = SPRAY_STYLE[kind];
  const count = SPRAY_PARTICLES[quality];
  const points = useRef<Points>(null);
  const texture = useMemo(() => puffTexture(), []);
  const emitters = useMemo(() => wheelLayout(bed).filter((wheel) => wheel.axle === "rear"), [bed]);
  const { geometry, seeds } = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute("color", new BufferAttribute(new Float32Array(count * 4), 4));
    return { geometry: g, seeds: randomTuples(count, 3, 9) };
  }, [count]);
  useDisposed(useMemo(() => [geometry, texture], [geometry, texture]));
  const tint = useMemo(() => new Color(style.color), [style.color]);

  useFrame(() => {
    const t = live.current.pose?.t ?? live.current.t;
    const position = geometry.getAttribute("position") as BufferAttribute;
    const color = geometry.getAttribute("color") as BufferAttribute;
    seeds.forEach(([a = 0, b = 0, c = 0], index) => {
      const emitter = emitters[index % emitters.length];
      if (!emitter) return;
      const age = wrap(t + (index / count) * style.life, 0, style.life);
      const born = t - age;
      const pose = poseAt(path, born);
      const cos = Math.cos(pose.yaw);
      const sin = Math.sin(pose.yaw);
      // Behind the tyre, at the road.
      const lx = emitter.x - WHEEL_RADIUS * 0.9;
      const ly = emitter.y + (emitter.y > 0 ? 0.25 : -0.25);
      const ex = pose.x + lx * cos - ly * sin;
      const ey = pose.y + lx * sin + ly * cos;
      const ground = path.flat ? 0 : roadFrame(path.road, pose.s + lx).z;
      const outward = (emitter.y > 0 ? 1 : -1) * (style.side[0] + a * (style.side[1] - style.side[0]));
      const up = style.up[0] + b * (style.up[1] - style.up[0]);
      // Thrown back from the tyre and dragged along a little by the truck.
      const forward = pose.v * style.drag - (style.back[0] + c * (style.back[1] - style.back[0]));
      const vx = forward * cos - outward * sin;
      const vy = forward * sin + outward * cos;
      const x = ex + vx * age;
      const y = ey + vy * age;
      const lift = style.lift[0] + ((a + b) % 1) * (style.lift[1] - style.lift[0]);
      const z = Math.max(ground + lift + up * age - 0.5 * style.gravity * age * age, ground + 0.03);
      position.setXYZ(index, x, z, -y);
      const strength = Math.min(pose.v / 16, 1) * (1 - age / style.life);
      color.setXYZW(index, tint.r, tint.g, tint.b, Math.max(strength, 0) * style.alpha);
    });
    position.needsUpdate = true;
    color.needsUpdate = true;
  });

  return (
    <points ref={points} geometry={geometry} frustumCulled={false}>
      <pointsMaterial map={texture} size={style.size} vertexColors transparent depthWrite={false} sizeAttenuation />
    </points>
  );
}
