import { expect, test, type Page } from "@playwright/test";
import type { AnalysisJobView, GameAnalysisResult, MoveAnalysis } from "../../lib/analysis/types";
import { GAME_ID, USER, gameFor, installHarness } from "./boardDesignHarness";
import { replayMoves } from "../../lib/game/goEngine";
import { captureIncidentMoves } from "../../lib/game/fixtures/captureIncident9x9";
import { toGtpCoordinate } from "../../lib/analysis/coordinates";

async function reviewHarness(page: Page, options: { missing?: boolean; quota?: boolean; failRead?: boolean } = {}) {
  const state = await installHarness(page);
  const time = new Date().toISOString();
  const columns = "ABCDEFGHJKLMNOPQRST";
  const game = gameFor(19, "friendly");
  game.moves = Array.from({ length: 60 }, (_, index) => {
    const color = index % 2 ? "white" as const : "black" as const;
    const n = Math.floor(index / 2);
    return { moveNumber: index + 1, color, x: n % 19, y: color === "black" ? Math.floor(n / 19) * 2 : 18 - Math.floor(n / 19) * 2,
      isPass: false, createdAt: time };
  });
  game.moveCount = 60;
  game.status = "finished";
  game.turn = null;
  game.result = "B+R";
  game.finishReason = "resignation";
  game.winnerKey = USER.playerKey;
  state.game = game;
  const moves: MoveAnalysis[] = game.moves.map((move, index) => ({
    moveNumber: move.moveNumber, color: move.color, playedMove: `${columns[move.x!]}${19 - move.y!}`,
    classification: index === 0 ? "brilliant" : index === 1 ? "blunder" : "good",
    winrateBefore: move.color === "black" ? .99 : .01, winrateAfter: move.color === "black" ? .99 : .01,
    winrateLoss: index === 1 ? .2 : 0, scoreLeadBefore: move.color === "black" ? 20 : -20,
    scoreLeadAfter: move.color === "black" ? 20 : -20, scoreLoss: index === 1 ? 12 : 0,
    bestMove: "S10", alternatives: [], explanation: { en: "KataGo evaluates this move 3 points better.", de: "KataGo bewertet diesen Zug 3 Punkte besser.", fr: "", es: "", zh: "", ja: "", ko: "" },
  }));
  const result: GameAnalysisResult = { contractVersion: 1, gameId: GAME_ID, gameVersion: game.version, boardSize: 19,
    analyzedAt: time, engine: { name: "KataGo", version: "test", model: "test", visitsPerTurn: 32 }, moves,
    summary: { brilliant: 1, great: 0, best: 0, excellent: 0, good: 58, inaccuracy: 0, mistake: 0, blunder: 1 } };
  const fixture: { job: AnalysisJobView } = { job: { id: "review-test", gameId: GAME_ID, gameVersion: game.version,
    status: "completed", attempts: 1, result, createdAt: time, startedAt: time, completedAt: time, errorCode: null } };
  const requests: string[] = [];
  await page.route(`**/api/games/${GAME_ID}/analysis`, route => {
    const method = route.request().method();
    requests.push(method);
    if (method === "GET" && options.failRead) return route.fulfill({ status: 503,
      json: { ok: false, code: "internal_error", error: "Read failed" } });
    if (method === "POST") {
      if (options.quota) return route.fulfill({ status: 429,
        json: { ok: false, code: "analysis_weekly_limit", error: "Weekly limit", retryAfterSeconds: 86400 } });
      options.missing = false;
    }
    return route.fulfill({ json: { ok: true, actor: USER.playerKey, game, analysis: options.missing ? null : fixture.job } });
  });
  return { fixture, result, game, requests };
}

