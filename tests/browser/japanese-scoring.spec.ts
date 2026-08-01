import {
  expect,
  test,
  type Locator,
  type Page,
  type Request,
  type Route,
} from "@playwright/test";
import { toggleDeadGroup } from "../../lib/game/scoring";
import type { GameState, Position, Stone, StoredMove } from "../../lib/game/types";
import { de } from "../../lib/i18n/catalogs/de";
import { en } from "../../lib/i18n/catalogs/en";

const ORIGIN = "http://127.0.0.1:3100";
const EXPECTED_PLAYER_HEADER = "x-gostone-expected-player";
const PLAYER_KEY = "guest:44444444-4444-4444-8444-444444444444";
const OPPONENT_KEY = "guest:55555555-5555-4555-8555-555555555555";
const GAME_ID = "66666666-6666-4666-8666-666666666666";
const BLACK_GROUP = [{ x: 2, y: 2 }, { x: 3, y: 2 }] as const;
const WHITE_GROUP = [{ x: 14, y: 15 }, { x: 15, y: 15 }] as const;
const dictionaries = { en, de } as const;

type JapaneseScenario =
  | "play"
  | "scoring-pending"
  | "scoring-ready"
  | "scoring-unavailable"
  | "scoring-final"
  | "scoring-expired";
type DeadlineOutcome = "adjudication" | "abandonment" | "no-result";

type JapaneseHarness = {
  contractErrors: string[];
  deadlineBodies: unknown[];
  diagnostics: string[];
  gameReadCount: () => number;
  matchmakingBodies: unknown[];
  moveBodies: unknown[];
  opponentPass: () => void;
  resetBodies: unknown[];
  resetScenario: (scenario: JapaneseScenario) => void;
  resumeBodies: unknown[];
  scoringBodies: { confirm: unknown[]; deadStones: unknown[]; undo: unknown[] };
  setDeadlineOutcome: (outcome: DeadlineOutcome) => void;
  setSuggestionStatus: (status: "pending" | "ready" | "unavailable") => void;
  sgfRequests: () => number;
};

function blankBoard(): GameState["board"] {
  return Array.from({ length: 19 }, () => Array<null>(19).fill(null));
}

function clock(serverNow = "2026-01-01T00:00:01.000Z"): GameState["clock"] {
  return {
    serverNow,
    mainTimeSeconds: 600,
    byoYomiPeriods: 5,
    byoYomiSeconds: 30,
    black: {
      mainTimeMs: 600_000,
      periodsRemaining: 5,
      displayTimeMs: 600_000,
      phase: "main",
    },
    white: {
      mainTimeMs: 600_000,
      periodsRemaining: 5,
      displayTimeMs: 600_000,
      phase: "main",
    },
  };
}

function japanesePreview(game: Pick<GameState, "board">, deadStones: Position[]) {
  const dead = new Set(deadStones.map(({ x, y }) => `${x}:${y}`));
  let blackDead = 0;
  let whiteDead = 0;
  for (const key of dead) {
    const [x, y] = key.split(":").map(Number);
    if (game.board[y][x] === "black") blackDead += 1;
    if (game.board[y][x] === "white") whiteDead += 1;
  }
  const blackTerritory = 18;
  const whiteTerritory = 16;
  const blackPrisoners = 2 + whiteDead;
  const whitePrisoners = 1 + blackDead;
  const black = blackTerritory + blackPrisoners;
  const white = whiteTerritory + whitePrisoners + 6.5;
  return {
    black,
    white,
    blackStones: BLACK_GROUP.length - blackDead,
    whiteStones: WHITE_GROUP.length - whiteDead,
    blackTerritory,
    whiteTerritory,
    neutralPoints: 319,
    territoryExcludedByAgreement: 0,
    blackPrisoners,
    whitePrisoners,
    winner: white > black ? "white" as const : "black" as const,
    margin: Math.abs(white - black),
    result: `${white > black ? "W" : "B"}+${Math.abs(white - black)}`,
  };
}

