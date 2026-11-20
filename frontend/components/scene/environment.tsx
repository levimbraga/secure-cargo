"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  CanvasTexture,
  type Group,
  type InstancedMesh,
  Object3D,
  PMREMGenerator,
  RepeatWrapping,
  SRGBColorSpace,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

import type { KeyframesDoc } from "@/lib/keyframes";
import { type Quality, QUALITY_SETTINGS } from "@/lib/quality";

import { COLOR, type SceneProps, type ViewMode } from "./shared";

/** Length of road drawn ahead of and behind the truck [m]. */
const HALF_LENGTH = 90;
/** One dash and one gap of the lane line [m]. */
const DASH_PERIOD = 12;
const DASH_LENGTH = 4;
/** Distance between roadside posts [m]. */
const POST_PERIOD = 8;
const ROAD_HALF_WIDTH = 5.2;

/** How far the cab reaches in front of the bed, and the soft border of the contact shadow [m]. */
const CAB_REACH = 2.3;
const SHADOW_BORDER = 0.9;

/**
 * Light of each view. At high quality the realistic view is lit by an image of a studio room
 * generated in the browser (no file to download) plus one sun with soft shadows; the
 * renderer's ACES tone mapping and soft shadow maps are switched on by the canvas. At low
 * quality (phones, weak GPUs) the same sun and a sky light stand in for the image, and nothing
 * casts a shadow map.
 */
export function Lighting({ mode, quality = "high" }: { mode: ViewMode; quality?: Quality }) {
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

  return (
    <>
      {/* The far end of the road fades into the colour of the page. */}
      <fog attach="fog" args={[COLOR.surface, 38, 95]} />
      {environment ? (
        <>
          <primitive attach="environment" object={environment.texture} />
          <hemisphereLight args={["#ffffff", "#8d8d86", 0.55]} />
          <directionalLight
            position={[-7, 13, 8]}
            intensity={2.4}
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
          <hemisphereLight args={["#ffffff", "#a3a39c", 2.5]} />
          <directionalLight position={[-7, 13, 8]} intensity={2.2} />
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

/** A dark patch with soft edges, as the alpha of a small texture. */
function shadowTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context) {
    const image = context.createImageData(canvas.width, canvas.height);
    const ease = (k: number) => k * k * (3 - 2 * k);
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        // Distance to the nearest edge as a share of the soft border: 0 at the edge, 1 inside.
        const u = Math.min(x + 0.5, canvas.width - x - 0.5) / (canvas.width * 0.16);
        const v = Math.min(y + 0.5, canvas.height - y - 0.5) / (canvas.height * 0.3);
        image.data[(y * canvas.width + x) * 4 + 3] = 255 * ease(Math.min(u, 1)) * ease(Math.min(v, 1));
      }
    }
    context.putImageData(image, 0, 0);
  }
  return new CanvasTexture(canvas);
}

/**
 * The shadow of the truck when shadow maps are off: one flat, soft patch on the road under
 * it. The truck stands still in the scene, so the patch does too.
 */
export function ContactShadow({ bed }: { bed: KeyframesDoc["bed"] }) {
  const texture = useMemo(() => shadowTexture(), []);
  useEffect(() => () => texture.dispose(), [texture]);
  const rear = -bed.length_m / 2 - SHADOW_BORDER;
  const front = bed.length_m / 2 + CAB_REACH + SHADOW_BORDER;

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(rear + front) / 2, 0.02, 0]}>
      <planeGeometry args={[front - rear, bed.width_m + SHADOW_BORDER * 2]} />
      <meshBasicMaterial map={texture} color="#000000" transparent opacity={0.36} depthWrite={false} />
    </mesh>
  );
}

function checkerTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#d9d9d3";
    context.fillRect(0, 0, 64, 64);
    context.fillStyle = "#c2c2bb";
    context.fillRect(0, 0, 32, 32);
    context.fillRect(32, 32, 32, 32);
  }
  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Fine grain, so the asphalt does not read as a flat fill and visibly streams past. */
function asphaltTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = COLOR.asphalt;
    context.fillRect(0, 0, 128, 128);
    // A fixed pattern (no randomness between visits): a small linear congruential generator.
    let seed = 7;
    for (let i = 0; i < 900; i++) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const x = seed % 128;
      const y = Math.floor(seed / 128) % 128;
      const shade = 96 + (seed % 40);
      context.fillStyle = `rgb(${shade},${shade},${shade - 4})`;
      context.fillRect(x, y, 2, 1);
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/**
 * The road under the truck. Every pose in a replay is relative to the truck, so the truck
 * stands still and the road streams past at the truck's real speed: lane dashes, roadside
 * posts and the texture of the surface all move by the distance covered so far.
 */