async function fitsViewport(page: Page) {
  const workspace = page.locator(".review-workspace");
  expect(await workspace.evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
  const viewport = page.viewportSize()!;
  for (const selector of ["header", "main", "main > div:last-child", "svg[role=img]"]) {
    const target = workspace.locator(selector);
    if (!await target.count()) continue;
    const box = await target.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(-1);
    expect(box!.y).toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
  }
}

export function registerReviewTests(authenticatedServer = false) {
  if (authenticatedServer) test.beforeEach(async ({ context }) => {
    const registered = await context.request.post("/api/auth/register", { data: {
      username: `review_${crypto.randomUUID().slice(0, 8)}`, password: crypto.randomUUID(),
      email: `${crypto.randomUUID()}@example.test`,
      startingStrength: "unspecified", knownRank: null, boardPlacement: "direct",
    } });
    expect(registered.status()).toBe(201);
  });
  test("opening a new analysis starts once and reopening reuses the saved result", async ({ page }) => {
    const { requests } = await reviewHarness(page, { missing: true });
    await page.goto(`/de/review/${GAME_ID}`);
    await expect(page.locator("[data-review-player]")).toBeVisible();
    expect(requests).toEqual(["GET", "POST"]);
    await expect(page.getByRole("button", { name: "Mit KataGo analysieren", exact: true })).toHaveCount(0);
    await expect(page.getByText(/Die Analyse kann einige Minuten dauern/)).toHaveCount(0);
    await page.reload();
    await expect(page.locator("[data-review-player]")).toBeVisible();
    expect(requests).toEqual(["GET", "POST", "GET"]);
  });
  test("automatic start respects the weekly limit without repeated requests", async ({ page }) => {
    const { requests } = await reviewHarness(page, { missing: true, quota: true });
    await page.goto(`/de/review/${GAME_ID}`);
    await expect(page.getByRole("heading", { name: "Deine Analyse für diese Woche läuft bereits" })).toBeVisible();
    await expect(page.locator("[data-review-player]")).toHaveCount(0);
    expect(requests).toEqual(["GET", "POST"]);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    expect(requests).toEqual(["GET", "POST"]);
  });
  test("a failed initial read starts no analysis until an explicit retry succeeds", async ({ page }) => {
    const options = { missing: true, failRead: true };
    const { requests } = await reviewHarness(page, options);
    await page.goto(`/de/review/${GAME_ID}`);
    await expect.poll(() => requests).toEqual(["GET"]);
    await expect(page.locator(".review-workspace").getByRole("alert")).toBeVisible();
    options.failRead = false;
    await page.getByRole("button", { name: "Erneut versuchen", exact: true }).click();
    await expect(page.locator("[data-review-player]")).toBeVisible();
    expect(requests).toEqual(["GET", "GET", "POST"]);
  });
  test("review preserves the incident's real stones and distinguishes an unplayed recommendation", async ({ page }) => {
    const { fixture, result, game } = await reviewHarness(page);
    Object.assign(game, { boardSize: 9, moveCount: 48, moves: captureIncidentMoves,
      board: replayMoves(9, captureIncidentMoves), result: "B+2.5" });
    fixture.job.result = { ...result, boardSize: 9, moves: captureIncidentMoves.map((move, index) => ({
      ...result.moves[index], playedMove: toGtpCoordinate(9, move),
      bestMove: move.moveNumber === 38 ? "D9" : toGtpCoordinate(9, move),
    })) };
    await page.goto(`/de/review/${GAME_ID}`);
    const player = page.locator("[data-review-player]");
    const timeline = player.getByRole("navigation").getByRole("button");
    await expect(timeline).toHaveCount(48);
    await timeline.nth(36).click();
    await expect(player.locator('[data-review-stone="3:0"]')).toHaveCount(1);
    await timeline.nth(37).click();
    await expect(player.locator('[data-review-stone="3:0"]')).toHaveCount(0);
    await expect(player.locator('[data-review-stone="2:0"]')).toHaveCount(1);
    await expect(player).toContainText("C9 schlägt einen Stein.");
    await expect(player).toContainText("Bester Zug: D9");
    const recommendation = player.locator('[data-review-marker="recommendation"]');
    await expect(recommendation.locator("title")).toHaveText("Bester Zug: D9");
    expect(await recommendation.evaluate(element => getComputedStyle(element).fill)).toBe("none");
    await timeline.nth(39).click();
    await expect(player.locator('[data-review-stone="3:0"]')).toHaveCount(1);
    await timeline.nth(47).click();
    await expect(player.locator('[data-review-stone]')).toHaveCount(45);
  });
  test("minimal review fits phones, landscape and desktop; summary and back return to the previous screen", async ({ page }, info) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await reviewHarness(page);
    await page.goto("/de/profile");
    await page.goto(`/de/review/${GAME_ID}`);
    const player = page.locator("[data-review-player]");
    await expect(player).toBeVisible();
    const timeline = player.getByRole("navigation");
    await expect(timeline.getByRole("button")).toHaveCount(60);
    await expect(timeline).not.toContainText(/Brillant|Patzer|Gut/);
    await expect(player).not.toContainText(/KataGo bewertet|3 Punkte/);
    await expect(player.locator("section").first()).toContainText("Schwarz 99%");
    await expect(player.locator("section").first()).toContainText("Weiß 1%");
    await expect(player.locator('circle[class*="playedMarker"]')).toHaveCount(1);
    await expect(player.locator('circle[class*="bestMarker"]')).toHaveCount(1);
    await player.getByRole("button", { name: "Nächste", exact: true }).click();
    await expect(timeline.locator('[aria-current="step"]')).toContainText("2.");
    await expect(player.locator("section").first()).toContainText("Schwarz 99%");
    await player.getByRole("button", { name: "Vorheriger Zug", exact: true }).click();
    await expect(timeline.locator('[aria-current="step"]')).toContainText("1.");
    await player.getByRole("button", { name: "Zum Anfang", exact: true }).click();
    await expect(player).toContainText("Startposition");
    await expect(player.locator('circle[class*="playedMarker"]')).toHaveCount(0);
    await player.getByRole("button", { name: "Nächste", exact: true }).click();
    for (const viewport of [page.viewportSize()!, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport);
      await fitsViewport(page);
    }
    await page.setViewportSize(info.project.use.viewport!);
    await page.screenshot({ path: `.cache/review-${info.project.name}.png`, animations: "disabled" });
    await player.getByRole("button", { name: "Zum Ende", exact: true }).click();
    await expect(timeline.locator('[aria-current="step"]')).toContainText("60.");
    await player.getByRole("button", { name: "Fertig", exact: true }).click();
    const summary = page.locator("[data-review-summary]");
    await expect(summary).toContainText("Skin Player");
    await expect(summary).toContainText("Friend");
    await expect(summary.getByText("Gewonnen", { exact: true })).toHaveCount(1);
    await expect(summary.getByText("Genauigkeit", { exact: true })).toHaveCount(2);
    await expect(summary.locator('article').first()).toContainText("100.0");
    await expect(summary.locator('[class*="brilliant"]')).toHaveText("1Brillant0");
    for (const viewport of [page.viewportSize()!, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport);
      await fitsViewport(page);
    }
    await page.setViewportSize(info.project.use.viewport!);
    await page.screenshot({ path: `.cache/review-summary-${info.project.name}.png`, animations: "disabled" });
    await summary.getByRole("button", { name: "Zur Analyse", exact: true }).click();
    await expect(timeline.locator('[aria-current="step"]')).toContainText("60.");
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "dark";
      document.documentElement.dataset.mobileTheme = "dark";
    });
    await fitsViewport(page);
    await page.screenshot({ path: `.cache/review-dark-${info.project.name}.png`, animations: "disabled" });
    await player.getByRole("button", { name: "Fertig", exact: true }).click();
    await fitsViewport(page);
    await page.screenshot({ path: `.cache/review-summary-dark-${info.project.name}.png`, animations: "disabled" });
    await summary.getByRole("button", { name: "Fertig", exact: true }).click();
    await expect(page).toHaveURL(/\/de\/profile$/);
    await page.goto(`/de/review/${GAME_ID}`);
    await expect(player).toBeVisible();
    await page.locator(".review-workspace header").getByRole("button", { name: "Zurück", exact: true }).click();
    await expect(page).toHaveURL(/\/de\/profile$/);
    await expect(summary).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("the board stays fixed for absent, single-line and wrapped move comments", async ({ page }) => {
    const { fixture, result, game } = await reviewHarness(page);
    Object.assign(game, { boardSize: 9, moveCount: 48, moves: captureIncidentMoves,
      board: replayMoves(9, captureIncidentMoves) });
    fixture.job.result = { ...result, boardSize: 9, moves: captureIncidentMoves.map((move, index) => ({
      ...result.moves[index], playedMove: toGtpCoordinate(9, move), bestMove: toGtpCoordinate(9, move),
    })) };
    await page.goto(`/de/review/${GAME_ID}`);
    const player = page.locator("[data-review-player]");
    const board = player.locator("svg[role=img]");
    const assessment = player.locator('section[aria-live="polite"]');
    await expect(board).toBeVisible();
    await player.getByRole("button", { name: "Zum Anfang", exact: true }).click();
    for (const viewport of [page.viewportSize()!, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport);
      await expect(assessment.locator("p")).toHaveCount(0);
      const initial = await board.boundingBox();
      await player.getByRole("navigation").getByRole("button").nth(37).click();
      await expect(assessment.locator("p")).toHaveText("C9 schlägt einen Stein.");
      expect(await board.boundingBox()).toEqual(initial);
      await assessment.locator("p").evaluate(element => {
        element.textContent = "Dieser Zug verbindet getrennte Gruppen und rettet die angegriffenen Steine am Rand des Bretts.";
      });
      expect(await board.boundingBox()).toEqual(initial);
      await player.getByRole("button", { name: "Zum Anfang", exact: true }).click();
      expect(await board.boundingBox()).toEqual(initial);
      await fitsViewport(page);
    }
  });

  test("a ten-move preview remains navigable while later results arrive, with a preliminary summary", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const { fixture, result } = await reviewHarness(page);
    fixture.job = { ...fixture.job, status: "running", completedAt: null,
      result: { ...result, moves: result.moves.slice(0, 10).map(move => ({ ...move, provisional: true })) },
      progress: { phase: "preview", completedMoves: 10, refinedMoves: 0, totalMoves: 60 } };
    await page.goto(`/de/review/${GAME_ID}`);
    const player = page.locator("[data-review-player]");
    await expect(player.getByRole("navigation").getByRole("button")).toHaveCount(10);
    await player.getByRole("button", { name: "Zum Ende", exact: true }).click();
    await player.getByRole("button", { name: "Fertig", exact: true }).click();
    await expect(page.locator("[data-review-summary]")).toContainText("Vorläufig · 10 von 60 Zügen");
    fixture.job = { ...fixture.job, status: "completed", result, completedAt: new Date().toISOString() };
    await page.getByRole("button", { name: "Zur Analyse", exact: true }).click();
    await expect(player.getByRole("navigation").getByRole("button")).toHaveCount(60);
    await expect(player.locator('[aria-current="step"]')).toContainText("10.");
    await player.getByRole("button", { name: "Zum Ende", exact: true }).click();
    await player.getByRole("button", { name: "Fertig", exact: true }).click();
    await expect(page.locator("[data-review-summary]")).not.toContainText("Vorläufig");
    expect(errors).toEqual([]);
  });
}
