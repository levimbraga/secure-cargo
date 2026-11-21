import { expect, type Page, test } from "@playwright/test";

/**
 * The inspection flow with a sample photo, signed out and with no API at all (CI has none):
 * everything comes from the site's static files, as it must when the backend is down.
 */

async function throughTheQuestions(page: Page, sample: string) {
  await page.goto(`/app/new?sample=${sample}`);
  const flow = page.getByTestId("new-inspection");
  await expect(flow).toHaveAttribute("data-flow-step", "truck", { timeout: 20_000 });
  await expect(page.getByTestId("analysis-status")).toHaveAttribute("data-mode", "sample");
  // The AI's pick is marked; one tap confirms the size, one the body.
  await page.locator('[data-testid^="size-"]', { hasText: /AI pick/ }).click();
  await page.locator('[data-testid^="style-"]', { hasText: /AI pick/ }).click();
  await expect(flow).toHaveAttribute("data-flow-step", "weight");
  // The weight comes from the sample's invoice; a photo cannot show it.
  await expect(page.getByTestId("weight-split")).toBeVisible();
  await page.getByTestId("weight-next").click();
  await expect(flow).toHaveAttribute("data-flow-step", "result");
  const result = page.getByTestId("inspection-result");
  await expect(result).toBeVisible({ timeout: 20_000 });
  return result;
}

test("a sample photo goes from photo to a proven fix without an account or the API", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const result = await throughTheQuestions(page, "crates-ropes");
  await expect(result).toHaveAttribute("data-state", "fails");
  await expect(page.getByTestId("main-problem")).not.toHaveText("");
  await expect(page.getByTestId("reading-summary")).toBeVisible();
  await expect(page.locator('[data-theme="securing"]')).toHaveAttribute("data-summary", "fail");

  await page.getByTestId("open-simulation").click();
  await expect(page.getByTestId("simulation-panel")).toBeVisible();
  await expect(page.getByTestId("situation-reason")).not.toHaveText("");

  await page.getByTestId("apply-fix").click();
  await expect(result).toHaveAttribute("data-variant", "fixed", { timeout: 20_000 });
  await expect(result).toHaveAttribute("data-state", "approved");
  await expect(page.getByTestId("fix-changes")).toBeVisible();
});

test("the three verdict states, from the sample photos", async ({ page }) => {
  for (const [sample, state] of [
    ["concrete-pipes", "approved"],
    ["steel-racks", "holds_noncompliant"],
    ["lumber-straps", "fails"],
  ] as const) {
    const result = await throughTheQuestions(page, sample);
    await expect(result).toHaveAttribute("data-state", state);
  }
});

test("the weight must be given before the result", async ({ page }) => {
  await page.goto("/pt-BR/app/new?sample=crates-ropes");
  const flow = page.getByTestId("new-inspection");
  await expect(flow).toHaveAttribute("data-flow-step", "truck", { timeout: 20_000 });
  await page.locator('[data-testid^="size-"]').first().click();
  await page.locator('[data-testid^="style-"]').first().click();
  await page.getByTestId("weight-type").click();
  await page.getByTestId("weight-input").fill("");
  await expect(page.getByTestId("weight-next")).toBeDisabled();
});
