import { expect, test } from "@playwright/test";
import { countedTerritoryPoints, scoreJapaneseTerritory } from "../../lib/game/japaneseScoring";
import { boardHash, replayMoves } from "../../lib/game/goEngine";
import type { StoredMove } from "../../lib/game/types";
import { GOSTONE_BOT_MODEL } from "../../lib/bot/modelV1";
import { gameFor, GAME_ID, installHarness, USER } from "./boardDesignHarness";

function settlementPosition() {
  // A dead group still needs a liberty in the stopped position; zero-liberty
  // stones would already have been captured during normal play.
  const black = [[0, 0], [1, 0], [2, 0], [3, 0], [0, 1], [3, 1], [0, 2], [1, 2], [2, 2], [3, 2]];
  const white = [[8, 8], [7, 6], [6, 7], [8, 7], [7, 8], [1, 1]];
  const moves: StoredMove[] = [];
  for (let index = 0; index < black.length; index++) {
    for (const color of ["black", "white"] as const) {
      const point = (color === "black" ? black : white)[index];
      moves.push({ moveNumber: moves.length + 1, color, x: point?.[0] ?? null,
        y: point?.[1] ?? null, isPass: !point, createdAt: "" });
    }
  }
  moves.push({ moveNumber: moves.length + 1, color: "black", x: null, y: null, isPass: true, createdAt: "" });
  return { board: replayMoves(9, moves), moves, moveCount: moves.length, version: moves.length };
}

