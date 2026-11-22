import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, type Page, test } from "@playwright/test";

/**
 * The explorer in headless Chromium: a gallery configuration opens from the site's static cache
 * (no API needed) and is simulated in the browser; an edit in the load editor is simulated again
 * (that needs the API, so it is skipped when none is running).
 */

type Index = { scenarios: { id: string; variants: Record<string, { explorer: string; status: string }> }[] };
const index = JSON.parse(readFileSync(path.join(__dirname, "..", "public", "demo", "index.json"), "utf8")) as Index;
const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/+$/, "");

async function ready(page: Page) {
  await expect(page.locator("[data-explorer-state]")).toHaveAttribute("data-explorer-state", "ready", { timeout: 60_000 });
}

for (const id of ["steel-coil", "box-truck"]) {
  test(`${id} opens in the explorer from the static cache and fails as on the server`, async ({ page }) => {
    const entry = index.scenarios.find((item) => item.id === id);
    const variant = entry?.variants.as_loaded;
    if (!variant) throw new Error(`no ${id} in the index`);
    await page.route(`${API_URL}/**`, (route) => route.abort());
    await page.goto(`/app/explorer?${variant.explorer}`);
    await ready(page);
    const section = page.locator("[data-explorer-state]");
    await expect(section).toHaveAttribute("data-explorer-status", variant.status);
    await expect(section).toHaveAttribute("data-explorer-source", "browser");
    await expect(page.getByTestId("load-editor")).toBeVisible();
    await expect(page.getByTestId("axle-loads")).toBeVisible();
  });
}

test("a clip on the examples page opens its own load in the explorer, not the default one", async ({ page }) => {
  const fixed = index.scenarios.find((item) => item.id === "sharp-curve")?.variants.fixed;
  if (!fixed) throw new Error("no sharp-curve in the index");
  await page.route(`${API_URL}/**`, (route) => route.abort());
  await page.goto("/app/examples");
  // A client-side navigation: the router changes the address only after the explorer renders.
  await page.locator("#sharp-curve").getByRole("link", { name: /fixed: open live in the explorer/i }).click();
  await ready(page);
  expect(new URL(page.url()).search).toBe(`?${fixed.explorer}`);
  await expect(page.locator("[data-explorer-state]")).toHaveAttribute("data-explorer-status", fixed.status);
});

test("tapping a unit adds a strap, writes it in the URL and simulates again", async ({ page, request }) => {
  const api = await request.get(`${API_URL}/health`).catch(() => null);
  test.skip(!api?.ok(), "no API running");
  await page.goto("/app/explorer");
  await ready(page);
  await page.locator('[data-unit="pallet-3"]').click();
  await expect(page).toHaveURL(/straps=2\.2\.3/);
  await ready(page);
  await page.locator('[data-unit="pallet-1"]').focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page).toHaveURL(/moves=0_1\.90_0\.00/);
  await ready(page);
  await expect(page.locator("[data-explorer-state]")).toHaveAttribute("data-explorer-status", "pass");
  // A new securing keeps the unit where the editor put it.
  await page.getByTestId("explorer-restraint").selectOption("chain");
  await expect(page).toHaveURL(/restraint=chain.*moves=0_1\.90_0\.00/);
  await ready(page);
});
