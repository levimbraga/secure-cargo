"use client";

import { type ReactNode, useEffect, useMemo } from "react";
import { BoxGeometry, BufferAttribute, type BufferGeometry, CanvasTexture, Color, RepeatWrapping, SRGBColorSpace } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import type { Vec3 } from "@/lib/keyframes";

import { COLOR } from "./shared";

/**
 * What each cargo unit looks like in the realistic view. Every model fills exactly the box (or
 * the cylinder) the simulation used, centred on the unit's centre; only its looks differ. Small
 * parts are merged into one geometry per unit, so a truck full of pallets stays a few dozen draw
 * calls on a phone. Textures are painted on canvases with a fixed pseudo-random pattern.
 */

function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function canvasTexture(width: number, height: number, draw: (context: CanvasRenderingContext2D, next: () => number) => void, seed = 1): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context) draw(context, random(seed));
  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Two by two cartons, each its own shade, with packing tape and a shipping label. */
function cartonsTexture(): CanvasTexture {
  return canvasTexture(256, 256, (context, next) => {
    for (let row = 0; row < 2; row++) {
      for (let column = 0; column < 2; column++) {
        const x = column * 128;
        const y = row * 128;
        const shade = Math.round(next() * 18);
        context.fillStyle = `rgb(${196 - shade},${156 - shade},${104 - shade})`;
        context.fillRect(x, y, 128, 128);
        const gradient = context.createLinearGradient(x, y, x, y + 128);
        gradient.addColorStop(0, "rgba(255,255,255,0.08)");
        gradient.addColorStop(1, "rgba(0,0,0,0.1)");
        context.fillStyle = gradient;
        context.fillRect(x, y, 128, 128);
        context.fillStyle = "rgba(225,200,150,0.75)";
        context.fillRect(x + 56, y, 16, 128);
        if (next() > 0.35) {
          context.fillStyle = "#f2f0ea";
          const lx = x + 14 + next() * 24;
          const ly = y + 70 + next() * 24;
          context.fillRect(lx, ly, 34, 24);
          context.fillStyle = "#33332f";
          for (let line = 0; line < 4; line++) context.fillRect(lx + 4, ly + 4 + line * 5, 18 + next() * 8, 1.5);
        }
        context.strokeStyle = "rgba(90,62,30,0.85)";
        context.lineWidth = 3;
        context.strokeRect(x + 1.5, y + 1.5, 125, 125);
      }
    }
  }, 11);
}

/** Two by two woven sacks lying on their side: pillow-shaded, a printed band across each. */
function sacksTexture(): CanvasTexture {
  return canvasTexture(256, 256, (context, next) => {
    context.fillStyle = "#8f8a7a";
    context.fillRect(0, 0, 256, 256);
    for (let row = 0; row < 2; row++) {
      for (let column = 0; column < 2; column++) {
        const x = column * 128 + 64;
        const y = row * 128 + 64;
        const gradient = context.createRadialGradient(x - 14, y - 16, 6, x, y, 74);
        gradient.addColorStop(0, "#f3eee0");
        gradient.addColorStop(0.7, "#d9d1bc");
        gradient.addColorStop(1, "#a59d88");
        context.fillStyle = gradient;
        context.beginPath();
        context.roundRect(x - 61, y - 60, 122, 120, 26);
        context.fill();
        context.fillStyle = "rgba(40,90,140,0.55)";
        context.fillRect(x - 52, y - 8 + (next() - 0.5) * 6, 104, 14);
        for (let i = 0; i < 160; i++) {
          context.fillStyle = "rgba(120,110,90,0.12)";
          context.fillRect(x - 58 + next() * 116, y - 58 + next() * 116, 3, 1);
        }
      }
    }
  }, 13);
}

/** Two by two stacking crates of red plastic: ribs, a darker rim, a handle slot. */
function cratesTexture(): CanvasTexture {
  return canvasTexture(256, 256, (context) => {
    for (let row = 0; row < 2; row++) {
      for (let column = 0; column < 2; column++) {
        const x = column * 128;
        const y = row * 128;
        context.fillStyle = "#c2392b";
        context.fillRect(x, y, 128, 128);
        context.fillStyle = "#9c2a1f";
        for (let rib = 1; rib < 6; rib++) context.fillRect(x + rib * 21, y + 34, 4, 82);
        context.fillStyle = "#7d1f15";
        context.fillRect(x, y, 128, 8);
        context.fillRect(x, y + 120, 128, 8);
        context.fillStyle = "#2b1310";
        context.beginPath();
        context.roundRect(x + 44, y + 14, 40, 12, 6);
        context.fill();
      }
    }
  }, 17);
}

