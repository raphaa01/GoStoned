import { expect, test } from "@playwright/test";
import { countedTerritoryPoints, scoreJapaneseTerritory } from "../../lib/game/japaneseScoring";
import { createEmptyBoard } from "../../lib/game/goEngine";
import { GOSTONE_BOT_MODEL } from "../../lib/bot/modelV1";
import { gameFor, GAME_ID, installHarness, USER } from "./boardDesignHarness";

export function registerSettlementTests() {
  for (const theme of ["light", "dark"]) {
    test(`final territory squares show counted eyes, removed dead stones and no dame (${theme})`, async ({ page }, info) => {
      const state = await installHarness(page);
      await page.addInitScript((theme) => {
        localStorage.setItem("gostone.mobile.theme.v1", theme);
        localStorage.setItem("gostone.theme.v1", theme);
      }, theme);
      const board = createEmptyBoard(9);
      for (const [x, y] of [[0, 0], [1, 0], [0, 1], [2, 1], [1, 2]]) board[y][x] = "black";
      for (const [x, y] of [[8, 8], [7, 6], [6, 7], [8, 7], [7, 8]]) board[y][x] = "white";
      board[1][1] = "white";
      const deadStones = [{ x: 1, y: 1 }];
      const score = scoreJapaneseTerritory({ board, deadStones, agreedNeutralRegionSeeds: [],
        prisoners: { capturedBlackByWhite: 0, capturedWhiteByBlack: 0 }, komi: 6.5 });
      const time = new Date().toISOString();
      state.game = { ...gameFor(9, "friendly"), board, status: "finished", phase: "scoring", turn: null,
        ruleset: "japanese", rulesProfile: "japanese-1989-gostone-v1", scoringMethod: "territory", finishReason: "score",
        winnerKey: gameFor(9, "friendly").whitePlayerKey,
        finishedAt: time, result: "W+5.5", scoring: { revision: 1, boardHash: "test", stoppedMoveNumber: 2, deadStones,
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