function seededJapaneseGame(): GameState {
  const board = blankBoard();
  for (const stone of BLACK_GROUP) board[stone.y][stone.x] = "black";
  for (const stone of WHITE_GROUP) board[stone.y][stone.x] = "white";
  const moves: StoredMove[] = [
    { moveNumber: 1, color: "black", x: 2, y: 2, isPass: false, createdAt: "2026-01-01T00:00:02.000Z" },
    { moveNumber: 2, color: "white", x: 14, y: 15, isPass: false, createdAt: "2026-01-01T00:00:03.000Z" },
    { moveNumber: 3, color: "black", x: 3, y: 2, isPass: false, createdAt: "2026-01-01T00:00:04.000Z" },
    { moveNumber: 4, color: "white", x: 15, y: 15, isPass: false, createdAt: "2026-01-01T00:00:05.000Z" },
  ];
  return {
    id: GAME_ID,
    boardSize: 19,
    blackPlayerKey: PLAYER_KEY,
    whitePlayerKey: OPPONENT_KEY,
    blackPlayerName: "Japanese E2E",
    whitePlayerName: "Opponent E2E",
    winnerKey: null,
    rated: false,
    status: "active",
    phase: "play",
    result: null,
    finishReason: null,
    komi: 6.5,
    ruleset: "japanese",
    rulesProfile: "japanese-1989-gostone-v1",
    scoringMethod: "territory",
    handicap: 0,
    consecutivePasses: 0,
    scoringRevision: 0,
    scoring: null,
    lastResume: null,
    version: moves.length,
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: null,
    timeControl: "rapid",
    clock: clock(),
    turn: "black",
    moveCount: moves.length,
    board,
    moves,
  };
}

function positions(value: readonly Position[]): Position[] {
  return value.map(({ x, y }) => ({ x, y }));
}

function samePositions(left: readonly Position[], right: readonly Position[]): boolean {
  const keys = (value: readonly Position[]) => value.map(({ x, y }) => `${x}:${y}`).sort();
  return JSON.stringify(keys(left)) === JSON.stringify(keys(right));
}

function enterScoring(
  game: GameState,
  status: "pending" | "ready" | "unavailable" = "ready",
  options: { expired?: boolean; finalResolution?: boolean } = {},
): GameState {
  const deadStones = status === "ready" ? positions(WHITE_GROUP) : [];
  const revision = game.scoringRevision + 1;
  return {
    ...game,
    consecutivePasses: 2,
    phase: "scoring",
    scoringRevision: revision,
    turn: null,
    version: game.version + 1,
    scoring: {
      revision,
      boardHash: "japanese-browser-stopped-board",
      stoppedMoveNumber: game.moveCount,
      deadStones,
      blackConfirmed: false,
      whiteConfirmed: false,
      preview: japanesePreview(game, deadStones),
      finalizedAt: null,
      expiresAt: options.expired
        ? "2026-01-01T00:00:00.000Z"
        : "2099-01-01T00:10:00.000Z",
      proposalHash: "japanese-browser-suggestion",
      neutralRegionSeeds: [],
      resumptionsUsed: options.finalResolution ? 2 : 1,
      resumptionsRemaining: options.finalResolution ? 0 : 1,
      finalResolution: options.finalResolution ?? false,
      blackParticipated: false,
      whiteParticipated: false,
      canUndo: false,
      canResetToSuggestion: false,
      suggestion: {
        status,
        transparentRole: "suggestion",
        providerKind: status === "ready" ? "deterministic" : null,
        engineVersion: status === "ready" ? "browser-engine" : null,
        modelVersion: status === "ready" ? "browser-model" : null,
        configVersion: status === "ready" ? "browser-config" : null,
        confidencePolicyVersion: status === "ready" ? "browser-confidence" : null,
      },
    },
  };
}

function gameForScenario(scenario: JapaneseScenario): GameState {
  const game = seededJapaneseGame();
  if (scenario === "play") return game;
  if (scenario === "scoring-pending") return enterScoring(game, "pending");
  if (scenario === "scoring-unavailable") return enterScoring(game, "unavailable");
  if (scenario === "scoring-final") {
    return enterScoring(game, "ready", { finalResolution: true });
  }
  if (scenario === "scoring-expired") {
    return enterScoring(game, "ready", { expired: true, finalResolution: true });
  }
  return enterScoring(game);
}

function exactQuery(url: URL, expected: Record<string, string>): boolean {
  const actual = Array.from(url.searchParams.entries()).sort();
  const wanted = Object.entries(expected).sort();
  return JSON.stringify(actual) === JSON.stringify(wanted);
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    body: JSON.stringify(body),
    contentType: "application/json; charset=utf-8",
    headers: { "Cache-Control": "no-store" },
    status,
  });
}