export function registerSettlementTests() {
  test("two passes show provisional territory before confirmations and dead groups remain editable", async ({ page }, info) => {
    const state = await installHarness(page);
    const position = settlementPosition();
    const { board } = position;
    const deadStones = [{ x: 1, y: 1 }];
    const game = gameFor(9, "friendly");
    state.game = { ...game, ...position, phase: "scoring", turn: null, consecutivePasses: 2,
      ruleset: "japanese", rulesProfile: "japanese-1989-gostone-v1", scoringMethod: "territory",
      scoring: { revision: 1, boardHash: boardHash(board), stoppedMoveNumber: position.moveCount, deadStones,
        blackConfirmed: false, whiteConfirmed: false, finalizedAt: null, expiresAt: null,
        territory: countedTerritoryPoints(board, deadStones),
        preview: { black: 2, white: 8.5, livingBlackStones: 5, livingWhiteStones: 5, blackPrisoners: 1, whitePrisoners: 0,
          blackTerritory: 1, whiteTerritory: 1, neutralPoints: 69, winner: "white", margin: 6.5, result: "W+6.5" } } };
    await page.route(`**/api/games/${GAME_ID}/scoring/dead-stones`, async route => {
      expect(route.request().postDataJSON()).toMatchObject({ x: 1, y: 1, dead: false, expectedRevision: 1 });
      state.game.scoring!.deadStones = [];
      state.game.scoring!.territory = countedTerritoryPoints(board, []);
      state.game.scoring!.revision++;
      state.game.version++;
      await route.fulfill({ json: { ok: true, actor: USER.playerKey, game: state.game } });
    });
    await page.goto(`/de/game/${GAME_ID}`);
    const help = page.getByRole("dialog", { name: "Wenn du mit der Wertung einverstanden bist, bestätige sie" });
    await expect(help.getByRole("heading", { level: 2 })).toBeVisible();
    await expect(help.getByText("Die Partie endet, sobald ihr beide bestätigt habt.")).toBeVisible();
    await expect(help.getByText(/Nicht einverstanden\?/)).toBeVisible();
    if (await page.locator(".mobile-splash").count()) await expect(page.locator(".mobile-splash")).toHaveAttribute("aria-hidden", "true");
    await page.screenshot({ path: `.cache/scoring-help-${info.project.name}.png`, animations: "disabled" });
    await help.getByRole("button", { name: "Verstanden", exact: true }).click();
    await expect(page.locator(".scoring-board-hint")).toHaveCount(0);
    await expect(page.locator(".game-player-detail").filter({ hasText: /Du ·|Gegner ·/ })).toHaveCount(0);
    await expect(page.getByText("Prüfe die markierten Gruppen und die Wertung. Wenn alles stimmt, bestätige unten.")).toHaveCount(0);
    const dead = page.locator(".intersection").nth(10);
    await expect(dead.locator('.stone--white')).toBeVisible();
    await expect(dead.locator('[data-territory="black"]')).toBeVisible();
    const placement = await dead.evaluate(point => {
      const square = point.querySelector<HTMLElement>(".territory-mark")!;
      const cross = point.querySelector<HTMLElement>(".dead-stone-mark")!;
      const stone = point.querySelector<HTMLElement>(".stone")!.getBoundingClientRect();
      const marker = square.getBoundingClientRect();
      return { x: (marker.left + marker.width / 2) - (stone.left + stone.width / 2),
        y: (marker.top + marker.height / 2) - (stone.top + stone.height / 2),
        squareLayer: Number(getComputedStyle(square).zIndex), crossLayer: Number(getComputedStyle(cross).zIndex) };
    });
    expect(Math.abs(placement.x)).toBeLessThan(1);
    expect(Math.abs(placement.y)).toBeLessThan(1);
    expect(placement.squareLayer).toBeGreaterThan(placement.crossLayer);
    await expect(page.locator('[data-territory="white"]')).toHaveCount(1);
    await expect(page.locator(".intersection").nth(40).locator(".territory-mark")).toHaveCount(0);
    await expect(dead).toBeEnabled();
    await expect(dead).toHaveAttribute("aria-label", /lebend/i);
    await page.screenshot({ path: `.cache/scoring-confirm-${info.project.name}.png`, animations: "disabled" });
    await dead.click();
    await expect(dead.locator('.stone--white')).toBeVisible();
    await expect(page.locator('[data-territory="black"]')).toHaveCount(0);
    expect(state.game.scoring!.blackConfirmed).toBe(false);
    expect(state.game.scoring!.whiteConfirmed).toBe(false);
    expect(state.game.result).toBeNull();
  });

  for (const theme of ["light", "dark"]) {
    test(`final territory squares show counted eyes, removed dead stones and no dame (${theme})`, async ({ page }, info) => {
      const state = await installHarness(page);
      await page.addInitScript((theme) => {
        localStorage.setItem("gostone.mobile.theme.v1", theme);
        localStorage.setItem("gostone.theme.v1", theme);
      }, theme);
      const position = settlementPosition();
      const { board } = position;
      const deadStones = [{ x: 1, y: 1 }];
      const score = scoreJapaneseTerritory({ board, deadStones, agreedNeutralRegionSeeds: [],
        prisoners: { capturedBlackByWhite: 0, capturedWhiteByBlack: 0 }, komi: 6.5 });
      const time = new Date().toISOString();
      state.game = { ...gameFor(9, "friendly"), ...position, status: "finished", phase: "scoring", turn: null,
        ruleset: "japanese", rulesProfile: "japanese-1989-gostone-v1", scoringMethod: "territory", finishReason: "score",
        winnerKey: gameFor(9, "friendly").whitePlayerKey,
        finishedAt: time, result: score.outcome.kind === "points" ? `W+${score.outcome.margin}` : "Draw", scoring: { revision: 1, boardHash: boardHash(board), stoppedMoveNumber: position.moveCount, deadStones,
          blackConfirmed: true, whiteConfirmed: true, finalizedAt: time, expiresAt: null,
          territory: countedTerritoryPoints(board, deadStones),
          preview: { black: score.blackTotal, white: score.whiteTotal, livingBlackStones: score.livingBlackStones,
            livingWhiteStones: score.livingWhiteStones, blackTerritory: score.blackTerritory, whiteTerritory: score.whiteTerritory,
            blackPrisoners: score.blackPrisonersFinal, whitePrisoners: score.whitePrisonersFinal,
            neutralPoints: score.damePoints, winner: "white", margin: 5.5, result: "W+5.5" } } };
      await page.goto(`/de/game/${GAME_ID}`);
      await page.getByRole("dialog").getByRole("button", { name: "Brett noch einmal ansehen" }).click();
      await expect(page.locator('[data-territory="black"]')).toHaveCount(score.blackTerritory);
      await expect(page.locator('[data-territory="white"]')).toHaveCount(score.whiteTerritory);
      await expect(page.locator(".intersection").nth(10).locator('.stone')).toHaveCount(0);
      await expect(page.locator(".intersection").nth(10).locator('[data-territory="black"]')).toBeVisible();
      await expect(page.locator(".intersection").nth(40).locator(".territory-mark")).toHaveCount(0);
      await expect(page.locator(".intersection").first().locator(".stone--black")).toBeVisible();
      const cell = await page.locator(".intersection").nth(10).boundingBox();
      const marker = await page.locator('[data-territory="black"]').first().boundingBox();
      expect(marker!.width).toBeGreaterThan(2);
      expect(marker!.width).toBeLessThan(cell!.width * 0.36);
      if (await page.locator(".mobile-splash").count()) await expect(page.locator(".mobile-splash")).toHaveAttribute("aria-hidden", "true");
      await page.screenshot({ path: `.cache/territory-${theme}-${info.project.name}.png`, animations: "disabled" });
    });
  }

  test("bot settlement waits for the full proposal and preserves review progress across reloads", async ({ page }) => {
    const state = await installHarness(page);
    const game = gameFor(9, "bot");
    game.phase = "scoring"; game.turn = null;
    game.ruleset = "japanese"; game.rulesProfile = "japanese-1989-gostone-v1"; game.scoringMethod = "territory";
    game.browserBotModelVersion = GOSTONE_BOT_MODEL.modelVersion;
    game.browserBotModelSha256 = GOSTONE_BOT_MODEL.artifactSha256;
    game.scoring = { revision: 1, boardHash: "stopped", stoppedMoveNumber: 2, deadStones: [],
      blackConfirmed: false, whiteConfirmed: false, preview: { black: 0, white: 6.5, blackStones: 1, whiteStones: 1,
        blackTerritory: 0, whiteTerritory: 0, neutralPoints: 79, winner: "white", margin: 6.5, result: "W+6.5" },
      finalizedAt: null, expiresAt: null, browserBotProposalReady: false };
    state.game = game;
    let proposals = 0;
    await page.addInitScript(() => {
      class SettlementWorker {
        listeners: Record<string, (event: unknown) => void> = {};
        addEventListener(kind: string, listener: (event: unknown) => void) { this.listeners[kind] = listener; }
        postMessage(request: { id: string; kind: string; position: { targetRating: number } }) {
          (window as unknown as { replySettlement: () => void }).replySettlement = () => {
            if (request.position.targetRating !== 2100) throw new Error("Evaluation strength differs");
            this.listeners.message({ data: { id: request.id, ok: true, kind: "settlement", proposal: {
              deadStones: [], neutralRegionSeeds: [], uncertainStones: [{ x: 0, y: 0 }],
            } } });
          };
        }
        terminate() {}
      }
      Object.defineProperty(window, "Worker", { value: SettlementWorker });
    });
    await page.route(`**/api/games/${GAME_ID}/browser-bot`, async (route) => {
      const body = route.request().postDataJSON();
      expect(body.expectedRevision).toBe(state.game.scoring!.revision);
      expect(body.modelVersion).toBe(GOSTONE_BOT_MODEL.modelVersion);
      expect(body.modelSha256).toBe(GOSTONE_BOT_MODEL.artifactSha256);
      expect(route.request().headers()["x-gostone-expected-player"]).toBe(USER.playerKey);
      expect(body.kind).toBe("settlement");
      expect(body.neutralRegionSeeds).toEqual([]);
      expect(body.uncertainStones).toEqual([{ x: 0, y: 0 }]);
      proposals++;
      state.game.scoring!.revision++;
      state.game.version++;
      state.game.scoring!.browserBotProposalReady = true;
      state.game.scoring!.uncertainStones = body.uncertainStones;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, actor: USER.playerKey, game: state.game }) });
    });
    await page.route(`**/api/games/${GAME_ID}/scoring/dead-stones`, async (route) => {
      const body = route.request().postDataJSON();
      expect(body).toMatchObject({ x: 0, y: 0, dead: false, expectedRevision: state.game.scoring!.revision });
      state.game.scoring!.uncertainStones = [];
      state.game.scoring!.revision++; state.game.version++;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, actor: USER.playerKey, game: state.game }) });
    });
    await page.goto(`/de/game/${GAME_ID}`);
    await page.getByRole("dialog").getByRole("button", { name: "Nicht erneut automatisch anzeigen" }).click();
    await expect(page.locator(".scoring-confirm-action")).toBeDisabled();
    await expect.poll(() => page.evaluate(() => typeof (window as unknown as { replySettlement: unknown }).replySettlement)).toBe("function");
    await page.evaluate(() => (window as unknown as { replySettlement: () => void }).replySettlement());
    await expect(page.getByText("Unklare Gruppen prüfen")).toBeVisible();
    await expect(page.locator(".scoring-confirm-action")).toBeDisabled();
    await page.reload();
    await expect(page.getByText("Unklare Gruppen prüfen")).toBeVisible();
    expect(proposals).toBe(1);
    await page.locator(".scoring-uncertain-group").getByRole("button", { name: "Lebend", exact: true }).click();
    await expect(page.locator(".scoring-confirm-action")).toBeEnabled();
    await expect(page.getByText("Unklare Gruppen prüfen")).toHaveCount(0);
    expect(proposals).toBe(1);
  });
}
