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

test("dark home uses the warm palette on the canvas and modules", async ({ page }, info) => {
  await installHarness(page);
  await page.addInitScript(() => localStorage.setItem("gostone.theme.v1", "dark"));
  await page.goto("/de");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(48, 46, 39)");
  await expect(page.locator(".home-tournament canvas")).toBeVisible();
  await expect(page.locator(".home-games-empty")).toHaveCSS("background-color", "rgb(70, 67, 61)");
  await assertNoOverflow(page);
  await page.screenshot({ path: `.cache/website-dark-${info.project.name}.png`, animations: "disabled" });
});