/** One side of a wooden crate: horizontal boards inside a frame, with a diagonal brace. */
function crateTexture(): CanvasTexture {
  return canvasTexture(256, 256, (context, next) => {
    for (let board = 0; board < 6; board++) {
      const shade = 170 + Math.round(next() * 24);
      context.fillStyle = `rgb(${shade + 10},${shade - 22},${shade - 80})`;
      context.fillRect(0, board * 43, 256, 43);
      context.fillStyle = "rgba(70,45,20,0.6)";
      context.fillRect(0, board * 43, 256, 2);
    }
    context.fillStyle = "#a98450";
    context.fillRect(0, 0, 256, 22);
    context.fillRect(0, 234, 256, 22);
    context.fillRect(0, 0, 22, 256);
    context.fillRect(234, 0, 22, 256);
    context.save();
    context.translate(128, 128);
    context.rotate(-Math.atan2(212, 212));
    context.fillRect(-150, -11, 300, 22);
    context.restore();
    context.strokeStyle = "rgba(70,45,20,0.6)";
    context.lineWidth = 2;
    context.strokeRect(22, 22, 212, 212);
    context.fillStyle = "#3a3a36";
    context.font = "bold 22px sans-serif";
    context.fillText("↑ ↑", 104, 74);
  }, 19);
}

/** Concentric wraps of steel strip on a coil's face (planar UV over the ring). */
function coilFaceTexture(): CanvasTexture {
  return canvasTexture(256, 256, (context, next) => {
    context.fillStyle = "#a6abae";
    context.fillRect(0, 0, 256, 256);
    for (let r = 20; r < 128; r += 1.5) {
      const shade = 140 + Math.round(next() * 60);
      context.strokeStyle = `rgba(${shade},${shade + 3},${shade + 6},0.6)`;
      context.lineWidth = 1;
      context.beginPath();
      context.arc(128, 128, r, 0, Math.PI * 2);
      context.stroke();
    }
  }, 23);
}

const TEXTURES = { cartons: cartonsTexture, sacks: sacksTexture, crates: cratesTexture, crate: crateTexture, coilFace: coilFaceTexture } as const;
type TextureName = keyof typeof TEXTURES;

function useTexture(name: TextureName): CanvasTexture {
  const texture = useMemo(() => TEXTURES[name](), [name]);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

/** Box sizes in the simulation are [x, y, z] with Z up; three.js boxes are [x, y-up, z]. */
export function boxArgs(size: Vec3): [number, number, number] {
  return [size[0], size[2], size[1]];
}

/** Boxes, each with its own colour, merged into one geometry with vertex colours. */
function mergedBoxes(parts: { size: [number, number, number]; at: [number, number, number]; color: string; turn?: number }[]): BufferGeometry {
  const color = new Color();
  const geometries = parts.map(({ size, at, color: hex, turn }) => {
    const box = new BoxGeometry(...size);
    if (turn) box.rotateY(turn);
    box.translate(...at);
    color.set(hex);
    const count = box.getAttribute("position").count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) colors.set([color.r, color.g, color.b], i * 3);
    box.setAttribute("color", new BufferAttribute(colors, 3));
    return box;
  });
  const merged = mergeGeometries(geometries) ?? new BoxGeometry(0.01, 0.01, 0.01);
  geometries.forEach((geometry) => geometry.dispose());
  return merged;
}

export const PALLET_HEIGHT = 0.144;

/**
 * A pallet as tall as `PALLET_HEIGHT`: a wooden one (bottom boards, nine blocks, stringer boards,
 * top boards with gaps) or a plastic one (a deck on nine feet).
 */
