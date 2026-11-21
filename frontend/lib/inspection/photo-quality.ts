/**
 * Instant photo checks on the phone, before any API call: too dark, blurred, cargo cut off at
 * the sides, truck too far away. They are heuristics on a small grey copy of the photo; each one
 * gives a reason the driver can act on ("retake"), and the driver can still keep the photo.
 *
 * - **Too dark:** the mean brightness is below `DARK_MEAN` (of 255).
 * - **Blurred:** the variance of the Laplacian (a measure of fine detail) is below `BLUR_VAR`.
 * - **Too far:** the detail (gradient energy) sits in a box smaller than `FAR_AREA` of the
 *   frame: the truck is small in the picture.
 * - **Cut off:** a strong horizontal line (a deck edge, the top of a bundle, a strap) runs out
 *   through the left or right edge of the photo (`CUT_CONTINUITY`), or both side bands carry more
 *   detail than the frame on average (`CUT_RATIO`). Measured on the 21 photos of the perception
 *   evaluation, labelled by hand (12 photos where the load runs out at a side, 17 sides in all):
 *   8 of the 12 photos (9 of the 17 sides) caught, and no false alarm on the 9 others. Pixels alone cannot tell a cut load from a busy background (the
 *   measures overlap; numbers in `docs/inspection.md`), so every photo that passes is also put to
 *   the driver in one tap: "Is the whole load in the photo?" (`confirmWhole`). After the analysis
 *   the result still flags a unit whose box touches the side of the photo (`cutOffUnits`).
 *
 * The other thresholds were tuned on the same photos and the samples (none flagged) and on
 * degraded copies of them: darkened to 15 % (all "too dark"), blurred with a 6 px Gaussian (all
 * "blurred"), shrunk to 30 % on a plain background (all "too far").
 */

export type QualityIssue = "too_dark" | "blurry" | "too_far" | "cut_off";

export type Gray = { width: number; height: number; data: Float32Array };

export const ANALYSIS_EDGE = 320;
export const DARK_MEAN = 50;
export const BLUR_VAR = 45;
export const FAR_AREA = 0.18;
export const CUT_BAND = 0.04;
export const CUT_RATIO = 1.1;
/** Share of the rows where a strong horizontal edge crosses both the outer band and the next one. */
export const CUT_CONTINUITY = 0.034;
/** Every photo that passes the checks is confirmed by the driver: the whole load is in it. */
export const CONFIRM_WHOLE = true;

/** RGBA pixels -> luminance (Rec. 601). */
export function toGray(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Gray {
  const data = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    data[i] = 0.299 * (rgba[i * 4] ?? 0) + 0.587 * (rgba[i * 4 + 1] ?? 0) + 0.114 * (rgba[i * 4 + 2] ?? 0);
  }
  return { width, height, data };
}

function mean(gray: Gray): number {
  let sum = 0;
  for (const value of gray.data) sum += value;
  return sum / gray.data.length;
}

function laplacianVariance(gray: Gray): number {
  const { width: w, height: h, data } = gray;
  let sum = 0;
  let sq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = (data[i - 1] ?? 0) + (data[i + 1] ?? 0) + (data[i - w] ?? 0) + (data[i + w] ?? 0) - 4 * (data[i] ?? 0);
      sum += v;
      sq += v * v;
      n++;
    }
  }
  if (!n) return 0;
  const m = sum / n;
  return sq / n - m * m;
}

/** Gradient energy per column and per row. */
function energy(gray: Gray): { columns: Float64Array; rows: Float64Array; total: number } {
  const { width: w, height: h, data } = gray;
  const columns = new Float64Array(w);
  const rows = new Float64Array(h);
  let total = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = (data[i + 1] ?? 0) - (data[i - 1] ?? 0);
      const gy = (data[i + w] ?? 0) - (data[i - w] ?? 0);
      const e = Math.sqrt(gx * gx + gy * gy);
      columns[x] = (columns[x] ?? 0) + e;
      rows[y] = (rows[y] ?? 0) + e;
      total += e;
    }
  }
  return { columns, rows, total };
}

/** The span holding the middle `share` of the energy along one axis, as a fraction of it. */
function span(profile: Float64Array, total: number, share = 0.8): number {
  const tail = ((1 - share) / 2) * total;
  let acc = 0;
  let low = 0;
  for (; low < profile.length; low++) {
    acc += profile[low] ?? 0;
    if (acc >= tail) break;
  }
  acc = 0;
  let high = profile.length - 1;
  for (; high > 0; high--) {
    acc += profile[high] ?? 0;
    if (acc >= tail) break;
  }
  return Math.max(0, high - low + 1) / profile.length;
}

