import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { installHarness, GAME_ID } from "../shared/boardDesignHarness";
import { getDictionary } from "../../lib/i18n/dictionary";
import { installLearningFixture } from "../shared/betaFixHarness";
import { contrast } from "../shared/gameReadabilityHarness";

test.beforeEach(async () => { await mkdir(".cache/visual-audit", { recursive: true }); });

test("unknown app destinations offer a localized route home", async ({ page }) => {
  await installHarness(page);
  await page.goto("/de/no-such-page");
  const copy = getDictionary("de").notFound;
  await expect(page.getByRole("heading", { name: copy.title })).toBeVisible();
  await page.getByRole("link", { name: copy.action }).click();
  await expect(page).toHaveURL(/\/de\/?$/);
});

test("the app document language follows the current locale", async ({ page }) => {
  await installHarness(page);
  for (const locale of ["de", "ja", "fr"]) {
    await page.goto(`/${locale}/login`);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
  }
});

test("long legal headings and links fit a narrow phone", async ({ page }, info) => {
  await installHarness(page);
  await page.setViewportSize({ width: 320, height: 740 });
  for (const theme of ["light", "dark"]) {
    await page.addInitScript(value => localStorage.setItem("gostone.mobile.theme.v1", value), theme);
    for (const route of ["privacy", "impressum", "delete-account"]) {
      await page.goto(`/de/${route}`);
      const card = page.locator(".mobile-legal-page");
      await expect(card).toBeVisible();
      expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      const outside = await card.locator("h1, a").evaluateAll(elements => elements.filter(element => {
        const box = element.getBoundingClientRect();
        return box.left < 0 || box.right > innerWidth;
      }).length);
      expect(outside).toBe(0);
      await expect(page.locator(".mobile-splash")).toHaveAttribute("aria-hidden", "true");
      await page.screenshot({ path: `.cache/visual-audit/audit-${route}-${theme}-${info.project.name}.png`, fullPage: true });
    }
  }
});

test("all winding learning-path labels stay inside a narrow phone", async ({ page }, info) => {
  await installHarness(page);
  await installLearningFixture(page);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/de/learn");
  await expect(page.locator(".learn-route-node").first()).toBeVisible();
  const outside = await page.locator(".learn-route-node, .learn-route-node__copy").evaluateAll(elements => elements.filter(element => {
    const box = element.getBoundingClientRect();
    return box.left < -1 || box.right > innerWidth + 1;
  }).map(element => element.textContent));
  expect(outside).toEqual([]);
  await expect(page.locator(".mobile-splash")).toHaveAttribute("aria-hidden", "true");
  await page.screenshot({ path: `.cache/visual-audit/audit-learning-labels-${info.project.name}.png`, animations: "disabled" });
});

test("failed logout remains retryable and reports the error without an unhandled rejection", async ({ page }) => {
  await installHarness(page);
  let fail = true;
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/auth/logout", route => route.fulfill({ status: fail ? 503 : 200,
    json: fail ? { ok: false, code: "logout_failed" } : { ok: true } }));
  await page.goto("/de/profile/settings");
  await page.locator(".mobile-logout").click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(errors).toEqual([]);
  await expect(page.locator(".mobile-logout")).toBeEnabled();
  fail = false;
  await page.route("**/api/auth/session", route => route.fulfill({ json: { ok: true, user: null } }));
  await page.locator(".mobile-logout").click();
  await expect(page).toHaveURL(/\/de\/?$/);
});

test("dark training setup and active game panels use the app palette", async ({ page }, info) => {
  await installHarness(page);
  await page.addInitScript(() => localStorage.setItem("gostone.mobile.theme.v1", "dark"));
  await page.goto("/de/learn/ai");
  await expect(page.locator("html")).toHaveAttribute("data-mobile-theme", "dark");
  const panel = page.locator(".training-setup-card");
  expect(await contrast(panel.locator("h2"), panel)).toBeGreaterThanOrEqual(4.5);
  expect(await contrast(panel.locator("label").first(), panel)).toBeGreaterThanOrEqual(4.5);
  expect(await contrast(panel.locator("select"))).toBeGreaterThanOrEqual(4.5);
  const selected = page.locator(".training-time-selector button.is-selected");
  expect(await contrast(selected)).toBeGreaterThanOrEqual(4.5);
  expect(await contrast(page.locator(".training-privacy-note"), panel)).toBeGreaterThanOrEqual(4.5);
  expect(await contrast(page.locator(".training-model-note"), panel)).toBeGreaterThanOrEqual(4.5);
  await expect(page.locator(".mobile-splash")).toHaveAttribute("aria-hidden", "true");
  await page.screenshot({ path: `.cache/visual-audit/audit-training-dark-${info.project.name}.png`, fullPage: true });
  await page.locator(".training-start").click();
  for (const selector of [".training-board-panel", ".training-side-panel"]) {
    await expect(page.locator(selector)).toBeVisible();
  }
  expect(await contrast(page.locator(".training-turn-status strong"), page.locator(".training-board-panel"))).toBeGreaterThanOrEqual(4.5);
  expect(await contrast(page.locator(".training-actions button").first())).toBeGreaterThanOrEqual(4.5);
});

test("All games opens the history section rather than the profile header", async ({ page }) => {
  await installHarness(page);
  await page.route("**/api/profile", route => route.fulfill({ json: { ok: true, history: [], recentGames: Array.from({ length: 10 }, (_, index) => ({
    gameId: `${GAME_ID.slice(0, -2)}${String(index).padStart(2, "0")}`, boardSize: 9, timeControl: "blitz", opponentName: `Opponent ${index}`,
    result: "win", gameResult: "B+R", rated: false, ratingChange: null,
    finishedAt: new Date().toISOString(),
  })) } }));
  await page.goto("/de");
  await page.locator('a[href="/de/profile#game-history"]').click();
  const history = page.locator("#game-history");
  await expect(history).toBeVisible();
  await expect.poll(() => history.evaluate(element => {
    const target = element.getBoundingClientRect().top + window.scrollY;
    const maximum = document.documentElement.scrollHeight - innerHeight;
    const inset = Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
    const margin = Number.parseFloat(getComputedStyle(element).scrollMarginTop) || 0;
    return Math.abs(window.scrollY - Math.min(Math.max(0, target - inset - margin), maximum));
  })).toBeLessThan(2);
});