function Pallet({ size, y, plastic = false }: { size: Vec3; y: number; plastic?: boolean }) {
  const [length, width] = size;
  const geometry = useMemo(() => {
    const parts: Parameters<typeof mergedBoxes>[0] = [];
    const xs = [-length / 2 + 0.0725, 0, length / 2 - 0.0725];
    const zs = [-width / 2 + 0.05, 0, width / 2 - 0.05];
    if (plastic) {
      parts.push({ size: [length, 0.045, width], at: [0, PALLET_HEIGHT - 0.0225, 0], color: "#2f5f9e" });
      for (const x of xs) for (const z of zs) parts.push({ size: [0.16, 0.1, 0.14], at: [x, 0.05, z], color: "#2a5590" });
      for (const z of zs) parts.push({ size: [length, 0.02, 0.12], at: [0, 0.01, z], color: "#264d84" });
      return mergedBoxes(parts);
    }
    const next = random(Math.round(length * 1000 + width * 10));
    const wood = () => {
      const k = Math.round(next() * 26);
      return `rgb(${186 - k},${150 - k},${102 - k})`;
    };
    for (const z of zs) parts.push({ size: [length, 0.022, 0.1], at: [0, 0.011, z], color: wood() });
    for (const x of xs) for (const z of zs) parts.push({ size: [0.145, 0.078, 0.1], at: [x, 0.061, z], color: wood() });
    for (const x of xs) parts.push({ size: [0.145, 0.022, width], at: [x, 0.111, 0], color: wood() });
    const boards = 7;
    const board = 0.1;
    for (let n = 0; n < boards; n++) {
      const z = -width / 2 + board / 2 + (n * (width - board)) / (boards - 1);
      parts.push({ size: [length, 0.022, board], at: [0, 0.133, z], color: wood() });
    }
    return mergedBoxes(parts);
  }, [length, width, plastic]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} position={[0, y, 0]} castShadow receiveShadow>
      <meshStandardMaterial vertexColors roughness={plastic ? 0.55 : 0.85} />
    </mesh>
  );
}

/**
 * A block of goods standing on a pallet, with a texture of `cell` metres per tile on its faces
 * (or the whole face once, `cell` null).
 */
