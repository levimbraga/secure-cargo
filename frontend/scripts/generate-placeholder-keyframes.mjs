// Writes the hand-made placeholder keyframes for the landing-page scene.
//
// This is NOT a physics simulation: the motion is a simple kinematic sketch that looks like a
// braking event. The physics engine will produce documents with the same shape, and these
// files will be replaced by its output.
//
// Usage: node scripts/generate-placeholder-keyframes.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "content", "keyframes");

const FPS = 30;
const DURATION_S = 4;
const SUBSTEPS = 8;

const BED = { length_m: 6, width_m: 2.4, floor_height_m: 1.1, headboard_height_m: 1.2 };
const HEADBOARD_X = BED.length_m / 2;

// Cargo units: size [x, y, z] and starting center [x, y] on the bed floor.
const UNITS = [
  { id: "u1", size_m: [1.1, 1.2, 1.0], start: [0.9, 0.25], yawOnImpactDeg: 0, drift: 0 },
  { id: "u2", size_m: [1.2, 1.0, 1.2], start: [-0.6, -0.3], yawOnImpactDeg: 5, drift: -0.05 },
  { id: "u3", size_m: [1.0, 1.1, 0.8], start: [-2.0, 0.2], yawOnImpactDeg: -7, drift: 0.08 },
];

const BRAKE_START_S = 0.7;
const TRUCK_SPEED_MPS = 15;
const TRUCK_DECELERATION = 7.85;
const SLIDE_ACCELERATION = 3; // cargo relative to the bed while the truck brakes
const FRICTION_DECELERATION = 4; // once the truck has stopped

const round = (value) => Math.round(value * 10000) / 10000;
const yawQuat = (degrees) => {
  const half = (degrees * Math.PI) / 360;
  return [round(Math.cos(half)), 0, 0, round(Math.sin(half))];
};
const smooth = (k) => {
  const c = Math.min(Math.max(k, 0), 1);
  return c * c * (3 - 2 * c);
};

function truckSpeed(t) {
  if (t < BRAKE_START_S) return TRUCK_SPEED_MPS;
  return Math.max(0, TRUCK_SPEED_MPS - TRUCK_DECELERATION * (t - BRAKE_START_S));
}

function unsecuredFrames() {
  const x = UNITS.map((unit) => unit.start[0]);
  const v = UNITS.map(() => 0);
  const impactAt = UNITS.map(() => null);
  const frames = [];
  const dt = 1 / FPS / SUBSTEPS;

  for (let frame = 0; frame <= DURATION_S * FPS; frame++) {
    const t = frame / FPS;
    frames.push({
      t: round(t),
      truck_speed_mps: round(truckSpeed(t)),
      units: UNITS.map((unit, i) => {
        const sinceImpact = impactAt[i] === null ? 0 : smooth((t - impactAt[i]) / 0.3);
        return {
          p: [
            round(x[i]),
            round(unit.start[1] + unit.drift * sinceImpact),
            round(unit.size_m[2] / 2),
          ],
          q: yawQuat(unit.yawOnImpactDeg * sinceImpact),
        };
      }),
      straps: [],
    });

    for (let step = 0; step < SUBSTEPS; step++) {
      const now = t + step * dt;
      const braking = now >= BRAKE_START_S && truckSpeed(now) > 0;
      for (let i = 0; i < UNITS.length; i++) {
        if (braking) v[i] += SLIDE_ACCELERATION * dt;
        else v[i] = Math.max(0, v[i] - FRICTION_DECELERATION * dt);
        x[i] += v[i] * dt;

        // Stop against the headboard (first unit) or against the unit ahead.
        const half = UNITS[i].size_m[0] / 2;
        const limit =
          i === 0 ? HEADBOARD_X - half : x[i - 1] - UNITS[i - 1].size_m[0] / 2 - half;
        if (x[i] > limit) {
          x[i] = limit;
          v[i] = i === 0 ? 0 : v[i - 1];
          if (impactAt[i] === null) impactAt[i] = now;
        }
      }
    }
  }
  return frames;
}

function securedFrames(strapCount) {
  const frames = [];
  for (let frame = 0; frame <= DURATION_S * FPS; frame++) {
    const t = frame / FPS;
    const braking = t >= BRAKE_START_S && truckSpeed(t) > 0;
    const stopAt = BRAKE_START_S + TRUCK_SPEED_MPS / TRUCK_DECELERATION;
    // The straps stretch a little under load and relax once the truck has stopped.
    const load = braking
      ? 1 - Math.exp(-(t - BRAKE_START_S) / 0.12)
      : t > stopAt
        ? Math.exp(-(t - stopAt) / 0.18)
        : 0;
    frames.push({
      t: round(t),
      truck_speed_mps: round(truckSpeed(t)),
      units: UNITS.map((unit) => ({
        p: [round(unit.start[0] + 0.012 * load), round(unit.start[1]), round(unit.size_m[2] / 2)],
        q: [1, 0, 0, 0],
      })),
      straps: Array.from({ length: strapCount }, () => ({ tension_n: round(2500 + 1700 * load) })),
    });
  }
  return frames;
}

function straps() {
  const lift = 0.025; // keeps the strap just outside the box surface
  return UNITS.flatMap((unit) => {
    const [sx, sy, sz] = unit.size_m;
    const [cx, cy] = unit.start;
    return [-0.28, 0.28].map((offset, index) => {
      const x = round(cx + sx * offset);
      return {
        id: `${unit.id}-s${index + 1}`,
        unit_id: unit.id,
        path_m: [
          [x, round(-BED.width_m / 2), 0],
          [x, round(cy - sy / 2 - lift), round(sz + lift)],
          [x, round(cy + sy / 2 + lift), round(sz + lift)],
          [x, round(BED.width_m / 2), 0],
        ],
      };
    });
  });
}

function document(frames, strapList, result) {
  return {
    version: 1,
    source: "placeholder",
    fps: FPS,
    duration_s: DURATION_S,
    bed: BED,
    units: UNITS.map(({ id, size_m }) => ({ id, size_m })),
    straps: strapList,
    events: [{ t: BRAKE_START_S, kind: "braking" }],
    frames,
    result,
  };
}

mkdirSync(OUT_DIR, { recursive: true });
const strapList = straps();
const documents = {
  "braking-unsecured.json": document(unsecuredFrames(), [], {
    status: "fail",
    unit_ids: UNITS.map((unit) => unit.id),
  }),
  "braking-secured.json": document(securedFrames(strapList.length), strapList, {
    status: "pass",
    unit_ids: [],
  }),
};
for (const [name, doc] of Object.entries(documents)) {
  writeFileSync(join(OUT_DIR, name), `${JSON.stringify(doc)}\n`);
  console.log(`wrote ${name}: ${doc.frames.length} frames`);
}
