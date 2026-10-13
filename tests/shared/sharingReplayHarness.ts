import { expect, test } from "@playwright/test";
import { GAME_ID, USER, gameFor, installHarness, assertNoOverflow } from "./boardDesignHarness";
import { captureIncidentMoves } from "../../lib/game/fixtures/captureIncident9x9";
import { replayMoves } from "../../lib/game/goEngine";
import type { SharedFinishedGame } from "../../lib/game/sharedGameService";

const TOKEN = "44444444-4444-4444-8444-444444444444";
const board = replayMoves(9, captureIncidentMoves);
const shared: SharedFinishedGame = {
  boardSize: 9, board, moves: captureIncidentMoves, moveCount: 48,
  blackPlayerName: "Black Player", whitePlayerName: "White Player", result: "W+6.5",
  finishReason: "score", timeControl: "rapid", lastMove: null,
  deadStones: [{ x: 6, y: 4 }], territory: { black: [{ x: 6, y: 4 }], white: [] },
  finishedAt: "2026-10-13T12:00:00Z",
};

export function registerSharingReplayTests(mobile = false) {
  test("a public link opens the final score and replays captures, passes and all four controls", async ({ page }, info) => {
    await installHarness(page);
    await page.route(`**/api/shared-games/${TOKEN}`, route => route.fulfill({ json: { ok: true, game: shared } }));
    await page.goto(`/de/shared-game/${TOKEN}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Weiß");
    const controls = page.getByRole("group", { name: "Zugverlauf" });
    const points = page.locator(".intersection");
    await expect(controls).toContainText("Zug 48 / 48");
    await expect(controls.getByRole("button", { name: "Zum Endstand" })).toBeDisabled();
    await expect(points.nth(42).locator(".stone")).toHaveCount(0);
    await expect(points.nth(42).locator(".territory-mark")).toHaveCount(1);
    await controls.getByRole("button", { name: "Vorheriger Zug" }).click();
    await expect(controls).toContainText("Zug 47 / 48");
    await expect(controls).toContainText("Schwarz");
    await expect(points.nth(42).locator(".stone--white")).toHaveCount(1);
    await expect(page.locator(".territory-mark")).toHaveCount(0);
    await controls.getByRole("button", { name: "Zum Anfang" }).click();
    await expect(page.locator(".stone")).toHaveCount(0);
    await expect(controls.getByRole("button", { name: "Vorheriger Zug" })).toBeDisabled();
    await controls.getByRole("button", { name: "Nächster Zug" }).click();
    await expect(controls).toContainText("Zug 1 / 48");
    await expect(page.locator(".stone")).toHaveCount(1);
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowRight");
    await expect(controls).toContainText("Zug 1 / 48");
    for (let index = 1; index < 37; index++) await page.keyboard.press("ArrowRight");
    await expect(points.nth(3).locator(".stone--black")).toHaveCount(1);
    await page.keyboard.press("ArrowRight");
    await expect(controls).toContainText("Zug 38 / 48");
    await expect(points.nth(3).locator(".stone")).toHaveCount(0);
    await page.keyboard.press("ArrowLeft");
    await expect(points.nth(3).locator(".stone--black")).toHaveCount(1);
    await controls.getByRole("button", { name: "Zum Endstand" }).click();
    await expect(controls).toContainText("Zug 48 / 48");
    await expect(points.nth(42).locator(".territory-mark")).toHaveCount(1);
    await expect(points.first()).toBeDisabled();
    await assertNoOverflow(page);
    await page.screenshot({ path: `.cache/shared-replay-${info.project.name}.png`, animations: "disabled" });
  });

  test("a finished game from history offers the same replay after viewing its board", async ({ page }) => {
    const state = await installHarness(page);
    state.game = { ...gameFor(9, "friendly"), board, moves: captureIncidentMoves, moveCount: 48,
      status: "finished", winnerKey: USER.playerKey, result: "B+R", finishReason: "resignation",
      finishedAt: shared.finishedAt, turn: null, version: 48 };
    await page.route("**/api/profile", route => route.fulfill({ json: { ok: true, history: [], recentGames: [{
      gameId: GAME_ID, boardSize: 9, timeControl: "rapid", opponentName: "Friend", opponentIsBot: false,
      result: "win", gameResult: "B+R", ratingChange: null, rated: false, finishedAt: shared.finishedAt,
    }] } }));
    if (mobile) {
      await page.goto("/de/profile");
      await page.locator(".history-game").click();
    } else {
      // The web profile requires a real server session; exercise its game URL.
      await page.goto(`/de/game/${GAME_ID}`);
    }
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Home");
    await page.getByRole("dialog").getByRole("button", { name: "Brett noch einmal ansehen" }).click();
    const controls = page.getByRole("group", { name: "Zugverlauf" });
    await expect(controls).toContainText("Zug 48 / 48");
    await controls.getByRole("button", { name: "Zum Anfang" }).click();
    await expect(page.locator(".stone")).toHaveCount(0);
    await controls.getByRole("button", { name: "Nächster Zug" }).click();
    await expect(page.locator(".stone")).toHaveCount(1);
    await page.keyboard.press("End");
    await expect(controls).toContainText("Zug 48 / 48");
    await assertNoOverflow(page);
    expect(state.moves).toHaveLength(0);
  });

  test("sharing keeps an openable link when native sharing and clipboard are unavailable and reuses it", async ({ page }) => {
    const state = await installHarness(page);
    state.game = { ...gameFor(9, "friendly"), status: "finished", winnerKey: USER.playerKey,
      result: "B+R", finishReason: "resignation", finishedAt: shared.finishedAt, turn: null };
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "share", { configurable: true, value: async () => { throw new DOMException("Activation expired", "NotAllowedError"); } });
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("Clipboard unavailable"); } } });
    });
    let creations = 0;
    await page.route(`**/api/games/${GAME_ID}/share`, route => {
      creations++;
      expect(route.request().headers()["x-gostone-expected-player"]).toBe(USER.playerKey);
      return route.fulfill({ json: { ok: true, path: `/shared-game/${TOKEN}`, url: `https://gostone.app/shared-game/${TOKEN}` } });
    });
    await page.goto(`/de/game/${GAME_ID}`);
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Partie teilen", exact: true }).click();
    await expect(dialog.getByRole("textbox", { name: "Partie teilen" })).toHaveValue(`https://gostone.app/de/shared-game/${TOKEN}`);
    await expect(dialog.getByRole("link", { name: "Partie öffnen" })).toHaveAttribute("href", `https://gostone.app/de/shared-game/${TOKEN}`);
    await dialog.getByRole("button", { name: "Link kopieren" }).click();
    await expect(dialog.getByRole("textbox", { name: "Partie teilen" })).toBeFocused();
    await dialog.getByRole("button", { name: "Partie teilen", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Partie teilen", exact: true })).toBeEnabled();
    expect(creations).toBe(1);
    await assertNoOverflow(page);
  });

  test("unavailable shared games show a clear error", async ({ page }) => {
    await installHarness(page);
    await page.route(`**/api/shared-games/${TOKEN}`, route => route.fulfill({ status: 404, json: { error: "Shared game not found." } }));
    await page.goto(`/de/shared-game/${TOKEN}`);
    await expect(page.getByText("Diese geteilte Partie ist nicht verfügbar.")).toBeVisible();
    await expect(page.locator(".go-board")).toHaveCount(0);
  });
}
