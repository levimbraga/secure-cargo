import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { DEMO_IDS, type DemoRun, VARIANTS } from "../lib/demo";
import { parityDifferences, type ParitySummary, paritySummary } from "../lib/live/parity";

/**
 * Browser against server: the live lab steps each demo run with MuJoCo WebAssembly in headless
 * Chromium, and its result must match the result the server computed for the same run
 * (`public/demo/*.json`, written by `backend/scripts/precompute_demo.py`) within the tolerance
 * documented in `lib/live/parity.ts` and docs/validation.md.
 */

type LabResult = ParitySummary & { source: "browser" | "server"; run_ms: number };

function serverSummary(id: string, variant: string): ParitySummary {
  const file = path.join(__dirname, "..", "public", "demo", `${id}.${variant}.json`);
  return paritySummary((JSON.parse(readFileSync(file, "utf8")) as DemoRun).result);
}

for (const id of DEMO_IDS) {
  for (const variant of VARIANTS) {
    test(`${id} (${variant}): the browser run matches the server`, async ({ page }) => {
      await page.goto(`/app/lab/${id}?variant=${variant}`);
      const lab = page.locator("[data-lab-state]");
      await expect(lab).toHaveAttribute("data-lab-state", "ready", { timeout: 45_000 });

      const result = JSON.parse((await lab.getAttribute("data-lab-result")) ?? "null") as LabResult | null;
      expect(result, "the lab publishes its result").not.toBeNull();
      // The numbers must come from MuJoCo WebAssembly, not from the server fallback.
      expect(result?.source).toBe("browser");
      expect(parityDifferences(result as ParitySummary, serverSummary(id, variant))).toEqual([]);
    });
  }
}

test("changing the strap count re-runs the braking scenario until it passes", async ({ page }) => {
  await page.goto("/app/lab/emergency-braking?variant=as_loaded");
  const lab = page.locator("[data-lab-state]");
  await expect(lab).toHaveAttribute("data-lab-state", "ready", { timeout: 45_000 });
  expect(JSON.parse((await lab.getAttribute("data-lab-result")) ?? "{}").status).toBe("fail");

  // Two straps per pallet is what EN 12195-1 asks for here; the model of the changed load
  // comes from the API, so this part is skipped when the API cannot be reached.
  const api = await page.request.get(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/health`).catch(() => null);
  test.skip(!api?.ok(), "the API is not reachable from this machine");

  await page.getByTestId("lab-straps").fill("2");
  await expect(lab).toHaveAttribute("data-lab-result", /"status":"pass"/, { timeout: 30_000 });
});
