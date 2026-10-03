import { expect, test } from "@playwright/test";
import { assertNoOverflow, installHarness, registerBoardDesignGameTests } from "../shared/boardDesignHarness";

test("profile previews, win thresholds, selection persistence and failed saves", async ({ page }) => {
  test.setTimeout(90000);
  const state = await installHarness(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const wins of [0, 9, 10, 19, 20, 29, 30, 49, 50]) {
    state.wins = wins;
    await page.goto("/de/profile");
    await page.locator(".board-design-trigger").click();
    const cards = page.locator(".board-design-option");
    await expect(cards).toHaveCount(11);
    const previews = await cards.locator(".board-design-image").evaluateAll((elements) => elements.map((element) => {
      const bounds = element.getBoundingClientRect();
      const image = element.firstElementChild!.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height, imageWidth: image.width, imageHeight: image.height };
    }));
    for (const preview of previews) {
      expect(Math.abs(preview.width - preview.height)).toBeLessThan(1);
      expect(Math.abs(preview.width - preview.imageWidth)).toBeLessThan(1);
      expect(Math.abs(preview.height - preview.imageHeight)).toBeLessThan(1);
    }
    for (const [index, threshold] of [0, 0, 10, 20, 30, 50, null, null, null, null, null].entries()) {
      if (threshold !== null && wins >= threshold) await expect(cards.nth(index)).toBeEnabled();
      else await expect(cards.nth(index)).toBeDisabled();
    }
    await expect(cards.filter({ hasText: "Coming soon" })).toHaveCount(5);
    const images = page.locator(".board-design-options img");
    await expect(images).toHaveCount(10);
    await expect.poll(() => images.evaluateAll((elements) => elements.every((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
    await assertNoOverflow(page);
  }
  await page.getByRole("button", { name: "Bordeaux Freigeschaltet", exact: true }).click();
  await expect(page.locator(".board-design-current")).toContainText("Bordeaux");
  expect(state.selections).toEqual(["bordeaux"]);
  await page.reload();
  await expect(page.locator(".board-design-current")).toContainText("Bordeaux");
  await page.locator(".board-design-trigger").click();
  state.failSave = true;
  await page.getByRole("button", { name: "Helle Eiche Freigeschaltet", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "nicht gespeichert" })).toBeVisible();
  await expect(page.locator(".board-design-current")).toContainText("Bordeaux");
  state.failSave = false;
  await page.getByRole("button", { name: "Helle Eiche Freigeschaltet", exact: true }).click();
  await expect(page.locator(".board-design-current")).toContainText("Helle Eiche");
  await page.keyboard.press("Escape");
  await expect(page.locator(".board-design-trigger")).toBeFocused();
  await expect(page.locator(".board-design-picker")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("profile handles a failed design load and can retry", async ({ page }) => {
  const state = await installHarness(page);
  state.failLoad = true;
  await page.goto("/de/profile");
  await page.locator(".board-design-trigger").click();
  await expect(page.getByRole("alert")).toContainText("nicht geladen");
  await expect(page.locator(".board-design-option:enabled")).toHaveCount(0);
  state.failLoad = false;
  await page.getByRole("button", { name: "Erneut versuchen" }).click();
  await expect(page.locator(".board-design-option:enabled")).toHaveCount(6);
});

registerBoardDesignGameTests();
