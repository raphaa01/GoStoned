import { expect, test } from "@playwright/test";
import { de } from "../../lib/i18n/catalogs/de";

test("protects learning lessons and preserves the localized return path", async ({ page }) => {
  await page.goto("/de/learn");

  await expect.poll(() => {
    const current = new URL(page.url());
    return `${current.pathname}${current.search}`;
  }).toBe("/de/register?returnTo=%2Flearn");

  await expect(page.getByRole("heading", { name: de.auth.createTitle })).toBeVisible();
  await expect(page.locator("#main-content").getByRole("link", { name: de.auth.login })).toHaveAttribute(
    "href",
    "/de/login?returnTo=%2Flearn",
  );
  await expect(page.locator(".lesson-board")).toHaveCount(0);
});
