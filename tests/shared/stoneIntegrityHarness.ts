import { expect, test } from "@playwright/test";
import { applyMove, createEmptyBoard, replayMoves } from "../../lib/game/goEngine";
import { captureIncidentMoves } from "../../lib/game/fixtures/captureIncident9x9";
import { GAME_ID, USER, gameFor, installHarness } from "./boardDesignHarness";

export function registerStoneIntegrityTests() {
  test("a move appears before the POST response and a newer capture cannot leave a ghost stone", async ({ page }) => {
    const state = await installHarness(page);
    state.game = { ...gameFor(9, "friendly"), board: createEmptyBoard(9),
      moves: [
        { moveNumber: 1, color: "black", x: null, y: null, isPass: true, createdAt: "" },
        { moveNumber: 2, color: "white", x: 1, y: 0, isPass: false, createdAt: "" },
      ] };
    state.game.board[0][1] = "white";
    let releasePost!: () => void;
    const postGate = new Promise<void>(resolve => { releasePost = resolve; });
    let postStarted = false;
    await page.route(`**/api/games/${GAME_ID}/moves`, async route => {
      postStarted = true;
      const body = route.request().postDataJSON();
      expect(body).toMatchObject({ x: 0, y: 0, expectedVersion: 2 });
      const placed = applyMove(state.game.board, "black", 0, 0);
      expect(placed.ok).toBe(true);
      if (!placed.ok) return;
      const confirmed = { ...state.game, version: 3, moveCount: 3, board: placed.board,
        turn: "white" as const, moves: [...state.game.moves,
          { moveNumber: 3, color: "black" as const, x: 0, y: 0, isPass: false, createdAt: "" }] };
      const captured = applyMove(confirmed.board, "white", 0, 1);
      expect(captured.ok).toBe(true);
      if (!captured.ok) return;
      state.game = { ...confirmed, version: 4, moveCount: 4, board: captured.board, turn: "black",
        moves: [...confirmed.moves, { moveNumber: 4, color: "white", x: 0, y: 1, isPass: false, createdAt: "" }] };
      await postGate;
      await route.fulfill({ json: { ok: true, actor: USER.playerKey, game: confirmed } });
    });
    try {
      await page.goto(`/de/game/${GAME_ID}`);
      const board = page.locator(".go-board");
      const corner = board.locator(".intersection").first();
      await expect(corner).toBeEnabled();
      await corner.click();
      await expect(corner.locator(".stone--black")).toHaveCount(1, { timeout: 500 });
      await expect.poll(() => postStarted).toBe(true);
      await expect(board.locator(".intersection").nth(9).locator(".stone--white")).toHaveCount(1);
      await expect(corner.locator(".stone")).toHaveCount(0);
      releasePost();
      await expect(corner).toBeEnabled();
      await expect(corner.locator(".stone")).toHaveCount(0);
      await expect(board.locator(".stone--white")).toHaveCount(2);
    } finally {
      releasePost();
    }
  });

  test("the reported capture is rendered exactly and a corrupt poll cannot remove an unrelated white stone", async ({ page }) => {
    const state = await installHarness(page);
    state.game = { ...gameFor(9, "friendly"), version: 37, moveCount: 37, turn: "white",
      moves: captureIncidentMoves.slice(0, 37), board: replayMoves(9, captureIncidentMoves.slice(0, 37)) };
    await page.goto(`/de/game/${GAME_ID}`);
    const board = page.locator(".go-board");
    const capturedPoint = board.locator(".intersection").nth(3);
    const preservedPoint = board.locator(".intersection").nth(42);
    await expect(capturedPoint.locator(".stone--black")).toHaveCount(1);
    await expect(preservedPoint.locator(".stone--white")).toHaveCount(1);
    const correct = { ...state.game, version: 38, moveCount: 38, turn: "black" as const,
      moves: captureIncidentMoves.slice(0, 38), board: replayMoves(9, captureIncidentMoves.slice(0, 38)) };
    let corruptPolls = 0;
    state.game = { ...correct, board: correct.board.map(row => [...row]) };
    state.game.board[4][6] = null;
    await page.route(`**/api/games/${GAME_ID}?*`, async route => {
      corruptPolls++;
      await route.fulfill({ json: { ok: true, game: state.game } });
    });
    await expect.poll(() => corruptPolls).toBeGreaterThanOrEqual(2);
    await expect(capturedPoint.locator(".stone--black")).toHaveCount(1);
    await expect(preservedPoint.locator(".stone--white")).toHaveCount(1);
    state.game = correct;
    await expect(capturedPoint.locator(".stone")).toHaveCount(0);
    await expect(board.locator(".intersection").nth(2).locator(".stone--white")).toHaveCount(1);
    await expect(preservedPoint.locator(".stone--white")).toHaveCount(1);
  });
}
