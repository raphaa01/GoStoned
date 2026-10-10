import { expect, test } from "@playwright/test";
import { serializeAuthUser, type AuthUser } from "../../lib/auth/types";
import { LEARN_LESSONS, line } from "../../lib/learn/curriculum";
import { emptyLearnProgress, parseLearnProgress } from "../../lib/learn/progress";
import { installHarness, assertNoOverflow, GAME_ID } from "./boardDesignHarness";

const developer = serializeAuthUser({
  id: "2f507157-9a4a-4960-b3c8-87fa721cdd26", username: "developer", display_name: "developer",
});

export function registerDeveloperAccessTests(mobile: boolean) {
  // Website lesson routes require a real server-side session. That path is
  // covered by verify-developer-browser.ts against isolated PostgreSQL, not
  // bypassed by a client API fixture.
  if (mobile) test("developer can open the last lesson without completion; revoked sessions restore linear locks", async ({ page }) => {
    await installHarness(page);
    let user: AuthUser | null = developer;
    let progress = emptyLearnProgress();
    await page.route("**/api/auth/session", route => route.fulfill({ json: { ok: true, user } }));
    await page.route("**/api/learn/progress", route => {
      if (route.request().method() === "PUT") progress = parseLearnProgress(route.request().postDataJSON().progress);
      return route.fulfill({ json: { ok: true, progress } });
    });
    await page.goto("/de/learn");
    const nodes = page.locator(".learn-route-node");
    await expect(nodes).toHaveCount(LEARN_LESSONS.length);
    await expect(page.locator(".learn-route-node:disabled")).toHaveCount(0);
    await expect(page.locator(".learn-path-stage.is-locked")).toHaveCount(0);
    await expect(page.locator(".learn-developer-access")).toBeVisible();
    const last = LEARN_LESSONS.at(-1)!;
    await nodes.filter({ hasText: line(last.title, "de") }).click();
    await expect(page.locator(".learn-player__heading h1")).toHaveText(line(last.title, "de"));
    expect(progress.completedLessonIds).toEqual([]);
    expect(progress.completedStages).toEqual([]);
    user = serializeAuthUser({ ...developer, id: "ordinary-user", display_name: "developer" });
    await page.evaluate(() => window.dispatchEvent(new Event("gostone:auth-change")));
    await expect(page.locator(".learn-developer-access")).toHaveCount(0);
    await expect(page.locator(".learn-route-node:not(:disabled)")).toHaveCount(1);
    await expect(page.locator(".learn-player")).toHaveCount(0);
    await page.reload();
    await expect(page.locator(".learn-route-node:not(:disabled)")).toHaveCount(1);
    expect(progress.completedLessonIds).toEqual([]);
    await assertNoOverflow(page);
    user = null;
    await page.evaluate(() => window.dispatchEvent(new Event("gostone:auth-change")));
    await expect(page.locator(".learn-route-node")).toHaveCount(0);
  });

  for (const theme of ["light", "dark"] as const) {
    test(`DEV nametag is readable next to the player name in ${theme} mode`, async ({ page }, info) => {
      const state = await installHarness(page);
      state.game = { ...state.game, blackPlayerKey: developer.playerKey, blackPlayerName: developer.displayName,
        blackPlayerIsDeveloper: true, whitePlayerIsDeveloper: false };
      await page.route("**/api/auth/session", route => route.fulfill({ json: { ok: true, user: developer } }));
      await page.route(`**/api/games/${GAME_ID}`, route => route.fulfill({ json: { ok: true, actor: developer.playerKey, game: state.game } }));
      await page.route(`**/api/games/${GAME_ID}/chat`, route => route.fulfill({ json: { ok: true, actor: developer.playerKey, available: true, messages: [] } }));
      await page.route(`**/api/games/${GAME_ID}/block`, route => route.fulfill({ json: { ok: true, actor: developer.playerKey, blocked: false } }));
      await page.addInitScript(({ key, theme }) => localStorage.setItem(key, theme), { key: mobile ? "gostone.mobile.theme.v1" : "gostone.theme.v1", theme });
      await page.goto(`/de/game/${GAME_ID}`);
      const tag = page.locator(".game-player-heading .developer-tag");
      if (mobile && await page.locator(".mobile-splash").count()) {
        await expect(page.locator(".mobile-splash")).toHaveAttribute("aria-hidden", "true");
      }
      await expect(tag).toHaveCount(1);
      await expect(tag).toBeVisible();
      await expect(tag).toHaveText("DEV");
      await expect(tag).toHaveAttribute("aria-label", "Developer-Konto");
      expect(await tag.evaluate(element => {
        const style = getComputedStyle(element);
        return style.color !== style.backgroundColor;
      })).toBe(true);
      await assertNoOverflow(page);
      await page.screenshot({ path: `.cache/developer-tag-${info.project.name}-${theme}.png` });
    });
  }
}
