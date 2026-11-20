// Renders the landing-page media from our own 3D scene: posters, the phone video loops and the
// scenario stills. Nothing here is third-party imagery.
//
// Requirements: the dev server running (`pnpm dev`), ffmpeg on the PATH and a Chromium binary.
// Usage: CHROME_PATH=/path/to/chrome node scripts/render-media.mjs [http://localhost:3000]

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const BASE_URL = process.argv[2] ?? "http://localhost:3000";
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "media");
const FPS = 30;

if (!process.env.CHROME_PATH) {
  console.error("Set CHROME_PATH to a Chromium or Chrome binary.");
  process.exit(1);
}

const ffmpeg = (...args) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args]);
const kilobytes = (file) => `${Math.round(statSync(file).size / 1024)} kB`;

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const work = mkdtempSync(join(tmpdir(), "securecargo-media-"));
mkdirSync(OUT_DIR, { recursive: true });

async function openStage({ variant, view = "hero", width, height }) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.goto(`${BASE_URL}/dev/capture?variant=${variant}&view=${view}&w=${width}&h=${height}`);
  await page.waitForSelector("body[data-capture-ready]", { timeout: 60_000 });
  // Keep the Next.js development indicator out of the frame.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  return page;
}

async function shoot(page, seconds, file) {
  await page.evaluate(
    (t) =>
      new Promise((resolve) => {
        window.__capture.seek(t);
        // Two frames: one to apply the time, one to present it.
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
    seconds,
  );
  await page.locator("#capture-stage").screenshot({ path: file });
}

async function still(name, setup, seconds) {
  const page = await openStage(setup);
  const png = join(work, `${name}.png`);
  await shoot(page, seconds, png);
  await page.close();
  const out = join(OUT_DIR, `${name}.webp`);
  ffmpeg("-i", png, "-c:v", "libwebp", "-quality", "80", out);
  console.log(`${name}.webp  ${kilobytes(out)}`);
}

async function video(name, setup) {
  const page = await openStage(setup);
  const duration = await page.evaluate(() => window.__capture.duration);
  const frames = Math.round(duration * FPS);
  const dir = join(work, name);
  mkdirSync(dir);
  for (let frame = 0; frame < frames; frame++) {
    await shoot(page, frame / FPS, join(dir, `${String(frame).padStart(4, "0")}.png`));
  }
  await page.close();

  const input = ["-framerate", String(FPS), "-i", join(dir, "%04d.png")];
  const webm = join(OUT_DIR, `${name}.webm`);
  const mp4 = join(OUT_DIR, `${name}.mp4`);
  ffmpeg(...input, "-an", "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "30", "-pix_fmt", "yuv420p", "-row-mt", "1", webm);
  ffmpeg(...input, "-an", "-c:v", "libx264", "-crf", "21", "-preset", "slow", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4);
  console.log(`${name}.webm  ${kilobytes(webm)}   ${name}.mp4  ${kilobytes(mp4)}   (${duration} s)`);
}

try {
  for (const variant of ["unsecured", "secured"]) {
    // The posters are the first frame, so the video and the 3D scene start where the poster is.
    await still(`hero-${variant}-wide`, { variant, width: 1600, height: 900 }, 0);
    await still(`hero-${variant}-mobile`, { variant, width: 800, height: 600 }, 0);
    await video(`hero-${variant}`, { variant, width: 960, height: 720 });
  }
  await still("scenario-braking", { variant: "unsecured", view: "side", width: 800, height: 600 }, 1.6);
  await still("scenario-weigh-station", { variant: "unsecured", view: "top", width: 800, height: 600 }, 0);
  await still("scenario-rope", { variant: "secured", view: "rear", width: 800, height: 600 }, 0);
  await still("scenario-curve", { variant: "secured", view: "side", width: 800, height: 600 }, 0);
} finally {
  await browser.close();
  rmSync(work, { recursive: true, force: true });
}