export type QualityReport = {
  issues: QualityIssue[];
  mean: number;
  sharpness: number;
  area: number;
  edgeRatio: number;
  left: number;
  right: number;
  /** Share of rows where a strong horizontal line runs out through the left / right edge. */
  runLeft: number;
  runRight: number;
};

/**
 * Horizontal lines running out of the frame: per side, the share of rows where more than half
 * of the outer band (4 % of the width) and of the band next to it (8 %) are strong horizontal
 * edges (vertical gradient above the frame's 90th percentile).
 */
function runOut(gray: Gray, band: number): { left: number; right: number } {
  const { width: w, height: h, data } = gray;
  const gy = new Float32Array(w * h);
  const values: number[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const v = Math.abs((data[(y + 1) * w + x] ?? 0) - (data[(y - 1) * w + x] ?? 0));
      gy[y * w + x] = v;
      values.push(v);
    }
  }
  if (!values.length) return { left: 0, right: 0 };
  values.sort((a, b) => a - b);
  const threshold = values[Math.floor(0.9 * (values.length - 1))] ?? 0;
  const strong = (y: number, from: number, to: number) => {
    let n = 0;
    for (let x = from; x < to; x++) if ((gy[y * w + x] ?? 0) > threshold) n++;
    return n > (to - from) / 2;
  };
  let left = 0;
  let right = 0;
  for (let y = 0; y < h; y++) {
    if (strong(y, 1, 1 + band) && strong(y, 1 + band, 1 + 3 * band)) left++;
    if (strong(y, w - 1 - band, w - 1) && strong(y, w - 1 - 3 * band, w - 1 - band)) right++;
  }
  return { left: left / h, right: right / h };
}

export function checkQuality(gray: Gray): QualityReport {
  const brightness = mean(gray);
  const sharpness = laplacianVariance(gray);
  const { columns, rows, total } = energy(gray);
  const area = total > 0 ? span(columns, total) * span(rows, total) : 0;
  const band = Math.max(2, Math.round(gray.width * CUT_BAND));
  const average = total / Math.max(1, gray.width - 2);
  let left = 0;
  let right = 0;
  for (let x = 1; x <= band; x++) left += columns[x] ?? 0;
  for (let x = gray.width - 1 - band; x < gray.width - 1; x++) right += columns[x] ?? 0;
  const leftRatio = average > 0 ? left / band / average : 0;
  const rightRatio = average > 0 ? right / band / average : 0;
  const edgeRatio = Math.min(leftRatio, rightRatio);

  const run = runOut(gray, band);

  const issues: QualityIssue[] = [];
  if (brightness < DARK_MEAN) issues.push("too_dark");
  // A dark photo has little detail anyway: only call it blurred when it is bright enough.
  else if (sharpness < BLUR_VAR) issues.push("blurry");
  if (!issues.length && area < FAR_AREA) issues.push("too_far");
  if (!issues.length && (edgeRatio > CUT_RATIO || Math.max(run.left, run.right) > CUT_CONTINUITY)) issues.push("cut_off");
  return {
    issues,
    mean: brightness,
    sharpness,
    area,
    edgeRatio,
    left: leftRatio,
    right: rightRatio,
    runLeft: run.left,
    runRight: run.right,
  };
}

/** In the browser: a decoded image -> its small grey copy -> the report. */
export async function checkBlob(blob: Blob): Promise<QualityReport> {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, ANALYSIS_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(8, Math.round(bitmap.width * scale));
  const height = Math.max(8, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) return { issues: [], mean: 0, sharpness: 0, area: 1, edgeRatio: 0, left: 0, right: 0, runLeft: 0, runRight: 0 };
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const pixels = context.getImageData(0, 0, width, height).data;
  return checkQuality(toGray(pixels, width, height));
}

/** Units whose box on the photo touches its left or right edge: the load may go on outside it. */
export function cutOffUnits(units: { number: number; box: [number, number, number, number] }[], margin = 0.01): number[] {
  return units.filter((unit) => unit.box[0] <= margin || unit.box[2] >= 1 - margin).map((unit) => unit.number);
}
