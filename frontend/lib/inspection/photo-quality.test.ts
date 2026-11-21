import { describe, expect, it } from "vitest";

import { checkQuality, cutOffUnits, type Gray } from "./photo-quality";

/** A grey frame with a textured "truck" in it (deterministic noise). */
function scene(options: { width?: number; height?: number; object?: [number, number, number, number]; gain?: number; blur?: number } = {}): Gray {
  const width = options.width ?? 320;
  const height = options.height ?? 200;
  const [x0, y0, x1, y1] = options.object ?? [0.15, 0.2, 0.85, 0.8];
  let seed = 12345;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  let data = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inside = x >= x0 * width && x < x1 * width && y >= y0 * height && y < y1 * height;
      data[y * width + x] = inside ? 60 + random() * 160 : 150;
    }
  }
  for (let pass = 0; pass < (options.blur ?? 0); pass++) {
    const next = new Float32Array(data.length);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += data[(y + dy) * width + x + dx] ?? 0;
        next[y * width + x] = sum / 9;
      }
    }
    data = next;
  }
  const gain = options.gain ?? 1;
  return { width, height, data: data.map((v) => v * gain) };
}

describe("photo quality checks", () => {
  it("pass a bright, sharp, well-framed photo", () => {
    expect(checkQuality(scene()).issues).toEqual([]);
  });

  it("ask to retake a photo that is too dark", () => {
    expect(checkQuality(scene({ gain: 0.2 })).issues).toEqual(["too_dark"]);
  });

  it("ask to retake a blurred photo", () => {
    expect(checkQuality(scene({ blur: 6 })).issues).toEqual(["blurry"]);
  });

  it("ask to come closer when the truck is small in the frame", () => {
    expect(checkQuality(scene({ object: [0.42, 0.42, 0.58, 0.58] })).issues).toEqual(["too_far"]);
  });

  it("ask to step back when the busiest detail runs past both sides of the frame", () => {
    // A load across the whole frame, plain in the middle (a tarp) and busy at both ends.
    const gray = scene({ object: [0, 0.2, 1, 0.8] });
    for (let y = 0; y < gray.height; y++) {
      for (let x = Math.round(gray.width * 0.2); x < Math.round(gray.width * 0.8); x++) gray.data[y * gray.width + x] = 120;
    }
    expect(checkQuality(gray).issues).toEqual(["cut_off"]);
  });

  it("ask to step back when a load's lines run out through one side of the frame", () => {
    // A load inside the frame, but its bundles (dark stripes on light) run out through the left edge.
    const width = 320;
    const height = 200;
    const data = new Float32Array(width * height).fill(150);
    let seed = 7;
    const noise = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 30;
    for (let y = 40; y < 160; y++) {
      for (let x = 0; x < 240; x++) data[y * width + x] = Math.floor((y - 40) / 6) % 2 ? 60 + noise() : 200 + noise();
    }
    const report = checkQuality({ width, height, data });
    expect(report.issues).toEqual(["cut_off"]);
    expect(report.runLeft).toBeGreaterThan(report.runRight);
  });

  it("let a load whose lines end inside the frame through", () => {
    const width = 320;
    const height = 200;
    const data = new Float32Array(width * height).fill(150);
    let seed = 7;
    const noise = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 30;
    for (let y = 40; y < 160; y++) {
      for (let x = 48; x < 272; x++) data[y * width + x] = Math.floor((y - 40) / 6) % 2 ? 60 + noise() : 200 + noise();
    }
    expect(checkQuality({ width, height, data }).issues).toEqual([]);
  });

  it("flag units whose box touches a side of the photo after the analysis", () => {
    const units = [
      { number: 1, box: [0.0, 0.2, 0.3, 0.8] as [number, number, number, number] },
      { number: 2, box: [0.35, 0.2, 0.6, 0.8] as [number, number, number, number] },
      { number: 3, box: [0.7, 0.2, 0.995, 0.8] as [number, number, number, number] },
    ];
    expect(cutOffUnits(units)).toEqual([1, 3]);
  });
});
