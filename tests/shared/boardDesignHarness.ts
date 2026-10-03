import { expect, test, type Page, type Route } from "@playwright/test";
import { BOARD_DESIGNS, type BoardDesignId } from "../../lib/boardDesign";
import { EXPECTED_PLAYER_HEADER } from "../../lib/auth/playerBinding";
import type { BoardSize, GameState } from "../../lib/game/types";

export const USER = {
  id: "11111111-1111-4111-8111-111111111111", username: "skin_player", displayName: "Skin Player",
  playerKey: "user:11111111-1111-4111-8111-111111111111", avatarStyle: "kifu-classic",
};
export const GAME_ID = "33333333-3333-4333-8333-333333333333";
export function gameFor(size: BoardSize, mode: "matchmaking" | "friendly" | "bot"): GameState {
  const time = new Date().toISOString();
  const board: GameState["board"] = Array.from({ length: size }, () => Array.from({ length: size }, () => null));
  board[0][0] = "black";
  board[0][1] = "white";
  return {
    id: GAME_ID, gameType: mode === "bot" ? "friendly" : mode, boardSize: size,
    blackPlayerKey: USER.playerKey, whitePlayerKey: "guest:22222222-2222-4222-8222-222222222222",
    blackPlayerName: USER.displayName, whitePlayerName: mode === "bot" ? "GoStone Bot" : "Friend",
    whitePlayerIsBot: mode === "bot", winnerKey: null, rated: false, status: "active", phase: "play",
    result: null, finishReason: null, komi: 7.5, ruleset: "chinese", rulesProfile: "chinese-2002-gostone-v1",
    scoringMethod: "area", handicap: 0, consecutivePasses: 0, scoringRevision: 0, scoring: null, lastResume: null,
    version: 2, startedAt: time, finishedAt: null, timeControl: "rapid", turn: "black", moveCount: 2, board,
    moves: [
      { moveNumber: 1, color: "black", x: 0, y: 0, isPass: false, createdAt: time },
      { moveNumber: 2, color: "white", x: 1, y: 0, isPass: false, createdAt: time },
    ],
    clock: { serverNow: time, mainTimeSeconds: 600, byoYomiPeriods: 5, byoYomiSeconds: 30,
      black: { mainTimeMs: 600000, displayTimeMs: 600000, periodsRemaining: 5, phase: "main" },
      white: { mainTimeMs: 600000, displayTimeMs: 600000, periodsRemaining: 5, phase: "main" } },
  };
}

export async function installHarness(page: Page) {
  const state = {
    design: "default" as BoardDesignId, wins: 50, failSave: false, failLoad: false,
    game: gameFor(19, "friendly"), selections: [] as BoardDesignId[], moves: [] as unknown[],
  };
  async function json(route: Route, body: unknown, status = 200) {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body), status });
  }
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/api/auth/session") return json(route, { ok: true, user: USER });
    if (pathname === "/api/profile/rating") return json(route, { ok: true, rating: null });
    if (pathname === "/api/profile/preferences") return json(route, { ok: true, preferences: { boardPlacement: "direct" } });
    if (pathname === "/api/profile") return json(route, { ok: true, history: [], recentGames: [] });
    if (pathname === "/api/profile/board-design") {
      if (request.method() === "PATCH") {
        const body = request.postDataJSON() as { design: BoardDesignId };
        state.selections.push(body.design);
        if (state.failSave) return json(route, { ok: false, error: "Save failed" }, 500);
        state.design = body.design;
      } else if (state.failLoad) return json(route, { ok: false, error: "Load failed" }, 500);
      return json(route, { ok: true, preference: { design: state.design, wins: state.wins } });
    }
    if (pathname === `/api/games/${GAME_ID}`) {
      state.game.clock.serverNow = new Date().toISOString();
      return json(route, { ok: true, actor: USER.playerKey, game: state.game });
    }
    if (pathname === `/api/games/${GAME_ID}/chat`) return json(route, { ok: true, actor: USER.playerKey, available: true, messages: [] });
    if (pathname === `/api/games/${GAME_ID}/block`) return json(route, { ok: true, actor: USER.playerKey, blocked: false });
    if (pathname === `/api/games/${GAME_ID}/moves`) {
      expect(request.headers()[EXPECTED_PLAYER_HEADER]).toBe(USER.playerKey);
      const body = request.postDataJSON() as { x: number; y: number; expectedVersion: number };
      state.moves.push(body);
      expect(body.expectedVersion).toBe(state.game.version);
      state.game.board[body.y][body.x] = "black";
      state.game.version++;
      state.game.moveCount++;
      state.game.moves.push({ moveNumber: state.game.moveCount, color: "black", x: body.x, y: body.y, isPass: false, createdAt: new Date().toISOString() });
      state.game.turn = "white";
      return json(route, { ok: true, actor: USER.playerKey, game: state.game });
    }
    return json(route, { ok: true });
  });
  return state;
}

export async function assertNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
}

export function registerBoardDesignGameTests() {
  for (const size of [9, 13, 19] as const) for (const mode of ["matchmaking", "friendly", "bot"] as const) {
    test(`${size}×${size} ${mode}: all available skins preserve stones, grid and move coordinates`, async ({ page }, info) => {
      test.skip(!/390|1440/.test(info.project.name), "Phone and desktop exercise the shared game renderer.");
      test.setTimeout(90000);
      const state = await installHarness(page);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      for (const entry of BOARD_DESIGNS.filter((design) => design.wins !== null)) {
        state.design = entry.id;
        state.game = gameFor(size, mode);
        state.moves = [];
        await page.goto(`/de/game/${GAME_ID}`);
        const board = page.locator(".go-board");
        await expect(board).toHaveAttribute("data-board-design", entry.id);
        if (await page.locator(".mobile-splash").count()) await expect(page.locator(".mobile-splash")).toHaveAttribute("aria-hidden", "true");
        await expect(board.locator(".intersection")).toHaveCount(size * size);
        await expect(board.locator(".board-line")).toHaveCount(size * 2);
        await expect(board.locator(".stone--black")).toHaveCount(1);
        await expect(board.locator(".stone--white")).toHaveCount(1);
        const shape = await board.locator(".intersection").first().evaluate((point) => {
          const bounds = point.getBoundingClientRect();
          return { width: bounds.width, height: bounds.height };
        });
        expect(Math.abs(shape.width - shape.height)).toBeLessThan(1);
        if (entry.id !== "default") {
          expect(await board.locator(".stone--black").evaluate((stone) => getComputedStyle(stone).background)).not.toBe(
            await board.locator(".stone--white").evaluate((stone) => getComputedStyle(stone).background));
        }
        const center = Math.floor(size / 2);
        const target = board.locator(".intersection").nth(center * size + center);
        await expect(target).toBeEnabled();
        if (info.project.use.hasTouch) await target.tap(); else await target.click();
        await expect.poll(() => state.moves.length).toBe(1);
        expect(state.moves[0]).toMatchObject({ x: center, y: center, expectedVersion: 2 });
        await expect(target.locator(".stone--black")).toHaveCount(1);
        await assertNoOverflow(page);
      }
      expect(errors).toEqual([]);
    });
  }
}