export function Road({ live, mode }: Pick<SceneProps, "live" | "mode">) {
  const realistic = mode === "realistic";
  const texture = useMemo(() => (realistic ? asphaltTexture() : checkerTexture()), [realistic]);
  useEffect(() => () => texture.dispose(), [texture]);
  const dashes = useRef<Group>(null);
  const posts = useRef<Group>(null);

  // One texture tile is 2 m of checker (two squares) or 3 m of asphalt.
  const tile = realistic ? 3 : 2;
  const length = HALF_LENGTH * 2;
  const width = realistic ? ROAD_HALF_WIDTH * 2 : 60;
  useEffect(() => {
    texture.repeat.set(length / tile, width / tile);
  }, [texture, length, width, tile]);

  useFrame(() => {
    const { distance } = live.current;
    // The road moves backwards under a truck that drives forwards.
    texture.offset.setX((distance / tile) % 1);
    dashes.current?.position.setX(-(distance % DASH_PERIOD));
    posts.current?.position.setX(-(distance % POST_PERIOD));
  });

  return (
    <group>
      {realistic && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
          <planeGeometry args={[length, 80]} />
          <meshStandardMaterial color={COLOR.surface} roughness={1} />
        </mesh>
      )}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[length, width]} />
        {realistic ? (
          <meshStandardMaterial map={texture} roughness={0.95} />
        ) : (
          <meshBasicMaterial map={texture} />
        )}
      </mesh>
      {realistic && (
        <>
          {/* Solid edge lines do not show motion; the dashed centre line and the posts do. */}
          {[-ROAD_HALF_WIDTH + 0.3, ROAD_HALF_WIDTH - 0.3].map((z) => (
            <mesh key={z} position={[0, 0.006, z]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[length, 0.12]} />
              <meshBasicMaterial color={COLOR.marking} />
            </mesh>
          ))}
          {/* The truck drives in the middle lane: a dashed line on each side of it. */}
          <group ref={dashes}>
            <Repeated period={DASH_PERIOD} position={[0, 0.006, -1.9]} size={[DASH_LENGTH, 0.012, 0.13]} color={COLOR.marking} />
            <Repeated period={DASH_PERIOD} position={[0, 0.006, 1.9]} size={[DASH_LENGTH, 0.012, 0.13]} color={COLOR.marking} />
          </group>
          <group ref={posts}>
            <Repeated period={POST_PERIOD} position={[0, 0.5, -ROAD_HALF_WIDTH - 0.5]} size={[0.1, 1, 0.1]} color={COLOR.marking} shadows />
            <Repeated period={POST_PERIOD} position={[0, 0.82, -ROAD_HALF_WIDTH - 0.44]} size={[0.11, 0.16, 0.02]} color={COLOR.amber} />
            <Repeated period={POST_PERIOD} position={[0, 0.5, ROAD_HALF_WIDTH + 0.5]} size={[0.1, 1, 0.1]} color={COLOR.marking} shadows />
            <Repeated period={POST_PERIOD} position={[0, 0.82, ROAD_HALF_WIDTH + 0.44]} size={[0.11, 0.16, 0.02]} color={COLOR.amber} />
          </group>
        </>
      )}
    </group>
  );
}

/** The same box every `period` metres along the road, as one instanced mesh. */
function Repeated({
  period,
  position,
  size,
  color,
  shadows = false,
}: {
  period: number;
  position: [number, number, number];
  size: [number, number, number];
  color: string;
  shadows?: boolean;
}) {
  const mesh = useRef<InstancedMesh>(null);
  const count = Math.ceil((HALF_LENGTH * 2) / period) + 1;

  useEffect(() => {
    if (!mesh.current) return;
    const dummy = new Object3D();
    for (let index = 0; index < count; index++) {
      dummy.position.set(position[0] + (index - Math.floor(count / 2)) * period, position[1], position[2]);
      dummy.updateMatrix();
      mesh.current.setMatrixAt(index, dummy.matrix);
    }
    mesh.current.instanceMatrix.needsUpdate = true;
  }, [count, period, position]);

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]} castShadow={shadows} frustumCulled={false}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={0.7} />
    </instancedMesh>
  );
}
