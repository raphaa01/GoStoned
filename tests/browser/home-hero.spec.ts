import { expect, test } from "@playwright/test";

test("keeps the primary homepage action visible and proportionally anchored", async ({ page }) => {
  await page.goto("/");

  const hero = page.locator(".home-hero");
  const startPlay = page.getByRole("link", { name: "Start Play" });

  await expect(hero).toBeVisible();
  await expect(startPlay).toBeVisible();

  const heroBox = await hero.boundingBox();
  const buttonBox = await startPlay.boundingBox();
  const viewport = page.viewportSize();

  expect(heroBox).not.toBeNull();
  expect(buttonBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (!heroBox || !buttonBox || !viewport) return;

  expect(buttonBox.x).toBeGreaterThanOrEqual(0);
  expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(viewport.width);
  expect(buttonBox.y).toBeGreaterThanOrEqual(heroBox.y);
  expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(viewport.height);

  const relativeButtonTop = (buttonBox.y - heroBox.y) / heroBox.height;
  expect(relativeButtonTop).toBeGreaterThan(0.6);
  expect(relativeButtonTop).toBeLessThan(0.9);
});
