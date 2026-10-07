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
  const stone = await page.locator(".mobile-home-stone span").evaluate((element) => getComputedStyle(element).backgroundImage);
  expect(stone).toContain("rgb(255, 255, 255)");
  expect(await page.locator("html").evaluate((element) => getComputedStyle(element).overscrollBehaviorY)).toBe("none");
  await page.goto("/leaderboard");
  await expect(page.locator(".leaderboard-table td:last-child strong")).toBeVisible();
  const rating = await page.locator(".leaderboard-table td:last-child").boundingBox();
  expect(rating!.x + rating!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await assertNoOverflow(page);
  await expect(page.locator(".mobile-splash")).toHaveAttribute("aria-hidden", "true");
  await page.screenshot({ path: `.cache/beta-leaderboard-${info.project.name}.png` });
});

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
