import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

for (const theme of ["light", "dark"]) test(`404 pages preserve the saved ${theme} appearance`, async ({ page }, info) => {
  await page.addInitScript(value => localStorage.setItem("gostone.theme.v1", value), theme);
  const response = await page.goto("/de/not-a-real-page");
  expect(response?.status()).toBe(404);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  const home = page.getByRole("link", { name: "Zurück zu GoStone" });
  await expect(home).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir(".cache/visual-audit", { recursive: true });
  await page.screenshot({ path: `.cache/visual-audit/audit-404-${theme}-${info.project.name}.png`, fullPage: true });
});
