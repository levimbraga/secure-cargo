// Turns the licensed source photographs into the site's imagery: cropped, converted to
// high-contrast black and white with film grain, or to a duotone for the scenario cards.
//
// The originals are not in this repository; their file names end with the Unsplash photo id
// (see the photo credits in the README).
// Usage: node scripts/process-photos.mjs <folder-with-originals>
// Requires ffmpeg and ffprobe on the PATH.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "media");
const INK = [0x19, 0x19, 0x18];
const PAPER = [0xf8, 0xf8, 0xf3];

/**
 * `focus` is the point of the original kept at the center of the crop, as fractions of its
 * width and height; `zoom` above 1 crops tighter. `tone` makes a duotone: ink shadows, the tone in the midtones, a pale tint
 * of it in the highlights.
 */
const JOBS = [
  { out: "hero.jpg", src: "hero-1-520ffcaITVM.jpg", size: [2272, 912], focus: [0.56, 0.6], zoom: 1.12, contrast: 1.25, brightness: 0.02, grain: 16 },
  { out: "dock.jpg", src: "dock-3-nT4k2JDtwTQ.jpg", size: [1376, 584], focus: [0.5, 0.42], contrast: 1.2, grain: 14 },
  { out: "scenario-braking.jpg", src: "braking-1-99HLgU4IHLY.jpg", size: [736, 920], focus: [0.5, 0.36], contrast: 1.2, grain: 18, tone: "#9C5B23" },
  { out: "scenario-weigh-station.jpg", src: "weigh-2-0fiAHT8u48Y.jpg", size: [736, 920], focus: [0.6, 0.64], zoom: 1.24, contrast: 1.2, brightness: 0.04, grain: 18, tone: "#2D4995" },
  { out: "scenario-rope.jpg", src: "rope-1-KZC9qnKD_-4.jpg", size: [736, 920], focus: [0.5, 0.42], contrast: 1.2, grain: 18, tone: "#CDAF5D" },
  { out: "scenario-curve.jpg", src: "curve-1-wmgLXFpLvqo.jpg", size: [736, 920], focus: [0.5, 0.62], contrast: 1.15, grain: 18, tone: "#026340" },
];

const hex = (value) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
const mix = (a, b, k) => a.map((channel, i) => Math.round(channel + (b[i] - channel) * k));

function probe(file) {
  const out = execFileSync("ffprobe", [
    "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file,
  ]).toString().trim();
  const [width, height] = out.split(",").map(Number);
  return { width, height };
}

/** A per-channel curve through three colors: value 0 -> shadow, 128 -> mid, 255 -> highlight. */
function duotone(tone) {
  const mid = hex(tone);
  const shadow = mix(INK, mid, 0.12);
  const highlight = mix(mid, PAPER, 0.86);
  const curve = (i) =>
    `if(lt(val\\,128)\\,${shadow[i]}+(${mid[i] - shadow[i]})*val/128\\,${mid[i]}+(${highlight[i] - mid[i]})*(val-128)/127)`;
  return `format=rgb24,lutrgb=r='${curve(0)}':g='${curve(1)}':b='${curve(2)}'`;
}

function filters(job, source) {
  const [width, height] = job.size;
  const aspect = width / height;
  const zoom = job.zoom ?? 1;
  const cropW = Math.round(Math.min(source.width, source.height * aspect) / zoom);
  const cropH = Math.round(Math.min(source.height, source.width / aspect) / zoom);
  const x = Math.round(Math.min(Math.max(job.focus[0] * source.width - cropW / 2, 0), source.width - cropW));
  const y = Math.round(Math.min(Math.max(job.focus[1] * source.height - cropH / 2, 0), source.height - cropH));
  return [
    `crop=${cropW}:${cropH}:${x}:${y}`,
    `scale=${width}:${height}:flags=lanczos`,
    "format=gray",
    `eq=contrast=${job.contrast}:brightness=${job.brightness ?? 0}`,
    `noise=c0s=${job.grain}:c0f=u`,
    job.tone ? duotone(job.tone) : "format=gray",
    "format=yuvj420p",
  ].join(",");
}

const originals = process.argv[2];
if (!originals) {
  console.error("Usage: node scripts/process-photos.mjs <folder-with-originals>");
  process.exit(1);
}
mkdirSync(OUT_DIR, { recursive: true });

for (const job of JOBS) {
  const input = join(originals, job.src);
  if (!existsSync(input)) {
    console.error(`missing original: ${input}`);
    process.exitCode = 1;
    continue;
  }
  const output = join(OUT_DIR, job.out);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", input, "-vf", filters(job, probe(input)), "-frames:v", "1", "-q:v", "3", output]);
  console.log(`${job.out}  ${job.size.join("x")}  ${Math.round(statSync(output).size / 1024)} kB`);
}
