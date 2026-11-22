// Records the gallery clips from the real realistic replay (`/app/scenarios/<id>`), frame by frame:
// for every frame the replay's own time slider is moved to that instant and the 3D frame is
// captured, so the clip is smooth however slowly the machine draws WebGL. ffmpeg then writes
// `public/demo/clips/<id>.<variant>.{mp4,webm,webp}` (H.264 + VP9, 960x600, no audio).
//
//   node scripts/record-example-clips.mjs [base-url] [id ...]
//
// Environment: CHROMIUM (a Chromium binary; default: Playwright's cached build), FPS (30),
// KEEP_FRAMES=1 keeps the PNG frames under `.clip-frames/`.
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public/demo/clips");
const FRAMES = path.join(ROOT, ".clip-frames");
const INDEX = JSON.parse(fs.readFileSync(path.join(ROOT, "public/demo/index.json"), "utf8"));
const BASE = process.argv[2] || "https://securecargo.app";
const ONLY = process.argv.slice(3);
const FPS = Number(process.env.FPS || 30);
const CHROMIUM =
  process.env.CHROMIUM || path.join(os.homedir(), ".cache/ms-playwright/chromium-1243/chrome-linux64/chrome");
const MAX_BYTES = 1.5 * 1024 * 1024;

/** Clip length: slow motion for short runs, faster for long ones; 6 to 8 s, the last 0.5 s holds. */
function clipLength(duration) {
  return Math.min(8, Math.max(6, duration * 1.6));
}

function sh(command, args) {
  execFileSync(command, args, { stdio: ["ignore", "ignore", "inherit"] });
}

async function settle(page) {
  // Two animation frames: React commits the new time, the scene draws it.
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}

async function record(page, id, variant) {
  const url = `${BASE}/app/scenarios/${id}`;
  await page.goto(url, { waitUntil: "networkidle" });
  const versions = page.getByRole("group", { name: "Version of the load" });
  await versions.getByRole("button", { name: variant === "fixed" ? "Fixed" : "As loaded", exact: true }).click();
  // Real time: the clip has its own timing, so the HUD must not say "slow motion".
  await page.getByRole("group", { name: "Playback speed" }).getByText("1×", { exact: true }).click();
  // The scene's own button and notes are not part of the clip.
  await page.addStyleTag({ content: "[data-scene-control] { display: none !important; }" });
  const frame = page.locator("figure div.relative.aspect-\\[4\\/3\\]").first();
  await frame.locator("canvas").waitFor({ timeout: 60_000 });
  const slider = page.locator('input[type="range"]').first();
  const duration = Number(await slider.getAttribute("max"));
  await frame.scrollIntoViewIfNeeded();

  const length = clipLength(duration);
  const total = Math.round(length * FPS);
  const moving = total - Math.round(0.5 * FPS);
  const dir = path.join(FRAMES, `${id}.${variant}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  for (let index = 0; index < total; index += 1) {
    const time = Math.min(duration, (duration * index) / (moving - 1));
    await slider.evaluate((input, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, String(value));
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, time.toFixed(3));
    await settle(page);
    await frame.screenshot({ path: path.join(dir, `${String(index).padStart(4, "0")}.png`), scale: "device" });
  }

  const input = path.join(dir, "%04d.png");
  const scale = "scale=960:600:force_original_aspect_ratio=increase,crop=960:600,format=yuv420p";
  const base = path.join(OUT, `${id}.${variant}`);
  let crf = 25;
  for (;;) {
    sh("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", input, "-vf", scale,
      "-c:v", "libx264", "-preset", "slow", "-crf", String(crf), "-profile:v", "high", "-movflags", "+faststart",
      "-an", `${base}.mp4`]);
    if (fs.statSync(`${base}.mp4`).size <= MAX_BYTES || crf >= 40) break;
    crf += 3;
  }
  let vp9 = 38;
  for (;;) {
    sh("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", input, "-vf", scale,
      "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", String(vp9), "-row-mt", "1", "-deadline", "good", "-cpu-used", "2",
      "-an", `${base}.webm`]);
    if (fs.statSync(`${base}.webm`).size <= MAX_BYTES || vp9 >= 50) break;
    vp9 += 4;
  }
  // The poster is 60 % into the run: as loaded, the load is on the move by then.
  const poster = Math.round((moving - 1) * 0.6);
  sh("ffmpeg", ["-y", "-loglevel", "error", "-i", path.join(dir, `${String(poster).padStart(4, "0")}.png`),
    "-vf", "scale=960:600:force_original_aspect_ratio=increase,crop=960:600", "-c:v", "libwebp", "-quality", "72",
    `${base}.webp`]);
  if (!process.env.KEEP_FRAMES) fs.rmSync(dir, { recursive: true, force: true });
  const kb = (file) => Math.round(fs.statSync(file).size / 1024);
  console.log(
    `${id}.${variant}: ${duration.toFixed(2)} s run -> ${length.toFixed(1)} s clip, ` +
      `mp4 ${kb(`${base}.mp4`)} kB (crf ${crf}), webm ${kb(`${base}.webm`)} kB, webp ${kb(`${base}.webp`)} kB`,
  );
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: CHROMIUM,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  // 1280 px wide: the replay frame is about 690 px; at device scale 1.5 that is ~1030 px of pixels.
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 1.5 });
  const page = await context.newPage();
  const ids = INDEX.scenarios.map((entry) => entry.id).filter((id) => !ONLY.length || ONLY.includes(id));
  for (const id of ids) {
    for (const variant of ["as_loaded", "fixed"]) await record(page, id, variant);
  }
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
