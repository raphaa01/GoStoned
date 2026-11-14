import { expect, test } from "@playwright/test";
import { assertNoOverflow, installHarness } from "../shared/boardDesignHarness";
import { installLearningFixture, registerBetaGameTests } from "../shared/betaFixHarness";

registerBetaGameTests(true);

test("dark guest surfaces and portrait leaderboard stay inside the viewport", async ({ page }, info) => {
  await installHarness(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => localStorage.setItem("gostone.mobile.theme.v1", "dark"));
  await page.route("**/api/auth/session", async (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, user: null }) }));
  await page.route("**/api/stats", async (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    ok: true, observedAt: new Date().toISOString(), leaderboard: [{ position: 1, playerName: "Leaderboard Player", games: 24, wins: 15, rating: 1642, ratingDeviation: 58 }],
  }) }));
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-mobile-theme", "dark");
  await expect(page.locator(".home-tournament canvas")).toBeVisible();
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(48, 46, 39)");
  expect(await page.locator("html").evaluate((element) => getComputedStyle(element).overscrollBehaviorY)).toBe("none");
  await page.goto("/leaderboard");
  await expect(page.locator(".leaderboard-table td:last-child strong")).toBeVisible();
  const rating = await page.locator(".leaderboard-table td:last-child").boundingBox();
  expect(rating!.x + rating!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await assertNoOverflow(page);
  await expect(page.locator(".mobile-splash")).toHaveAttribute("aria-hidden", "true");
  await page.screenshot({ path: `.cache/beta-leaderboard-${info.project.name}.png` });
});

for (const platform of ["android", "ios"]) {
  test(`lesson board and Continue fit together on a short ${platform} screen`, async ({ page }, info) => {
    test.skip(info.project.name !== "mobile-390-touch", "This check uses a short phone layout.");
    await page.setViewportSize({ width: 320, height: 640 });
    await installHarness(page);
    await installLearningFixture(page);
    await page.addInitScript(() => localStorage.setItem("gostone.mobile.theme.v1", "dark"));
    await page.goto("/de/learn");
    await page.locator("html").evaluate((root, platform) => {
      root.dataset.mobilePlatform = platform;
      root.dataset.nativeTabBar = String(platform === "ios");
      root.style.setProperty("--mobile-safe-top", "36px");
      root.style.setProperty("--mobile-safe-bottom", "22px");
    }, platform);
    await page.locator(".learn-next-dock__button").click();
    const board = page.getByRole("grid");
    const next = page.getByRole("button", { name: "Weiter", exact: true });
    await expect(board).toBeInViewport({ ratio: 1 });
    await expect(next).toBeInViewport({ ratio: 1 });
    const cutoff = 640 - 22 - (platform === "ios" ? 49 : 64);
    for (const solved of [false, true]) {
      if (solved) await board.getByRole("gridcell").first().click();
      const boardBox = (await board.boundingBox())!;
      const buttonBox = (await next.boundingBox())!;
      expect(boardBox.y + boardBox.height).toBeLessThanOrEqual(buttonBox.y);
      expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(cutoff);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
    }
    await page.screenshot({ path: `.cache/lesson-short-${platform}.png` });
    await next.click();
    await expect(page.locator(".learn-player__topbar")).toContainText("2 / 2");
  });
}

test("lesson Continue remains visible above tabs without scrolling", async ({ page }, info) => {
  await installHarness(page);
  await installLearningFixture(page);
  await page.goto("/de/learn");
  await page.locator(".learn-next-dock__button").click();
  await expect(page.getByRole("heading", { name: "Ein Auge", exact: true })).toBeVisible();
  await page.locator(".interactive-learn-board__point").first().click();
  const next = page.getByRole("button", { name: "Weiter", exact: true });
  await expect(next).toBeEnabled();
  const bounds = await next.boundingBox();
  const tabs = await page.locator(".mobile-tab-bar").boundingBox();
  expect(bounds!.y).toBeGreaterThan(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(tabs!.y);
  await page.screenshot({ path: `.cache/beta-learn-${info.project.name}.png` });
  await next.click();
  await expect(page.locator(".learn-player__topbar")).toContainText("2 / 2");
});
