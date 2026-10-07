import { expect, test, type Page } from "@playwright/test";
import { gameFor, GAME_ID, installHarness, USER, assertNoOverflow } from "./boardDesignHarness";
import { LEARN_LESSON_IDS, emptyLearnProgress } from "../../lib/learn/progress";
import type { PuzzlePly } from "../../lib/puzzles/types";

export function registerBetaGameTests(mobile: boolean) {
  test("opponent passes stay visible until the next move", async ({ page }) => {
    const state = await installHarness(page);
    state.game = gameFor(9, "friendly");
    state.game.blackRating = 900;
    state.game.whiteRating = 1100;
    state.game.consecutivePasses = 1;
    state.game.moves[1] = { ...state.game.moves[1], isPass: true, x: null, y: null };
    state.game.board[0][1] = null;
    await page.goto(`/de/game/${GAME_ID}`);
    await expect(page.locator(".game-pass-notice")).toContainText("Friend");
    await expect(page.locator(".game-pass-notice")).toContainText("Weiß passte.");
    if (mobile) {
      await expect(page.locator(".game-player-rank")).toHaveCount(2);
      await expect(page.locator(".game-player-rank").first()).toBeVisible();
      await expect(page.locator(".game-player-detail").first()).toBeHidden();
      await expect(page.locator(".game-turn-detail")).toBeHidden();
    }
    const next = page.locator(".intersection").nth(20);
    await next.click();
    state.game.consecutivePasses = 0;
    await expect(page.locator(".game-pass-notice")).toHaveCount(0);
  });

  test("the result dialog creates a selectable public share link", async ({ page }) => {
    const state = await installHarness(page);
    state.game = { ...gameFor(9, "friendly"), status: "finished", winnerKey: USER.playerKey,
      result: "B+R", finishReason: "resignation", finishedAt: new Date().toISOString(), turn: null };
    await page.route(`**/api/games/${GAME_ID}/share`, async (route) => {
      expect(route.request().method()).toBe("POST");
      expect(route.request().headers()["x-gostone-expected-player"]).toBe(USER.playerKey);
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, url: "https://gostone.app/shared-game/44444444-4444-4444-8444-444444444444" }) });
    });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "share", { configurable: true, value: async () => { throw new DOMException("Activation expired", "NotAllowedError"); } });
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("Clipboard blocked"); } } });
    });
    await page.goto(`/de/game/${GAME_ID}`);
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Sieg", exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Partie teilen", exact: true }).click();
    await expect(dialog.getByRole("textbox", { name: "Partie teilen" })).toHaveValue(/^https:\/\/gostone\.app\/shared-game\//);
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await assertNoOverflow(page);
  });

  test("puzzle undo removes the failed branch and continues at the last correct decision", async ({ page }) => {
    await installHarness(page);
    const progress: PuzzlePly[] = [
      { color: "black", x: 0, y: 0, move: "A9" },
      { color: "white", x: 1, y: 0, move: "B9" },
    ];
    let attempts = 0;
    await page.route("**/api/puzzles**", async (route) => {
      const url = new URL(route.request().url());
      let body: unknown;
      if (url.pathname.endsWith("/attempt")) {
        const move = route.request().postDataJSON();
        attempts++;
        expect(move.revision).toBe(attempts === 1 ? 2 : 3);
        body = { ok: true, actor: USER.playerKey, attempt: {
          puzzleId: GAME_ID, correct: attempts === 2, outcome: attempts === 1 ? "retry" : "continue",
          solved: false, attemptCount: attempts + 1, firstAttemptCorrect: false,
          variationProgress: progress, variationRevision: attempts + 2, solution: null,
          displayLine: attempts === 1 ? [
            { color: "black", x: move.x, y: move.y, move: "C7" },
            { color: "white", x: 3, y: 3, move: "D6" },
          ] : [],
        } };
      } else body = { ok: true, actor: USER.playerKey, status: "ready", mode: "practice", expectedPerCategory: 1,
        categoryCounts: { tesuji: 1 }, puzzles: [{
          id: GAME_ID, kind: "practice", category: "tesuji", rankKyu: 20, collectionOrder: 1,
          dailyDate: null, boardSize: 9, toPlay: "black", board: Array.from({ length: 9 }, () => Array(9).fill(null)),
          difficulty: "beginner", publishedAt: "2026-10-07T00:00:00Z", attemptCount: 1,
          solved: false, firstAttemptCorrect: null, variationProgress: progress, variationRevision: 2, solution: null,
        }] };
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.goto("/de/puzzles?mode=practice");
    await page.getByRole("button", { name: /Tesuji/ }).click();
    const board = page.locator(".go-board");
    await board.locator(".intersection").nth(20).click();
    await page.getByRole("button", { name: "Zug zurück", exact: true }).click();
    await expect(board.locator(".stone--black")).toHaveCount(1);
    await expect(board.locator(".stone--white")).toHaveCount(1);
    await expect(board.locator(".intersection").nth(21)).toBeEnabled();
    await board.locator(".intersection").nth(21).click();
    await expect.poll(() => attempts).toBe(2);
  });
}

export async function installLearningFixture(page: Page) {
  const progress = { ...emptyLearnProgress(), completedLessonIds: LEARN_LESSON_IDS.slice(0, 20), currentLessonId: "s3-one-eye",
    updatedAt: new Date().toISOString() };
  await page.route("**/api/learn/progress", async (route) => route.fulfill({
    contentType: "application/json", body: JSON.stringify({ ok: true, progress }),
  }));
}
