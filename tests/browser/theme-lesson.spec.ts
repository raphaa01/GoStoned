import { expect, test } from "@playwright/test";
import { installHarness, assertNoOverflow } from "../shared/boardDesignHarness";
test("website opens light on a dark device and remembers explicit preferences", async ({ page }) => {
  await installHarness(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/de");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.evaluate(() => localStorage.setItem("gostone.theme.v1", "dark"));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.goto("/de/login");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.evaluate(() => localStorage.setItem("gostone.theme.v1", "system"));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("dark home shows the dark water artwork and the personal game overview", async ({ page }, info) => {
  await installHarness(page);
  await page.addInitScript(() => localStorage.setItem("gostone.theme.v1", "dark"));
  await page.goto("/de");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const image = page.locator(".hero-stone-image.stone-artwork--dark");
  await expect(image).toBeVisible();
  await expect(page.locator(".hero-stone-image.stone-artwork--light")).toBeHidden();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator(".home-hero")).toHaveCSS("background-color", "rgb(17, 19, 16)");
  await expect(page.locator(".home-games-empty")).toHaveCSS("background-color", "rgb(70, 67, 61)");
  await assertNoOverflow(page);
  await page.screenshot({ path: `.cache/website-dark-${info.project.name}.png`, animations: "disabled" });
});
