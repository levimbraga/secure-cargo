import { expect, type Page, test } from "@playwright/test";

/**
 * The explorer's free-form load editor: add units of any cargo, several at once, change one's
 * weight, duplicate and remove it. The editing itself needs no API (the address carries the
 * draft); simulating the edited load does, so that part is skipped when no API is running.
 */

const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/+$/, "");

async function ready(page: Page) {
  await expect(page.locator("[data-explorer-state]")).toHaveAttribute("data-explorer-state", "ready", { timeout: 60_000 });
}

function draftOf(url: string): { units: { id: string; cargo: string; mass_kg?: number | null }[] } {
  const text = new URLSearchParams(new URL(url).hash.replace(/^#/, "")).get("draft") ?? "";
  return JSON.parse(Buffer.from(text, "base64url").toString("utf8"));
}

test("adds, edits, duplicates and removes units, and keeps the load in the address", async ({ page, request }) => {
  const api = await request.get(`${API_URL}/health`).catch(() => null);
  const live = Boolean(api?.ok());
  if (!live) await page.route(`${API_URL}/**`, (route) => route.abort());
  // Two tall cabinets against the headboard of a toco (in the site's static cache): room for more.
  await page.goto(
    "/app/explorer?body=flatbed&size=toco&cargo=tall_cabinet&position=headboard&restraint=direct&speed=60&road=curvy&weather=dry&event=sharp_curve&straps=1.1",
  );
  await ready(page);
  const rows = page.locator("[data-unit-row]");
  await expect(rows).toHaveCount(2);

  await page.locator("#explorer-add-count").selectOption("2");
  await page.locator("#explorer-add-cargo").selectOption("crate");
  await page.getByTestId("unit-add").getByRole("button", { name: "Add" }).click();
  await expect(rows).toHaveCount(4);
  await expect(page.locator('[data-unit="crate-3"]')).toBeVisible();
  await expect(page.getByTestId("unit-total")).toContainText("4 units");
  await expect.poll(() => draftOf(page.url()).units.map((unit) => unit.cargo)).toEqual([
    "tall_cabinet",
    "tall_cabinet",
    "crate",
    "crate",
  ]);

  // Open the new crate: its weight, then a copy of it.
  await page.locator('[data-unit-row="crate-3"]').getByRole("button", { expanded: false }).click();
  await page.getByTestId("unit-weight").fill("2400");
  await page.getByTestId("unit-weight").press("Tab");
  await expect(page.locator('[data-unit-row="crate-3"]')).toContainText("2,400 kg");
  await page.getByTestId("unit-duplicate").click();
  await expect(rows).toHaveCount(5);
  await expect.poll(() => draftOf(page.url()).units.at(-1)).toMatchObject({ cargo: "crate", mass_kg: 2400 });

  // The copy is open now: remove it.
  await page.getByTestId("unit-remove").click();
  await expect(rows).toHaveCount(4);

  if (live) {
    await ready(page);
    await expect(page.locator("[data-explorer-state]")).toHaveAttribute("data-explorer-status", /pass|fail/);
  }
});

test("tests the whole trip, marks where it fails and makes the load as safe as possible", async ({ page, request }) => {
  const api = await request.get(`${API_URL}/health`).catch(() => null);
  test.skip(!api?.ok(), "no API running");
  test.setTimeout(300_000);
  // Pallets under one strap each: they slide under braking.
  await page.goto(
    "/app/explorer?body=flatbed&size=toco&cargo=wood_pallet&position=gap&restraint=top_over&speed=80&road=straight&weather=dry&event=emergency_braking&straps=1.1.1",
  );
  await ready(page);
  await page.getByTestId("trip-test").click();
  const result = page.getByTestId("trip-result");
  await expect(result).toHaveAttribute("data-state", "fails", { timeout: 150_000 });
  await expect(page.getByTestId("trip-where")).toContainText("Pallet 1");
  await expect(page.locator("[data-unit][data-failing]")).not.toHaveCount(0);
  // The top of the page leads with the whole trip; the live run is one situation of it.
  await expect(page.getByTestId("explorer-trip-verdict")).toHaveAttribute("data-state", "fails");
  await expect(page.getByTestId("explorer-live-verdict")).toContainText("this situation");

  await page.getByTestId("trip-make-safe").click();
  await expect(page.getByTestId("trip-plan")).toBeVisible({ timeout: 150_000 });
  await expect(result).toHaveAttribute("data-state", "approved");
  await expect(page.locator("[data-unit][data-failing]")).toHaveCount(0);
  // The fixed load is in the editor and in the address.
  await expect(page).toHaveURL(/#draft=/);
  await ready(page);
  await expect(page.locator("[data-explorer-state]")).toHaveAttribute("data-explorer-status", "pass");

  await page.getByTestId("trip-undo").click();
  await expect(page.locator("[data-explorer-state]")).toHaveAttribute("data-explorer-status", "fail", { timeout: 60_000 });
});

test("sets a unit's lashings by hand: device, route, lashing point and angles", async ({ page, request }) => {
  const api = await request.get(`${API_URL}/health`).catch(() => null);
  if (!api?.ok()) await page.route(`${API_URL}/**`, (route) => route.abort());
  await page.goto(
    "/app/explorer?body=flatbed&size=toco&cargo=tall_cabinet&position=headboard&restraint=direct&speed=60&road=curvy&weather=dry&event=sharp_curve&straps=1.1",
  );
  await ready(page);
  await page.locator('[data-unit-row="cabinet-1"]').getByRole("button", { expanded: false }).click();
  const list = page.getByTestId("lashing-list");
  await expect(list).toHaveAttribute("data-custom", "false");
  // One strap over the top and four diagonals, as the securing gives them.
  await expect(list.locator("[data-lashing-row]")).toHaveCount(5);
  await expect(list.getByTestId("lashing-angles").first()).toContainText("α");

  await list.getByTestId("lashing-kind").first().selectOption("chain");
  await expect(list).toHaveAttribute("data-custom", "true");
  await list.getByTestId("lashing-add-top_over").click();
  await expect(list.locator("[data-lashing-row]")).toHaveCount(6);
  await list.getByTestId("lashing-remove").nth(1).click();
  await expect(list.locator("[data-lashing-row]")).toHaveCount(5);
  await expect
    .poll(() => draftOf(page.url()).units[0] as unknown as { lashings?: { kind: string; routing: string }[] })
    .toMatchObject({ lashings: [{ kind: "chain", routing: "top_over" }, {}, {}, {}, {}] });

  await list.getByTestId("lashings-reset").click();
  await expect(list).toHaveAttribute("data-custom", "false");
});
