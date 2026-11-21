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

test("switching country re-checks only the rules: same simulation, another checklist", async ({ page }) => {
  const physics: string[] = [];
  page.on("request", (request) => {
    if (/\/(battery|plan|simulate)$/.test(new URL(request.url()).pathname)) physics.push(request.url());
  });
  const result = await throughTheQuestions(page, "concrete-pipes");
  await expect(result).toHaveAttribute("data-country", "BR");
  await expect(result).toHaveAttribute("data-state", "approved");
  await expect(page.locator('[data-theme="securing"] summary')).toContainText("CONTRAN 945");
  const passed = await result.getAttribute("data-passed");

  await page.getByTestId("country-US").click();
  await expect(result).toHaveAttribute("data-country", "US");
  // Round pipes need chocks under 49 CFR 393.106(c)(1); the physics is the same 7 of 7.
  await expect(result).toHaveAttribute("data-state", "holds_noncompliant");
  await expect(result).toHaveAttribute("data-passed", passed ?? "7");
  await expect(page.locator('[data-theme="securing"] summary')).toContainText("FMCSA 393");
  await expect(page.locator('[data-check="rolling_articles"]')).toHaveAttribute("data-mark", "fail");
  await expect(page.getByTestId("main-problem")).toContainText("roll");

  // EU rules: round pipes under straps have nothing against rolling sideways (Annex III I.1):
  // a dangerous deficiency at a roadside check; still the same simulation.
  await page.getByTestId("country-EU").click();
  await expect(result).toHaveAttribute("data-country", "EU");
  await expect(result).toHaveAttribute("data-state", "holds_noncompliant");
  await expect(result).toHaveAttribute("data-passed", passed ?? "7");
  await expect(page.locator('[data-theme="securing"] summary')).toContainText("2014/47");
  await expect(page.getByTestId("roadside-class")).toHaveAttribute("data-class", "dangerous");
  await expect(page.locator('[data-check="eu_sideways"]')).toHaveAttribute("data-deficiency", "dangerous");
  expect(physics).toEqual([]);
});