function requestName(request: Request): string {
  const url = new URL(request.url());
  return `${request.method()} ${url.pathname}${url.search}`;
}

function hasExactKeys(body: Record<string, unknown>, expected: string[]): boolean {
  return JSON.stringify(Object.keys(body).sort()) === JSON.stringify([...expected].sort());
}

async function installJapaneseHarness(
  page: Page,
  initialScenario: JapaneseScenario = "play",
): Promise<JapaneseHarness> {
  let game = gameForScenario(initialScenario);
  let matched = false;
  let clockTick = 1;
  let readCount = 0;
  let sgfRequestCount = 0;
  let deadlineOutcome: DeadlineOutcome = "adjudication";
  let proposalHistory: Position[][] = [];
  const diagnostics: string[] = [];
  const contractErrors: string[] = [];
  const matchmakingBodies: unknown[] = [];
  const moveBodies: unknown[] = [];
  const deadStoneBodies: unknown[] = [];
  const confirmBodies: unknown[] = [];
  const undoBodies: unknown[] = [];
  const resetBodies: unknown[] = [];
  const resumeBodies: unknown[] = [];
  const deadlineBodies: unknown[] = [];

  const tickClock = () => {
    clockTick += 1;
    game.clock = {
      ...game.clock,
      serverNow: new Date(Date.UTC(2026, 0, 1, 0, 0, clockTick)).toISOString(),
    };
  };

  const updateProposal = (deadStones: Position[], remember = true) => {
    if (!game.scoring) throw new Error("Japanese proposal update requires scoring.");
    if (remember) proposalHistory.push(positions(game.scoring.deadStones));
    const revision = game.scoring.revision + 1;
    const originalSuggestion = positions(WHITE_GROUP);
    game = {
      ...game,
      scoringRevision: revision,
      version: game.version + 1,
      scoring: {
        ...game.scoring,
        revision,
        deadStones: positions(deadStones),
        blackConfirmed: false,
        whiteConfirmed: false,
        blackParticipated: true,
        canUndo: proposalHistory.length > 0,
        canResetToSuggestion: !samePositions(deadStones, originalSuggestion),
        preview: japanesePreview(game, deadStones),
      },
    };
    tickClock();
  };

  const appendPass = (color: Stone) => {
    const moveNumber = game.moveCount + 1;
    game = {
      ...game,
      moves: [...game.moves, {
        moveNumber,
        color,
        x: null,
        y: null,
        isPass: true,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, moveNumber + 1)).toISOString(),
      }],
      moveCount: moveNumber,
      consecutivePasses: game.consecutivePasses + 1,
      turn: color === "black" ? "white" : "black",
      version: game.version + 1,
    };
    if (game.consecutivePasses === 2) game = enterScoring(game, "ready");
    tickClock();
  };

  const finishDeadline = () => {
    const result = deadlineOutcome === "adjudication"
      ? "W+2.5"
      : deadlineOutcome === "abandonment"
        ? "B+F"
        : "Void";
    const finishReason = deadlineOutcome === "adjudication"
      ? "japanese_adjudication" as const
      : deadlineOutcome === "abandonment"
        ? "japanese_abandonment" as const
        : "japanese_no_result" as const;
    game = {
      ...game,
      status: "finished",
      phase: "play",
      scoring: null,
      turn: null,
      finishReason,
      result,
      winnerKey: deadlineOutcome === "adjudication"
        ? OPPONENT_KEY
        : deadlineOutcome === "abandonment"
          ? PLAYER_KEY
          : null,
      finishedAt: "2026-01-01T00:01:00.000Z",
      version: game.version + 1,
    };
    tickClock();
  };

  const harness: JapaneseHarness = {
    contractErrors,
    deadlineBodies,
    diagnostics,
    gameReadCount: () => readCount,
    matchmakingBodies,
    moveBodies,
    opponentPass() {
      if (game.phase !== "play" || game.turn !== "white") {
        throw new Error("The Japanese browser opponent can pass only on White's turn.");
      }
      appendPass("white");
    },
    resetBodies,
    resetScenario(scenario) {
      game = gameForScenario(scenario);
      proposalHistory = [];
      clockTick += 10;
      tickClock();
    },
    resumeBodies,
    scoringBodies: { confirm: confirmBodies, deadStones: deadStoneBodies, undo: undoBodies },
    setDeadlineOutcome(outcome) {
      deadlineOutcome = outcome;
    },
    setSuggestionStatus(status) {
      if (!game.scoring) throw new Error("Suggestion status requires scoring.");
      game = {
        ...game,
        version: game.version + 1,
        scoring: {
          ...game.scoring,
          deadStones: status === "ready" ? positions(WHITE_GROUP) : [],
          preview: japanesePreview(game, status === "ready" ? positions(WHITE_GROUP) : []),
          suggestion: {
            ...game.scoring.suggestion!,
            status,
            providerKind: status === "ready" ? "deterministic" : null,
          },
        },
      };
      tickClock();
    },
    sgfRequests: () => sgfRequestCount,
  };

  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) {
      diagnostics.push(`console: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => diagnostics.push(`page: ${error.message}`));
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    if (
      request.method() === "GET"
      && url.origin === ORIGIN
      && url.searchParams.has("_rsc")
      && request.failure()?.errorText === "net::ERR_ABORTED"
    ) {
      return;
    }
    diagnostics.push(`request: ${requestName(request)} ${request.failure()?.errorText ?? "failed"}`);
  });
  await page.routeWebSocket(/.*/, async (socket) => {
    diagnostics.push(`websocket: ${socket.url()}`);
    await socket.close({ code: 1008, reason: "Japanese browser tests are HTTP-only." });
  });

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== ORIGIN) {
      diagnostics.push(`external: ${request.url()}`);
      await route.abort("blockedbyclient");
      return;
    }
    if (url.origin !== ORIGIN || !url.pathname.startsWith("/api/")) {
      await route.continue();
      return;
    }

    const method = request.method();
    const expectedPlayer = () => {
      if (request.headers()[EXPECTED_PLAYER_HEADER] !== PLAYER_KEY) {
        contractErrors.push(`${requestName(request)} omitted the displayed player binding`);
      }
    };
    const expectedJson = () => {
      if (request.headers()["content-type"]?.split(";", 1)[0] !== "application/json") {
        contractErrors.push(`${requestName(request)} omitted JSON content type`);
      }
    };

    if (method === "GET" && url.pathname === "/api/auth/session" && exactQuery(url, {})) {
      await fulfillJson(route, { ok: true, user: null });
      return;
    }
    if (method === "POST" && url.pathname === "/api/auth/guest" && exactQuery(url, {})) {
      expectedJson();
      await fulfillJson(route, {
        ok: true,
        identity: { playerKey: PLAYER_KEY, displayName: "Japanese E2E" },
      }, 201);
      return;
    }
    if (url.pathname === "/api/matchmaking" && exactQuery(url, {})) {
      expectedPlayer();
      if (method === "GET") {
        await fulfillJson(route, {
          ok: true,
          actor: PLAYER_KEY,
          matchmaking: matched
            ? { status: "matched", gameId: GAME_ID, boardSize: 19, timeControl: "rapid" }
            : { status: "idle", gameId: null, boardSize: null, timeControl: null },
        });
        return;
      }
      if (method === "POST") {
        expectedJson();
        const body = request.postDataJSON();
        matchmakingBodies.push(body);
        matched = true;
        await fulfillJson(route, {
          ok: true,
          actor: PLAYER_KEY,
          matchmaking: { status: "matched", gameId: GAME_ID, boardSize: 19, timeControl: "rapid" },
        });
        return;
      }
    }
    if (method === "GET" && url.pathname === `/api/games/${GAME_ID}`) {
      const knownVersion = url.searchParams.get("knownVersion");
      if (exactQuery(url, {}) || (knownVersion !== null && exactQuery(url, { knownVersion }))) {
        expectedPlayer();
        readCount += 1;
        tickClock();
        await fulfillJson(route, { ok: true, game });
        return;
      }
    }
    if (
      method === "GET"
      && url.pathname === `/api/games/${GAME_ID}/chat`
      && url.searchParams.get("after") !== null
      && exactQuery(url, { after: url.searchParams.get("after")! })
    ) {
      expectedPlayer();
      await fulfillJson(route, { ok: true, available: true, messages: [] });
      return;
    }
    if (method === "GET" && url.pathname === `/api/games/${GAME_ID}/block` && exactQuery(url, {})) {
      expectedPlayer();
      await fulfillJson(route, { ok: true, actor: PLAYER_KEY, blocked: false });
      return;
    }
    if (method === "POST" && url.pathname === `/api/games/${GAME_ID}/moves` && exactQuery(url, {})) {
      expectedPlayer();
      expectedJson();
      const body = request.postDataJSON() as Record<string, unknown>;
      moveBodies.push(body);
      if (
        !hasExactKeys(body, ["expectedVersion", "isPass"])
        || body.expectedVersion !== game.version
        || body.isPass !== true
      ) {
        contractErrors.push(`${requestName(request)} sent ${JSON.stringify(body)}`);
      } else {
        appendPass("black");
      }
      await fulfillJson(route, { ok: true, actor: PLAYER_KEY, game });
      return;
    }
    if (method === "POST" && url.pathname === `/api/games/${GAME_ID}/scoring/dead-stones` && exactQuery(url, {})) {
      expectedPlayer();
      expectedJson();
      const body = request.postDataJSON() as Record<string, unknown>;
      deadStoneBodies.push(body);
      if (
        !hasExactKeys(body, ["dead", "expectedRevision", "x", "y"])
        || body.expectedRevision !== game.scoring?.revision
        || typeof body.dead !== "boolean"
        || !Number.isInteger(body.x)
        || !Number.isInteger(body.y)
      ) {
        contractErrors.push(`${requestName(request)} sent ${JSON.stringify(body)}`);
      } else if (game.scoring) {
        const toggled = toggleDeadGroup(game.board, game.scoring.deadStones, {
          x: body.x as number,
          y: body.y as number,
        }, body.dead);
        if (toggled.changed) updateProposal(toggled.deadStones);
      }
      await fulfillJson(route, { ok: true, actor: PLAYER_KEY, game });
      return;
    }
    if (method === "POST" && url.pathname === `/api/games/${GAME_ID}/scoring/confirm` && exactQuery(url, {})) {
      expectedPlayer();
      expectedJson();
      const body = request.postDataJSON() as Record<string, unknown>;
      confirmBodies.push(body);
      if (
        !hasExactKeys(body, ["expectedRevision"])
        || body.expectedRevision !== game.scoring?.revision
        || !game.scoring
      ) {
        contractErrors.push(`${requestName(request)} sent ${JSON.stringify(body)}`);
      } else {
        game = {
          ...game,
          version: game.version + 1,
          scoring: { ...game.scoring, blackConfirmed: true, blackParticipated: true },
        };
        tickClock();
      }
      await fulfillJson(route, { ok: true, actor: PLAYER_KEY, game });
      return;
    }
    if (method === "POST" && url.pathname === `/api/games/${GAME_ID}/scoring/undo` && exactQuery(url, {})) {
      expectedPlayer();
      expectedJson();
      const body = request.postDataJSON() as Record<string, unknown>;
      undoBodies.push(body);
      const previous = proposalHistory.pop();
      if (
        !hasExactKeys(body, ["expectedRevision"])
        || body.expectedRevision !== game.scoring?.revision
        || !previous
      ) {
        contractErrors.push(`${requestName(request)} sent ${JSON.stringify(body)}`);
      } else {
        updateProposal(previous, false);
      }
      await fulfillJson(route, { ok: true, actor: PLAYER_KEY, game });
      return;
    }
    if (method === "POST" && url.pathname === `/api/games/${GAME_ID}/scoring/reset` && exactQuery(url, {})) {
      expectedPlayer();
      expectedJson();
      const body = request.postDataJSON() as Record<string, unknown>;
      resetBodies.push(body);
      if (
        !hasExactKeys(body, ["expectedRevision"])
        || body.expectedRevision !== game.scoring?.revision
        || !game.scoring
      ) {
        contractErrors.push(`${requestName(request)} sent ${JSON.stringify(body)}`);
      } else {
        updateProposal(positions(WHITE_GROUP));
      }
      await fulfillJson(route, { ok: true, actor: PLAYER_KEY, game });
      return;
    }
    if (method === "POST" && url.pathname === `/api/games/${GAME_ID}/scoring/resume` && exactQuery(url, {})) {
      expectedPlayer();
      expectedJson();
      const body = request.postDataJSON() as Record<string, unknown>;
      resumeBodies.push(body);
      if (
        !hasExactKeys(body, ["expectedRevision"])
        || body.expectedRevision !== game.scoring?.revision
        || !game.scoring
      ) {
        contractErrors.push(`${requestName(request)} sent ${JSON.stringify(body)}`);
      } else {
        game = {
          ...game,
          phase: "play",
          turn: "white",
          consecutivePasses: 0,
          scoring: null,
          scoringRevision: game.scoring.revision + 1,
          lastResume: { claim: "resume", requestedBy: "black", disputedStone: null },
          version: game.version + 1,
        };
        tickClock();
      }
      await fulfillJson(route, { ok: true, actor: PLAYER_KEY, game });
      return;
    }
    if (method === "POST" && url.pathname === `/api/games/${GAME_ID}/scoring/resolve-deadline` && exactQuery(url, {})) {
      expectedPlayer();
      expectedJson();
      const body = request.postDataJSON() as Record<string, unknown>;
      deadlineBodies.push(body);
      if (
        !hasExactKeys(body, ["expectedRevision"])
        || body.expectedRevision !== game.scoring?.revision
        || !game.scoring
      ) {
        contractErrors.push(`${requestName(request)} sent ${JSON.stringify(body)}`);
      } else {
        finishDeadline();
      }
      await fulfillJson(route, { ok: true, actor: PLAYER_KEY, game });
      return;
    }
    if (method === "GET" && url.pathname === `/api/games/${GAME_ID}/sgf` && exactQuery(url, {})) {
      expectedPlayer();
      sgfRequestCount += 1;
      await route.fulfill({
        body: "(;FF[4]GM[1]SZ[19]RU[Japanese]KM[6.5]RE[W+2.5])",
        contentType: "application/x-go-sgf; charset=utf-8",
        headers: { "Cache-Control": "private, no-store" },
        status: 200,
      });
      return;
    }

    diagnostics.push(`unexpected: ${requestName(request)}`);
    await fulfillJson(route, { ok: false, code: "unexpected_japanese_browser_api" }, 501);
  });

  return harness;
}

async function expectNoDocumentOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => ({
    body: document.body.scrollWidth - document.body.clientWidth,
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }))).toEqual({ body: 0, document: 0 });
}

async function activateGroup(cell: Locator, touch: boolean) {
  await cell.scrollIntoViewIfNeeded();
  if (touch) await cell.tap();
  else {
    await cell.focus();
    await cell.press("Enter");
  }
}

async function expectCleanHarness(harness: JapaneseHarness) {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(harness.contractErrors, "Japanese API contract errors").toEqual([]);
  expect(harness.diagnostics, "Japanese browser diagnostics").toEqual([]);
}

for (const locale of ["en", "de"] as const) {
  test(`${locale.toUpperCase()} Japanese scoring journey works at every configured width`, async ({ page }, testInfo) => {
    const harness = await installJapaneseHarness(page);
    const copy = dictionaries[locale].game;
    const path = locale === "en" ? `/game/${GAME_ID}` : `/de/game/${GAME_ID}`;
    const touch = testInfo.project.name.endsWith("-touch");

    await page.goto(path);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    const pass = page.getByRole("button", { name: copy.pass, exact: true });
    await expect(pass).toBeEnabled();
    await pass.click();
    expect(harness.moveBodies).toEqual([{ isPass: true, expectedVersion: 4 }]);

    harness.opponentPass();
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.getByText(copy.japaneseScoringTitle, { exact: true })).toBeVisible();
    await expect(page.getByText(copy.suggestionReady, { exact: true })).toBeVisible();
    await expect(page.getByLabel(copy.provisionalJapaneseScore)).toBeVisible();
    await expect(page.getByText(copy.decisionTimeRemaining, { exact: true })).toBeVisible();
    await expectNoDocumentOverflow(page);

    const grid = page.getByRole("grid", { name: /19 × 19/ });
    const markBlack = new RegExp(copy.markGroupLabel
      .replace("{group}", copy.blackGroup)
      .replace("{coordinate}", "C17")
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    let blackCell = grid.getByRole("gridcell", { name: markBlack }).first();
    await activateGroup(blackCell, touch);
    await expect(grid.getByRole("gridcell", { selected: true })).toHaveCount(4);
    expect(harness.scoringBodies.deadStones.at(-1)).toEqual({
      dead: true,
      expectedRevision: 1,
      x: 2,
      y: 2,
    });

    const restoreBlack = new RegExp(copy.restoreGroupLabel
      .replace("{group}", copy.blackGroup)
      .replace("{coordinate}", "C17")
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    blackCell = grid.getByRole("gridcell", { name: restoreBlack }).first();
    await activateGroup(blackCell, touch);
    await expect(grid.getByRole("gridcell", { selected: true })).toHaveCount(2);

    blackCell = grid.getByRole("gridcell", { name: markBlack }).first();
    await activateGroup(blackCell, touch);
    await expect(grid.getByRole("gridcell", { selected: true })).toHaveCount(4);

    const confirm = page.getByRole("button", { name: copy.confirmScore, exact: true });
    await confirm.scrollIntoViewIfNeeded();
    await confirm.click();
    await expect(page.getByRole("button", { name: copy.confirmed, exact: true })).toBeDisabled();

    blackCell = grid.getByRole("gridcell", { name: restoreBlack }).first();
    await activateGroup(blackCell, touch);
    await expect(page.getByText(copy.notConfirmed, { exact: true }).first()).toBeVisible();

    const undo = page.getByRole("button", { name: copy.undoScoringChange, exact: true });
    await undo.scrollIntoViewIfNeeded();
    await undo.click();
    await expect(grid.getByRole("gridcell", { selected: true })).toHaveCount(4);
    expect(harness.scoringBodies.undo.at(-1)).toEqual({ expectedRevision: 5 });

    const reset = page.getByRole("button", { name: copy.resetToSuggestion, exact: true });
    await reset.click();
    await expect(grid.getByRole("gridcell", { selected: true })).toHaveCount(2);
    expect(harness.resetBodies.at(-1)).toEqual({ expectedRevision: 6 });

    const resume = page.getByRole("button", { name: copy.resumePlay, exact: true });
    await resume.click();
    expect(harness.resumeBodies.at(-1)).toEqual({ expectedRevision: 7 });
    await expect(page.locator(".japanese-scoring-controls")).toHaveCount(0);
    await expect(page.getByText(copy.opponentTurn, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(copy.disputeResumed, { exact: true })).toBeVisible();
    await expectNoDocumentOverflow(page);
    await expectCleanHarness(harness);
  });
}

test("Japanese final phase and unavailable suggestion fail closed", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-1024", "Representative desktop edge-state coverage.");
  const harness = await installJapaneseHarness(page, "scoring-final");
  await page.goto(`/game/${GAME_ID}`);
  await expect(page.getByText(en.game.finalResolutionTitle, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: en.game.resumePlay, exact: true })).toBeDisabled();

  harness.resetScenario("scoring-unavailable");
  await page.reload();
  await expect(page.getByText(en.game.suggestionUnavailable, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: en.game.resetToSuggestion, exact: true })).toBeDisabled();
  await expect(page.getByRole("gridcell", { name: /Mark the black group at C17 as dead/ }).first()).toBeEnabled();
  await expectCleanHarness(harness);
});

test("expired Japanese deadlines resolve to adjudication, no result, or abandonment", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-1024", "Representative deadline policy coverage.");
  const harness = await installJapaneseHarness(page, "scoring-expired");

  await page.goto(`/game/${GAME_ID}`);
  const adjudication = page.getByRole("dialog", { name: en.game.defeat });
  await expect(adjudication).toBeVisible();
  expect(harness.deadlineBodies.at(-1)).toEqual({ expectedRevision: 1 });
  await expect(adjudication.getByText(/White wins by 2.5 points/)).toBeVisible();

  harness.setDeadlineOutcome("no-result");
  harness.resetScenario("scoring-expired");
  await page.reload();
  await expect(page.getByRole("dialog", { name: en.game.noResult })).toBeVisible();
  await expect(page.getByText(en.game.noResult, { exact: true })).toBeVisible();

  harness.setDeadlineOutcome("abandonment");
  harness.resetScenario("scoring-expired");
  await page.reload();
  const abandonment = page.getByRole("dialog", { name: en.game.victory });
  await expect(abandonment).toBeVisible();
  await expect(abandonment.getByText(/Black wins because the opponent did not participate in scoring/)).toBeVisible();
  expect(harness.deadlineBodies).toHaveLength(3);
  await expectCleanHarness(harness);
});

test("Japanese scoring reconnects without enabling stale controls", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-320-touch", "Representative mobile reconnect coverage.");
  const harness = await installJapaneseHarness(page, "scoring-ready");
  await page.goto(`/de/game/${GAME_ID}`);
  const connection = page.locator(".game-connection");
  const confirm = page.getByRole("button", { name: de.game.confirmScore, exact: true });
  await expect(connection).toHaveAttribute("data-state", "live");
  await expect(confirm).toBeEnabled();

  const reads = harness.gameReadCount();
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(connection).toHaveAttribute("data-state", "reconnecting");
  await expect(confirm).toBeDisabled();
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(connection).toHaveAttribute("data-state", "live");
  await expect.poll(() => harness.gameReadCount()).toBeGreaterThan(reads);
  await expect(confirm).toBeEnabled();
  await expectCleanHarness(harness);
});

test("Japanese scoring supports keyboard-only changes and live announcements", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-1024", "Representative keyboard and screen-reader coverage.");
  const harness = await installJapaneseHarness(page, "scoring-pending");
  await page.goto(`/game/${GAME_ID}`);
  await expect(page.getByText(en.game.suggestionPending, { exact: true })).toBeVisible();

  harness.setSuggestionStatus("ready");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  const live = page.locator('.sr-only[role="status"]').first();
  await expect(live).toContainText(en.game.suggestionReadyAnnouncement);

  const cell = page.getByRole("gridcell", { name: /Mark the black group at C17 as dead/ }).first();
  await cell.focus();
  await cell.press("Enter");
  await expect(live).toContainText(en.game.groupMarkedDeadAnnouncement.split("{")[0]);
  const confirm = page.getByRole("button", { name: en.game.confirmScore, exact: true });
  await expect(confirm).toBeEnabled();
  await confirm.focus();
  await confirm.press("Enter");
  await expect.poll(() => harness.scoringBodies.confirm.length).toBe(1);
  await expect(page.getByRole("button", { name: en.game.confirmed, exact: true })).toBeDisabled();
  const restore = page.getByRole("gridcell", { name: /Restore the black group at C17 as alive/ }).first();
  await expect(restore).toBeEnabled();
  await restore.focus();
  await restore.press("Enter");
  await expect.poll(() => harness.scoringBodies.deadStones.length).toBe(2);
  await expect(live).toContainText(en.game.confirmationsClearedAnnouncement);
  await expectCleanHarness(harness);
});

test("new matches accept the Japanese default and expose a private SGF request", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-1440", "Representative default-profile and SGF coverage.");
  const harness = await installJapaneseHarness(page);
  await page.goto("/play?size=19");
  await page.getByRole("button", { name: en.play.findOpponent }).click();
  await expect(page).toHaveURL(`${ORIGIN}/game/${GAME_ID}`);
  expect(harness.matchmakingBodies).toEqual([{ boardSize: 19, timeControl: "rapid" }]);

  await page.getByRole("button", { name: en.game.pass, exact: true }).click();
  harness.opponentPass();
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByText(en.game.japaneseScoringTitle, { exact: true })).toBeVisible();
  await expect(page.getByLabel(en.game.provisionalJapaneseScore)).toBeVisible();

  const sgf = await page.evaluate(async ({ gameId, playerKey, header }) => {
    const response = await fetch(`/api/games/${gameId}/sgf`, {
      headers: { [header]: playerKey },
    });
    return {
      body: await response.text(),
      cacheControl: response.headers.get("cache-control"),
      contentType: response.headers.get("content-type"),
      status: response.status,
    };
  }, { gameId: GAME_ID, playerKey: PLAYER_KEY, header: EXPECTED_PLAYER_HEADER });
  expect(sgf).toEqual({
    body: "(;FF[4]GM[1]SZ[19]RU[Japanese]KM[6.5]RE[W+2.5])",
    cacheControl: "private, no-store",
    contentType: "application/x-go-sgf; charset=utf-8",
    status: 200,
  });
  expect(harness.sgfRequests()).toBe(1);
  await expectCleanHarness(harness);
});
