import { expect, type Page, test } from "@playwright/test";

/**
 * No raw "{placeholder}" in the rendered text of the pages, in English and in Portuguese: a
 * message called without its values ("Bed length ({unit})") shows its braces. The unit test
 * `lib/i18n-placeholders.test.ts` finds such calls in the code; this one reads the pages.
 */

const RAW = /\{\s*[A-Za-z_]\w*\s*[,}]/;

async function expectNoPlaceholder(page: Page, where: string) {
  const text = await page.locator("body").innerText();
  const found = text.split("\n").filter((line) => RAW.test(line));
  expect(found, `${where}: raw placeholders`).toEqual([]);
}

for (const prefix of ["", "/pt-BR"]) {
  const language = prefix ? "pt-BR" : "en";

  test(`${language}: the public pages render every placeholder`, async ({ page }) => {
    for (const path of ["", "/app", "/app/examples", "/app/explorer", "/app/trucks", "/app/new"]) {
      await page.goto(`${prefix}${path || "/"}`);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await expectNoPlaceholder(page, `${prefix}${path}`);
    }
  });

  test(`${language}: the truck cards and the result render every placeholder`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${prefix}/app/new?sample=crates-ropes`);
    const flow = page.getByTestId("new-inspection");
    await expect(flow).toHaveAttribute("data-flow-step", "truck", { timeout: 20_000 });
    await expect(page.getByTestId("truck-caption").first()).toBeVisible();
    await expectNoPlaceholder(page, "size cards");
    // The AI's picks: the sample's result is precomputed for that truck (CI has no API).
    await page.locator('[data-testid^="size-"]', { hasText: /AI pick|IA/ }).click();
    await expectNoPlaceholder(page, "body cards");
    await page.locator('[data-testid^="style-"]', { hasText: /AI pick|IA/ }).click();
    await expect(flow).toHaveAttribute("data-flow-step", "weight");
    await expectNoPlaceholder(page, "weight");
    await page.getByTestId("weight-next").click();
    await expect(page.getByTestId("inspection-result")).toBeVisible({ timeout: 20_000 });
    await expectNoPlaceholder(page, "result");
  });
}
