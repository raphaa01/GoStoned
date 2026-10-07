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

test("dark landing page has a dark water scene and continuous chapter palette", async ({ page }, info) => {
  await installHarness(page);
  await page.addInitScript(() => localStorage.setItem("gostone.theme.v1", "dark"));
  await page.goto("/de");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".hero-stone-image")).toBeVisible();
  await expect.poll(() => page.locator(".hero-stone-image").evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect.poll(() => page.locator(".hero-stone-stage").evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
  const colors = await page.locator(".home-chapters").evaluate((element) => ({
    background: getComputedStyle(element).backgroundColor,
    transition: getComputedStyle(document.querySelector(".home-hero")!, "::after").backgroundImage,
  }));
  expect(colors.background).toBe("rgb(17, 19, 16)");
  expect(colors.transition).not.toContain("238, 233, 223");
  await assertNoOverflow(page);
  await page.screenshot({ path: `.cache/website-dark-${info.project.name}.png`, animations: "disabled" });
});
