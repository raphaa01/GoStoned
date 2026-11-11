import { expect, test } from "@playwright/test";

test("keeps the primary homepage action visible and proportionally anchored", async ({ page }) => {
  await page.goto("/");

  const hero = page.locator(".home-hero");
  const startPlay = page.getByRole("link", { name: "Start a game" });

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

test("matches the play and progress heading sizes on the German home page", async ({ page }) => {
  await page.route("**/api/games", (route) => route.fulfill({ json: {
    summary: { unfinishedGames: 0, gamesStartedLast24Hours: "under_5", recentlyWaitingPlayers: 0, observedAt: new Date().toISOString() },
  } }));
  await page.goto("/de");
  const play = page.getByRole("heading", { name: "Online Go spielen", exact: true });
  const progress = page.getByRole("heading", { name: "Partien und Wertung im Blick", exact: true });
  await expect(progress).toBeVisible();
  await expect(progress).toHaveCSS("font-size", await play.evaluate((heading) => getComputedStyle(heading).fontSize));
  const sizes = await page.locator(".home-experience *").evaluateAll((elements) =>
    [...new Set(elements.filter((element) =>
      element instanceof HTMLElement && element.getClientRects().length > 0
      && !element.closest(".sr-only")
      && [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()),
    ).map((element) => getComputedStyle(element).fontSize))],
  );
  expect(sizes).toHaveLength(3);
});