function Goods({ size, texture, cell = [0.8, 0.66], wrapped = false }: { size: Vec3; texture: CanvasTexture; cell?: [number, number] | null; wrapped?: boolean }) {
  const height = size[2] - PALLET_HEIGHT;
  const inset = 0.02;
  const maps = useMemo(() => {
    const faces: [number, number][] = [
      [size[1], height],
      [size[1], height],
      [size[0], size[1]],
      [size[0], size[1]],
      [size[0], height],
      [size[0], height],
    ];
    return faces.map(([u, v]) => {
      const map = texture.clone();
      map.repeat.set(cell ? Math.max(Math.round(u / cell[0]), 1) : 1, cell ? Math.max(Math.round(v / cell[1]), 1) : 1);
      map.needsUpdate = true;
      return map;
    });
  }, [texture, size, height, cell]);
  useEffect(() => () => maps.forEach((map) => map.dispose()), [maps]);

  return (
    <group position={[0, PALLET_HEIGHT / 2, 0]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[size[0] - inset * 2, height, size[1] - inset * 2]} />
        {maps.map((map, index) => (
          <meshStandardMaterial key={index} attach={`material-${index}`} map={map} roughness={0.8} />
        ))}
      </mesh>
      {wrapped && (
        // Stretch film: a glossy, nearly clear skin over the goods.
        <mesh>
          <boxGeometry args={[size[0] - 0.008, height + 0.004, size[1] - 0.008]} />
          <meshStandardMaterial color="#ffffff" transparent opacity={0.14} roughness={0.08} metalness={0.05} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

export function CargoModel({ kind, size }: { kind: string; size: Vec3 }): ReactNode {
  const cartons = useTexture("cartons");
  const sacks = useTexture("sacks");
  const crates = useTexture("crates");
  const crate = useTexture("crate");
  const [length, width, height] = size;
  const base = -height / 2;

  if (kind === "pallet") {
    return (
      <>
        <Pallet size={size} y={base} />
        <Goods size={size} texture={cartons} cell={[1.2, 1.0]} wrapped />
      </>
    );
  }
  if (kind === "sacks") {
    return (
      <>
        <Pallet size={size} y={base} />
        <Goods size={size} texture={sacks} cell={[1.2, 0.5]} wrapped />
      </>
    );
  }
  if (kind === "carton") {
    return (
      <>
        <mesh castShadow receiveShadow>
          <boxGeometry args={boxArgs(size)} />
          <meshStandardMaterial color="#c49a63" roughness={0.85} />
        </mesh>
        {/* Packing tape over the top and down the ends, and a label on the side. */}
        <mesh position={[0, height / 2 + 0.002, 0]}>
          <boxGeometry args={[length + 0.004, 0.004, 0.07]} />
          <meshStandardMaterial color="#dcc89f" roughness={0.45} />
        </mesh>
        {[-1, 1].map((end) => (
          <mesh key={end} position={[end * (length / 2 + 0.002), height / 2 - 0.08, 0]}>
            <boxGeometry args={[0.004, 0.16, 0.07]} />
            <meshStandardMaterial color="#dcc89f" roughness={0.45} />
          </mesh>
        ))}
        <mesh position={[length * 0.18, 0, width / 2 + 0.002]}>
          <boxGeometry args={[0.16, 0.11, 0.003]} />
          <meshStandardMaterial color="#f2f0ea" roughness={0.7} />
        </mesh>
      </>
    );
  }
  if (kind === "stack") {
    return (
      <>
        <Pallet size={size} y={base} plastic />
        <Goods size={size} texture={crates} cell={[1.2, 0.6]} />
      </>
    );
  }
  if (kind === "crate") {
    return (
      <>
        <Pallet size={size} y={base} />
        <Goods size={size} texture={crate} cell={null} />
      </>
    );
  }
  if (kind === "cabinet") {
    const steel = <meshStandardMaterial color="#d3d7d8" metalness={0.25} roughness={0.42} />;
    return (
      <>
        <mesh position={[0, base + 0.05, 0]}>
          <boxGeometry args={[length - 0.06, 0.1, width - 0.06]} />
          <meshStandardMaterial color={COLOR.chassis} roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.05, 0]} castShadow receiveShadow>
          <boxGeometry args={[length, height - 0.1, width]} />
          {steel}
        </mesh>
        {/* Two doors on each long side, with a seam and handles, and louvres near the top. */}
        {[-1, 1].map((side) => (
          <group key={side} position={[0, 0, side * (width / 2 + 0.003)]}>
            <mesh position={[0, 0.05, 0]}>
              <boxGeometry args={[0.012, height - 0.2, 0.006]} />
              <meshStandardMaterial color="#6b6f71" />
            </mesh>
            {[-1, 1].map((door) => (
              <mesh key={door} position={[door * 0.07, 0.1, side * 0.017]}>
                <boxGeometry args={[0.025, 0.28, 0.03]} />
                <meshStandardMaterial color="#3c3f41" metalness={0.4} roughness={0.3} />
              </mesh>
            ))}
            {[0, 1, 2, 3].map((row) => (
              <mesh key={row} position={[0, height / 2 - 0.22 - row * 0.05, 0.001 * side]}>
                <boxGeometry args={[length * 0.55, 0.018, 0.006]} />
                <meshStandardMaterial color="#8d9193" />
              </mesh>
            ))}
          </group>
        ))}
      </>
    );
  }
  if (kind === "machine") {
    const paint = <meshStandardMaterial color="#3b6178" metalness={0.2} roughness={0.42} />;
    const skid = 0.16;
    return (
      <>
        {/* Steel skid: two beams the full length of the unit, the surface that meets the floor. */}
        {[-1, 1].map((side) => (
          <mesh key={side} position={[0, base + skid / 2, side * (width / 2 - 0.09)]} castShadow>
            <boxGeometry args={[length, skid, 0.18]} />
            <meshStandardMaterial color="#5d6164" metalness={0.35} roughness={0.45} />
          </mesh>
        ))}
        <mesh position={[0, base + skid + 0.2, 0]} castShadow receiveShadow>
          <boxGeometry args={[length, 0.4, width]} />
          {paint}
        </mesh>
        {/* Housing up to the full height at one end, a motor and a control cabinet beside it. */}
        <mesh position={[-length * 0.2, (skid + 0.4) / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[length * 0.6, height - skid - 0.4, width * 0.86]} />
          {paint}
        </mesh>
        {/* A yellow guard rail along the housing's top edge and a warning stripe. */}
        <mesh position={[-length * 0.2, height / 2 - 0.02, 0]} castShadow>
          <boxGeometry args={[length * 0.62, 0.04, width * 0.88]} />
          <meshStandardMaterial color="#e3b21b" roughness={0.5} />
        </mesh>
        <mesh position={[length * 0.3, base + skid + 0.4 + 0.24, -width * 0.14]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.22, 0.22, length * 0.36, 24]} />
          <meshStandardMaterial color="#9a9fa2" metalness={0.4} roughness={0.35} />
        </mesh>
        {[-0.12, -0.04, 0.04, 0.12].map((k) => (
          <mesh key={k} position={[length * 0.3 + k * length, base + skid + 0.4 + 0.24, -width * 0.14]} rotation={[0, 0, Math.PI / 2]} userData={{ fine: true }}>
            <cylinderGeometry args={[0.235, 0.235, 0.015, 24]} />
            <meshStandardMaterial color="#7d8285" metalness={0.4} roughness={0.4} />
          </mesh>
        ))}
        <mesh position={[length * 0.34, base + skid + 0.4 + 0.3, width * 0.26]} castShadow>
          <boxGeometry args={[length * 0.24, 0.6, width * 0.3]} />
          <meshStandardMaterial color="#d6d8d8" metalness={0.15} roughness={0.45} />
        </mesh>
      </>
    );
  }
  return (
    <mesh castShadow receiveShadow>
      <boxGeometry args={boxArgs(size)} />
      <meshStandardMaterial color={COLOR.wood} roughness={0.8} />
    </mesh>
  );
}

/**
 * A coil, a drum or a pipe, filling exactly the cylinder the simulation used: `length` along its
 * axis (the cylinder's Y before `rotation`), `eye` the coil's inner radius.
 */
export function RoundCargo({ kind, diameter, length, eye, rotation }: { kind: string; diameter: number; length: number; eye: number; rotation: [number, number, number] }) {
  const radius = diameter / 2;
  const face = useTexture("coilFace");
  const bands = useMemo(() => {
    if (kind !== "coil") return null;
    // Three steel bands through the eye, a loop each: outside, inside and over both faces.
    const parts: Parameters<typeof mergedBoxes>[0] = [];
    const inner = eye > 0 ? eye : radius * 0.4;
    for (const angle of [Math.PI / 6, (5 * Math.PI) / 6, (3 * Math.PI) / 2]) {
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const along = (r: number) => ({ size: [0.006, length + 0.012, 0.045] as [number, number, number], at: [c * r, 0, s * r] as [number, number, number], color: "#5f6366", turn: -angle });
      parts.push(along(radius + 0.004), along(inner - 0.004));
      for (const end of [-1, 1]) {
        const middle = (radius + inner) / 2;
        parts.push({ size: [radius - inner + 0.01, 0.006, 0.045], at: [c * middle, end * (length / 2 + 0.004), s * middle], color: "#5f6366", turn: -angle });
      }
    }
    return mergedBoxes(parts);
  }, [kind, radius, length, eye]);
  useEffect(() => () => bands?.dispose(), [bands]);

  if (kind === "drum") {
    return (
      <group rotation={rotation}>
        <mesh castShadow receiveShadow>
          <cylinderGeometry args={[radius, radius, length, 32]} />
          <meshStandardMaterial color="#2c5d93" metalness={0.2} roughness={0.45} />
        </mesh>
        {[-0.5, -0.17, 0.17, 0.5].map((share) => (
          <mesh key={share} position={[0, share * (length - 0.02), 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[radius, share === 0.5 || share === -0.5 ? 0.016 : 0.012, 6, 32]} />
            <meshStandardMaterial color="#244d7c" metalness={0.25} roughness={0.4} />
          </mesh>
        ))}
        {/* Two bungs on the lid. */}
        {[-1, 1].map((side) => (
          <mesh key={side} position={[side * radius * 0.55, length / 2 + 0.008, 0]} userData={{ fine: true }}>
            <cylinderGeometry args={[0.035, 0.035, 0.016, 12]} />
            <meshStandardMaterial color="#c9ccce" metalness={0.3} roughness={0.35} />
          </mesh>
        ))}
      </group>
    );
  }
  const steel = kind === "pipe" ? "#80868a" : "#aab0b3";
  const inner = eye > 0 ? eye : kind === "pipe" ? radius * 0.85 : 0;
  return (
    <group rotation={rotation}>
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[radius, radius, length, 40, 1, inner > 0]} />
        <meshStandardMaterial color={steel} metalness={0.3} roughness={0.38} />
      </mesh>
      {inner > 0 && (
        <>
          <mesh>
            <cylinderGeometry args={[inner, inner, length, 32, 1, true]} />
            <meshStandardMaterial color="#4a4e50" metalness={0.3} roughness={0.5} side={2} />
          </mesh>
          {[-1, 1].map((end) => (
            <mesh key={end} position={[0, (end * length) / 2, 0]} rotation={[(end * -Math.PI) / 2, 0, 0]}>
              <ringGeometry args={[inner, radius, 48]} />
              <meshStandardMaterial map={kind === "coil" ? face : null} color={kind === "coil" ? "#ffffff" : "#8f9497"} metalness={0.25} roughness={0.4} />
            </mesh>
          ))}
        </>
      )}
      {bands && (
        <mesh geometry={bands} castShadow>
          <meshStandardMaterial vertexColors metalness={0.3} roughness={0.5} />
        </mesh>
      )}
    </group>
  );
}
