/**
 * Copies the MuJoCo WebAssembly build from node_modules to `public/mujoco/<version>/`.
 *
 * The browser imports the module from that URL at run time (see `lib/live/mujoco.ts`) instead
 * of through the bundler: the Emscripten loader also carries Node-only imports the bundler
 * cannot resolve for the browser, and a plain versioned file can be cached for ever.
 * Runs after every install and before every build; the copies are not committed.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);

let entry;
try {
  entry = require.resolve("@mujoco/mujoco");
} catch {
  // Installing without the package (a production install of another workspace): nothing to copy.
  console.warn("copy-mujoco: @mujoco/mujoco is not installed, skipping");
  process.exit(0);
}
const source = path.dirname(entry);
const { version } = JSON.parse(readFileSync(path.join(source, "package.json"), "utf8"));
const base = path.join(root, "public", "mujoco");
const target = path.join(base, version);

if (!existsSync(path.join(target, "mujoco.wasm"))) {
  rmSync(base, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  for (const file of ["mujoco.js", "mujoco.wasm"]) copyFileSync(path.join(source, file), path.join(target, file));
  console.log(`copy-mujoco: wrote public/mujoco/${version}/`);
}
