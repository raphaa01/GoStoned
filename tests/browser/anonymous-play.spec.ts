import { expect, test, type Locator, type Page, type Request, type Route } from "@playwright/test";
import type { GameState, Stone, StoredMove } from "../../lib/game/types";
import { scoreChineseAgreement, toggleDeadGroup } from "../../lib/game/scoring";

const ORIGIN = "http://127.0.0.1:3100";
const EXPECTED_PLAYER_HEADER = "x-gostone-expected-player";
const PLAYER_KEY = "guest:11111111-1111-4111-8111-111111111111";
const OPPONENT_KEY = "guest:22222222-2222-4222-8222-222222222222";
const GAME_ID = "33333333-3333-4333-8333-333333333333";

const copy = {
  en: {
    agreedDetails: "Agreed scoring details",
    agreedScore: "Agreed Chinese area score",
    cancel: "Cancel",
    challengeDead: "Resume play to challenge a dead mark",
    chatMessage: "Chat message",
    confirmScore: "Confirm score",
    confirmed: "confirmed",
    defeat: "Defeat",
    disputeResumed: "Play resumed to resolve a marked-group dispute on the board.",
    findOpponent: "Find an opponent",
    findAnother: "Find another game",
    learn: "Learn",
    live: "Live",
    markBlackC17: "Mark the black group at C17 as dead.",
    mobileNavigation: "Mobile navigation",
    openMenu: "Open menu",
    opponent: "Opponent",
    opponentTurn: "Opponent's turn",
    pass: "Pass",
    reconnecting: "Reconnecting",
    resign: "Resign",
    resignTitle: "Resign this game?",
    restoreBlackC17: "Restore the black group at C17 as alive.",
    scoringConflict: "The scoring proposal changed. Review the latest position.",
    scoringStarted: "Scoring started. Mark dead groups, then both players confirm the same final position.",
    sessionExpired: "Session expired",
    showWholeBoard: "Show whole board",
    skipToContent: "Skip to main content",
    startNewSession: "Start a new guest session",
    syncDelayed: "Sync delayed",
    unavailable: "Game unavailable",
    viewBoard: "View board",
    waiting: "waiting",
    yourTurn: "Your turn",
  },
  de: {
    agreedDetails: "Vereinbarte Wertungsdetails",
    agreedScore: "Vereinbarte chinesische Flächenwertung",
    cancel: "Abbrechen",
    challengeDead: "Weiterspielen und Tot-Markierung anfechten",
    chatMessage: "Chatnachricht",
    confirmScore: "Wertung bestätigen",
    confirmed: "bestätigt",
    defeat: "Niederlage",
    disputeResumed: "Das Spiel wurde fortgesetzt, um eine markierte Gruppe auf dem Brett zu klären.",
    findOpponent: "Gegner finden",
    findAnother: "Weitere Partie finden",
    learn: "Lernen",
    live: "Live",
    markBlackC17: "Markiere die schwarze Gruppe bei C17 als tot.",
    mobileNavigation: "Mobile Navigation",
    openMenu: "Menü öffnen",
    opponent: "Gegner",
    opponentTurn: "Der Gegner ist am Zug",
    pass: "Passen",
    reconnecting: "Verbindung wird erneuert",
    resign: "Aufgeben",
    resignTitle: "Diese Partie aufgeben?",
    restoreBlackC17: "Stelle die schwarze Gruppe bei C17 als lebend wieder her.",
    scoringConflict: "Der Wertungsvorschlag hat sich geändert. Prüfe die aktuelle Position.",
    scoringStarted: "Die Wertung hat begonnen. Markiert tote Gruppen und bestätigt danach beide dieselbe Endposition.",
    sessionExpired: "Sitzung abgelaufen",
    showWholeBoard: "Ganzes Brett zeigen",
    skipToContent: "Zum Hauptinhalt springen",
    startNewSession: "Neue Gastsitzung starten",
    syncDelayed: "Abgleich verzögert",
    unavailable: "Partie nicht verfügbar",
    viewBoard: "Brett ansehen",
    waiting: "wartet",
    yourTurn: "Du bist am Zug",
  },
} as const;

type GameScenario = "empty" | "scoring-lifecycle" | "scoring-dispute";
type GameReadFault = "network_error" | "rate_limited" | "session_expired";
type ExpectedHttpError = Readonly<{
  code: string;
  method: string;
  pathname: string;
  status: number;
}>;
type ExpectedRequestFailure = Readonly<{
  errorText: string;
  method: string;
  pathname: string;
}>;
type ScoringConflictControl = Readonly<{
  reconciliationRequested: Promise<void>;
  release: () => void;
}>;
type GameReadGateControl = Readonly<{
  requestStarted: Promise<void>;
  release: () => void;
}>;
type FaultDiagnostic = {
  code: string;
  fault: GameReadFault;
  method: "GET";
  pathname: string;
  queuedAt: number;
  servedAt: number | null;
  gameReadSequence: number | null;
};

type BrowserDiagnostics = {
  consoleErrors: string[];
  externalRequests: string[];
  httpErrors: string[];
  pageErrors: string[];
  requestFailures: string[];
  unexpectedApi: string[];
  webSockets: string[];
};

type ApiHarness = {
  armGameReadGate: () => GameReadGateControl;
  armScoringRevisionConflict: () => ScoringConflictControl;
  chatReadStartedAt: number[];
  contractErrors: string[];
  diagnostics: BrowserDiagnostics;
  expectedHttpErrors: ExpectedHttpError[];
  expectedRequestFailures: ExpectedRequestFailure[];
  faultDiagnostics: FaultDiagnostic[];
  flushDiagnostics: () => Promise<void>;
  gameReadStartedAt: number[];
  gameReadVersions: Array<number | null>;
  handledHttpErrors: ExpectedHttpError[];
  handledRequestFailures: ExpectedRequestFailure[];
  matchmakingBodies: unknown[];
  moveBodies: Array<{ expectedVersion: number; isPass?: boolean; x?: number; y?: number }>;
  opponentConfirm: () => void;
  opponentPass: () => void;
  queueGameReadFault: (fault: GameReadFault) => void;
  releaseSession: () => void;
  resetGame: (scenario: Exclude<GameScenario, "empty">) => void;
  scoringBodies: {
    confirm: unknown[];
    deadStones: unknown[];
    resume: unknown[];
  };
  serverNowValues: string[];
  sessionRequested: Promise<void>;
};

type ApiHarnessOptions = {
  gameScenario?: GameScenario;
  guestUnavailable?: boolean;
  holdSession?: boolean;
  realLocaleMutation?: boolean;
};

const BLACK_GROUP = [{ x: 2, y: 2 }, { x: 3, y: 2 }] as const;
const WHITE_GROUP = [{ x: 14, y: 15 }, { x: 15, y: 15 }] as const;

function blankBoard(): GameState["board"] {
  return Array.from({ length: 19 }, () => Array<null>(19).fill(null));
}

function gameClock(): GameState["clock"] {
  return {
    serverNow: "2026-01-01T00:00:01.000Z",
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

function scoringState(
  game: Pick<GameState, "board" | "komi" | "moveCount">,
  deadStones: Array<{ x: number; y: number }>,
  revision = 1,
): NonNullable<GameState["scoring"]> {
  return {
    revision,
    boardHash: "browser-harness-stopped-board",
    stoppedMoveNumber: game.moveCount,
    deadStones: deadStones.map((stone) => ({ ...stone })),
    blackConfirmed: false,
    whiteConfirmed: false,
    preview: scoreChineseAgreement(game.board, deadStones, game.komi),
    finalizedAt: null,
    expiresAt: "2099-01-01T00:10:00.000Z",
  };
}

function seededGame(): GameState {
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
    ...createGame("empty"),
    board,
    moves,
    moveCount: moves.length,
    version: 4,
  };
}

function createGame(scenario: GameScenario = "empty"): GameState {
  const game: GameState = {
    id: GAME_ID,
    boardSize: 19,
    blackPlayerKey: PLAYER_KEY,
    whitePlayerKey: OPPONENT_KEY,
    blackPlayerName: "Guest E2E",
    whitePlayerName: "Opponent E2E",
    winnerKey: null,
    rated: false,
    status: "active",
    phase: "play",
    result: null,
    finishReason: null,
    komi: 7.5,
    ruleset: "chinese",
    rulesProfile: "chinese-2002-gostone-v1",
    scoringMethod: "area",
    handicap: 0,
    consecutivePasses: 0,
    scoringRevision: 0,
    scoring: null,
    lastResume: null,
    version: 0,
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: null,
    timeControl: "rapid",
    clock: gameClock(),
    turn: "black",
    moveCount: 0,
    board: blankBoard(),
    moves: [],
  };
  if (scenario === "empty") return game;

  const seeded = seededGame();
  if (scenario === "scoring-lifecycle") return seeded;
  const passMoves: StoredMove[] = [
    ...seeded.moves,
    { moveNumber: 5, color: "black", x: null, y: null, isPass: true, createdAt: "2026-01-01T00:00:06.000Z" },
    { moveNumber: 6, color: "white", x: null, y: null, isPass: true, createdAt: "2026-01-01T00:00:07.000Z" },
  ];
  const scoringGame: GameState = {
    ...seeded,
    consecutivePasses: 2,
    moveCount: passMoves.length,
    moves: passMoves,
    phase: "scoring",
    scoringRevision: 1,
    turn: null,
    version: 6,
  };
  scoringGame.scoring = scoringState(scoringGame, BLACK_GROUP.map((stone) => ({ ...stone })));
  return scoringGame;
}

function exactQuery(url: URL, expected: Record<string, string>): boolean {
  const actual = Array.from(url.searchParams.entries()).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const wanted = Object.entries(expected).sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(actual) === JSON.stringify(wanted);
}

function requestName(request: Request) {
  const url = new URL(request.url());
  return `${request.method()} ${url.pathname}${url.search}`;
}

async function fulfillJson(
  route: Route,
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  await route.fulfill({
    body: JSON.stringify(body),
    contentType: "application/json; charset=utf-8",
    headers: { "Cache-Control": "no-store", ...headers },
    status,
  });
}

function recordExpectedPlayer(
  harness: ApiHarness,
  request: Request,
) {
  const actual = request.headers()[EXPECTED_PLAYER_HEADER];
  if (actual !== PLAYER_KEY) {
    harness.contractErrors.push(
      `${requestName(request)} sent ${EXPECTED_PLAYER_HEADER}=${String(actual)}`,
    );
  }
}

function recordJsonContentType(harness: ApiHarness, request: Request) {
  const contentType = request.headers()["content-type"]?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    harness.contractErrors.push(
      `${requestName(request)} sent Content-Type=${String(request.headers()["content-type"])}`,
    );
  }
}

async function installApiHarness(
  page: Page,
  options: ApiHarnessOptions = {},
): Promise<ApiHarness> {
  const diagnostics: BrowserDiagnostics = {
    consoleErrors: [],
    externalRequests: [],
    httpErrors: [],
    pageErrors: [],
    requestFailures: [],
    unexpectedApi: [],
    webSockets: [],
  };
  const pendingResponseDiagnostics: Array<Promise<void>> = [];
  let releaseSession: () => void = () => undefined;
  let notifySessionRequested: () => void = () => undefined;
  const sessionRequested = new Promise<void>((resolve) => {
    notifySessionRequested = resolve;
  });
  const sessionGate = options.holdSession
    ? new Promise<void>((resolve) => {
      releaseSession = resolve;
    })
    : Promise.resolve();
  let game = createGame(options.gameScenario ?? "empty");
  let matched = false;
  let clockTick = 1;
  let nextGameReadFault: GameReadFault | null = null;
  let scoringConflictArmed = false;
  let holdConflictReconciliation = false;
  let notifyReconciliationRequested: () => void = () => undefined;
  let reconciliationGate = Promise.resolve();
  let gameReadGateActive = false;
  let notifyGameReadStarted: () => void = () => undefined;
  let gameReadGate = Promise.resolve();

  const tickClock = () => {
    clockTick += 1;
    game.clock.serverNow = new Date(Date.UTC(2026, 0, 1, 0, 0, clockTick)).toISOString();
  };

  const appendPass = (color: Stone) => {
    const moveNumber = game.moveCount + 1;
    game.moves = [
      ...game.moves,
      {
        moveNumber,
        color,
        x: null,
        y: null,
        isPass: true,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, moveNumber + 1)).toISOString(),
      },
    ];
    game.moveCount = moveNumber;
    game.consecutivePasses += 1;
    game.version += 1;
    if (game.consecutivePasses === 2) {
      game.phase = "scoring";
      game.turn = null;
      game.scoringRevision += 1;
      game.scoring = scoringState(game, [], game.scoringRevision);
    } else {
      game.turn = color === "black" ? "white" : "black";
    }
    tickClock();
  };

  const applyDeadGroup = (position: { x: number; y: number }, dead: boolean) => {
    if (!game.scoring) throw new Error("The browser harness needs an active scoring state.");
    const toggled = toggleDeadGroup(
      game.board,
      game.scoring.deadStones,
      position,
      dead,
    );
    if (!toggled.changed) return;
    const revision = game.scoring.revision + 1;
    game.scoring = {
      ...game.scoring,
      revision,
      deadStones: toggled.deadStones,
      blackConfirmed: false,
      whiteConfirmed: false,
      preview: scoreChineseAgreement(game.board, toggled.deadStones, game.komi),
    };
    game.scoringRevision = revision;
    game.version += 1;
    tickClock();
  };

  const finalizeIfAgreed = () => {
    if (!game.scoring?.blackConfirmed || !game.scoring.whiteConfirmed) return;
    const finishedAt = "2026-01-01T00:01:00.000Z";
    game.status = "finished";
    game.finishReason = "score";
    game.result = game.scoring.preview.result;
    game.winnerKey = game.scoring.preview.winner === "black"
      ? game.blackPlayerKey
      : game.scoring.preview.winner === "white"
        ? game.whitePlayerKey
        : null;
    game.finishedAt = finishedAt;
    game.turn = null;
    game.scoring = { ...game.scoring, finalizedAt: finishedAt };
    game.version += 1;
    tickClock();
  };

  const harness: ApiHarness = {
    armGameReadGate() {
      if (gameReadGateActive) throw new Error("Only one game-read gate may be active.");
      gameReadGateActive = true;
      let release: () => void = () => undefined;
      gameReadGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const requestStarted = new Promise<void>((resolve) => {
        notifyGameReadStarted = resolve;
      });
      return { requestStarted, release };
    },
    armScoringRevisionConflict() {
      if (scoringConflictArmed || holdConflictReconciliation) {
        throw new Error("Only one scoring revision conflict may be active.");
      }
      scoringConflictArmed = true;
      let release: () => void = () => undefined;
      reconciliationGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const reconciliationRequested = new Promise<void>((resolve) => {
        notifyReconciliationRequested = resolve;
      });
      harness.expectedHttpErrors.push({
        code: "scoring_revision_conflict",
        method: "POST",
        pathname: `/api/games/${GAME_ID}/scoring/dead-stones`,
        status: 409,
      });
      return { reconciliationRequested, release };
    },
    chatReadStartedAt: [],
    contractErrors: [],
    diagnostics,
    expectedHttpErrors: [],
    expectedRequestFailures: [],
    faultDiagnostics: [],
    async flushDiagnostics() {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      await Promise.all(pendingResponseDiagnostics.splice(0));
    },
    gameReadStartedAt: [],
    gameReadVersions: [],
    handledHttpErrors: [],
    handledRequestFailures: [],
    matchmakingBodies: [],
    moveBodies: [],
    opponentConfirm() {
      if (!game.scoring || game.status !== "active") {
        throw new Error("Opponent confirmation requires active scoring.");
      }
      game.scoring = { ...game.scoring, whiteConfirmed: true };
      game.version += 1;
      tickClock();
      finalizeIfAgreed();
    },
    opponentPass() {
      if (game.status !== "active" || game.phase !== "play" || game.turn !== "white") {
        throw new Error("Opponent pass requires White's turn in active play.");
      }
      appendPass("white");
    },
    queueGameReadFault(fault) {
      if (nextGameReadFault) throw new Error("Only one game-read fault may be queued.");
      nextGameReadFault = fault;
      harness.faultDiagnostics.push({
        code: fault === "network_error"
          ? "net::ERR_INTERNET_DISCONNECTED"
          : fault,
        fault,
        method: "GET",
        pathname: `/api/games/${GAME_ID}`,
        queuedAt: Date.now(),
        servedAt: null,
        gameReadSequence: null,
      });
      if (fault === "network_error") {
        harness.expectedRequestFailures.push({
          errorText: "net::ERR_INTERNET_DISCONNECTED",
          method: "GET",
          pathname: `/api/games/${GAME_ID}`,
        });
      } else {
        harness.expectedHttpErrors.push({
          code: fault,
          method: "GET",
          pathname: `/api/games/${GAME_ID}`,
          status: fault === "rate_limited" ? 429 : 401,
        });
      }
    },
    releaseSession,
    resetGame(scenario) {
      game = createGame(scenario);
      tickClock();
      nextGameReadFault = null;
      scoringConflictArmed = false;
      holdConflictReconciliation = false;
      notifyReconciliationRequested = () => undefined;
      reconciliationGate = Promise.resolve();
      gameReadGateActive = false;
      notifyGameReadStarted = () => undefined;
      gameReadGate = Promise.resolve();
    },
    scoringBodies: { confirm: [], deadStones: [], resume: [] },
    serverNowValues: [],
    sessionRequested,
  };

  const recordServedGameClock = () => {
    harness.serverNowValues.push(game.clock.serverNow);
  };

  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (message.text().startsWith("Failed to load resource:")) return;
    diagnostics.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => diagnostics.pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    const cancelledNextPrefetch = request.method() === "GET"
      && url.origin === ORIGIN
      && url.searchParams.has("_rsc")
      && request.failure()?.errorText === "net::ERR_ABORTED";
    if (cancelledNextPrefetch) return;
    const observed = {
      errorText: request.failure()?.errorText ?? "unknown failure",
      method: request.method(),
      pathname: url.pathname,
    };
    const expectedIndex = harness.expectedRequestFailures.findIndex((expected) =>
      expected.errorText === observed.errorText
      && expected.method === observed.method
      && expected.pathname === observed.pathname,
    );
    if (expectedIndex >= 0) {
      harness.expectedRequestFailures.splice(expectedIndex, 1);
      harness.handledRequestFailures.push(observed);
      return;
    }
    diagnostics.requestFailures.push(
      `${requestName(request)}: ${observed.errorText}`,
    );
  });
  page.on("response", (response) => {
    if (response.status() >= 400) pendingResponseDiagnostics.push((async () => {
      const request = response.request();
      const body = await response.json().catch(() => null) as { code?: unknown } | null;
      const observed = {
        code: typeof body?.code === "string" ? body.code : "missing_error_code",
        method: request.method(),
        pathname: new URL(request.url()).pathname,
        status: response.status(),
      };
      const expectedIndex = harness.expectedHttpErrors.findIndex((expected) =>
        expected.code === observed.code
        && expected.method === observed.method
        && expected.pathname === observed.pathname
        && expected.status === observed.status,
      );
      if (expectedIndex >= 0) {
        harness.expectedHttpErrors.splice(expectedIndex, 1);
        harness.handledHttpErrors.push(observed);
      } else {
        diagnostics.httpErrors.push(
          `${response.status()} ${requestName(request)} code=${observed.code}`,
        );
      }
    })());
  });
  await page.routeWebSocket(/.*/, async (webSocket) => {
    diagnostics.webSockets.push(webSocket.url());
    await webSocket.close({ code: 1008, reason: "Browser tests do not permit WebSocket egress." });
  });

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== ORIGIN) {
      diagnostics.externalRequests.push(request.url());
      await route.abort("blockedbyclient");
      return;
    }
    if (url.origin !== ORIGIN || !url.pathname.startsWith("/api/")) {
      await route.continue();
      return;
    }

    const method = request.method();
    if (method === "GET" && url.pathname === "/api/auth/session" && exactQuery(url, {})) {
      notifySessionRequested();
      await sessionGate;
      await fulfillJson(route, { ok: true, user: null });
      return;
    }
    if (method === "POST" && url.pathname === "/api/auth/guest" && exactQuery(url, {})) {
      recordJsonContentType(harness, request);
      const body = request.postDataJSON();
      if (JSON.stringify(body) !== "{}") {
        harness.contractErrors.push(`${requestName(request)} body was not an empty object`);
      }
      await fulfillJson(route, options.guestUnavailable
        ? { ok: false, code: "guest_session_failed", error: "Guest session unavailable." }
        : {
          ok: true,
          identity: { playerKey: PLAYER_KEY, displayName: "Guest E2E" },
        }, options.guestUnavailable ? 200 : 201);
      return;
    }
    if (url.pathname === "/api/matchmaking" && exactQuery(url, {})) {
      recordExpectedPlayer(harness, request);
      if (method === "GET") {
        await fulfillJson(route, {
          ok: true,
          actor: PLAYER_KEY,
          matchmaking: matched
            ? { status: "matched", gameId: GAME_ID, boardSize: 19, timeControl: "blitz" }
            : { status: "idle", gameId: null, boardSize: null, timeControl: null },
        });
        return;
      }
      if (method === "POST") {
        recordJsonContentType(harness, request);
        const body = request.postDataJSON();
        harness.matchmakingBodies.push(body);
        if (JSON.stringify(body) !== JSON.stringify({ boardSize: 19, timeControl: "blitz" })) {
          harness.contractErrors.push(`${requestName(request)} sent ${JSON.stringify(body)}`);
        }
        matched = true;
        await fulfillJson(route, {
          ok: true,
          actor: PLAYER_KEY,
          matchmaking: { status: "matched", gameId: GAME_ID, boardSize: 19, timeControl: "blitz" },
        });
        return;
      }
    }
    if (method === "GET" && url.pathname === "/api/games" && exactQuery(url, {})) {
      await fulfillJson(route, {
        ok: true,
        summary: {
          gamesStartedLast24Hours: 0,
          observedAt: "2026-01-01T00:00:00.000Z",
          recentlyWaitingPlayers: 0,
          unfinishedGames: 0,
        },
      });
      return;
    }
    if (method === "GET" && url.pathname === `/api/games/${GAME_ID}`) {
      const knownVersion = url.searchParams.get("knownVersion");
      const validQuery = exactQuery(url, {})
        || (knownVersion !== null && exactQuery(url, { knownVersion }));
      if (validQuery && (knownVersion === null || /^(0|[1-9][0-9]*)$/.test(knownVersion))) {
        recordExpectedPlayer(harness, request);
        harness.gameReadStartedAt.push(Date.now());
        harness.gameReadVersions.push(knownVersion === null ? null : Number(knownVersion));
        if (gameReadGateActive) {
          const capturedGate = gameReadGate;
          const notifyCapturedRequest = notifyGameReadStarted;
          gameReadGateActive = false;
          notifyGameReadStarted = () => undefined;
          gameReadGate = Promise.resolve();
          notifyCapturedRequest();
          await capturedGate;
        }
        if (nextGameReadFault) {
          const fault = nextGameReadFault;
          nextGameReadFault = null;
          const diagnostic = harness.faultDiagnostics.find((entry) =>
            entry.fault === fault && entry.servedAt === null,
          );
          if (!diagnostic) throw new Error(`Missing queued diagnostic for ${fault}.`);
          diagnostic.servedAt = Date.now();
          diagnostic.gameReadSequence = harness.gameReadStartedAt.length;
          if (fault === "network_error") {
            await route.abort("internetdisconnected");
          } else if (fault === "rate_limited") {
            await fulfillJson(route, {
              ok: false,
              code: "rate_limited",
              error: "The browser harness asked this game read to wait.",
              retryAfterSeconds: 1,
            }, 429, { "Retry-After": "1" });
          } else {
            await fulfillJson(route, {
              ok: false,
              code: "session_expired",
              error: "The browser harness expired this guest session.",
            }, 401);
          }
          return;
        }
        if (
          holdConflictReconciliation
          && knownVersion !== null
          && Number(knownVersion) !== game.version
        ) {
          notifyReconciliationRequested();
          await reconciliationGate;
          holdConflictReconciliation = false;
          notifyReconciliationRequested = () => undefined;
          reconciliationGate = Promise.resolve();
        }
        tickClock();
        recordServedGameClock();
        if (
          game.status === "active"
          && game.rulesProfile === "chinese-2002-gostone-v1"
          && knownVersion !== null
          && Number(knownVersion) === game.version
        ) {
          await fulfillJson(route, {
            ok: true,
            unchanged: true,
            gameId: GAME_ID,
            version: game.version,
            clock: game.clock,
          });
        } else {
          await fulfillJson(route, { ok: true, game });
        }
        return;
      }
    }
    if (
      method === "GET"
      && url.pathname === `/api/games/${GAME_ID}/chat`
      && url.searchParams.get("after") !== null
      && /^(0|[1-9][0-9]*)$/.test(url.searchParams.get("after") ?? "")
      && exactQuery(url, { after: url.searchParams.get("after") ?? "" })
    ) {
      recordExpectedPlayer(harness, request);
      harness.chatReadStartedAt.push(Date.now());
      await fulfillJson(route, { ok: true, available: true, messages: [] });
      return;
    }
    if (
      method === "GET"
      && url.pathname === `/api/games/${GAME_ID}/block`
      && exactQuery(url, {})
    ) {
      recordExpectedPlayer(harness, request);
      await fulfillJson(route, { ok: true, actor: PLAYER_KEY, blocked: false });
      return;
    }
    if (
      method === "POST"
      && url.pathname === `/api/games/${GAME_ID}/moves`
      && exactQuery(url, {})
    ) {
      recordExpectedPlayer(harness, request);
      recordJsonContentType(harness, request);
      const body = request.postDataJSON() as Record<string, unknown>;
      const keys = Object.keys(body).sort();
      const passMove = JSON.stringify(keys) === JSON.stringify(["expectedVersion", "isPass"])
        && body.isPass === true;
      const coordinateMove = JSON.stringify(keys) === JSON.stringify(["expectedVersion", "x", "y"])
        && Number.isInteger(body.x)
        && Number.isInteger(body.y);
      if (body.expectedVersion !== game.version || (!passMove && !coordinateMove)) {
        harness.contractErrors.push(`${requestName(request)} sent ${JSON.stringify(body)}`);
      } else if (passMove) {
        const move = body as { expectedVersion: number; isPass: true };
        harness.moveBodies.push(move);
        appendPass("black");
      } else {
        const move = body as { expectedVersion: number; x: number; y: number };
        harness.moveBodies.push(move);
        game.board[move.y][move.x] = "black";
        const storedMove: StoredMove = {
          moveNumber: game.moveCount + 1,
          color: "black",
          x: move.x,
          y: move.y,
          isPass: false,
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, game.moveCount + 2)).toISOString(),
        };
        game.moves = [...game.moves, storedMove];
        game.moveCount = storedMove.moveNumber;
        game.consecutivePasses = 0;
        game.turn = "white";
        game.version += 1;
        tickClock();
      }
      recordServedGameClock();
      await fulfillJson(route, { ok: true, actor: PLAYER_KEY, game });
      return;
    }
    if (
      method === "POST"
      && url.pathname === `/api/games/${GAME_ID}/scoring/dead-stones`
      && exactQuery(url, {})
    ) {
      recordExpectedPlayer(harness, request);
      recordJsonContentType(harness, request);
      const body = request.postDataJSON() as Record<string, unknown>;
      const keys = Object.keys(body).sort();
      if (
        JSON.stringify(keys) !== JSON.stringify(["dead", "expectedRevision", "x", "y"])
        || body.expectedRevision !== game.scoring?.revision
        || typeof body.dead !== "boolean"
        || !Number.isInteger(body.x)
        || !Number.isInteger(body.y)
      ) {
        harness.contractErrors.push(`${requestName(request)} sent ${JSON.stringify(body)}`);
        await fulfillJson(route, {
          ok: false,
          code: "invalid_browser_contract",
          error: "Invalid dead-stone browser contract.",
        }, 400);
        return;
      }
      harness.scoringBodies.deadStones.push(body);
      if (scoringConflictArmed) {
        scoringConflictArmed = false;
        applyDeadGroup(WHITE_GROUP[0], true);
        holdConflictReconciliation = true;
        await fulfillJson(route, {
          ok: false,
          code: "scoring_revision_conflict",
          error: "The scoring proposal changed. Review the latest position.",
        }, 409);
        return;
      }
      applyDeadGroup(
        { x: body.x as number, y: body.y as number },
        body.dead as boolean,
      );
      recordServedGameClock();
      await fulfillJson(route, { ok: true, actor: PLAYER_KEY, game });
      return;
    }
    if (
      method === "POST"
      && url.pathname === `/api/games/${GAME_ID}/scoring/confirm`
      && exactQuery(url, {})
    ) {
      recordExpectedPlayer(harness, request);
      recordJsonContentType(harness, request);
      const body = request.postDataJSON() as Record<string, unknown>;
      if (
        JSON.stringify(Object.keys(body).sort()) !== JSON.stringify(["expectedRevision"])
        || body.expectedRevision !== game.scoring?.revision
      ) {
        harness.contractErrors.push(`${requestName(request)} sent ${JSON.stringify(body)}`);
        await fulfillJson(route, {
          ok: false,
          code: "invalid_browser_contract",
          error: "Invalid scoring-confirmation browser contract.",
        }, 400);
        return;
      }
      harness.scoringBodies.confirm.push(body);
      if (!game.scoring) throw new Error("Scoring confirmation requires active scoring.");
      game.scoring = { ...game.scoring, blackConfirmed: true };
      game.version += 1;
      tickClock();
      finalizeIfAgreed();
      recordServedGameClock();
      await fulfillJson(route, { ok: true, actor: PLAYER_KEY, game });
      return;
    }
    if (
      method === "POST"
      && url.pathname === `/api/games/${GAME_ID}/scoring/resume`
      && exactQuery(url, {})
    ) {
      recordExpectedPlayer(harness, request);
      recordJsonContentType(harness, request);
      const body = request.postDataJSON() as Record<string, unknown>;
      if (
        JSON.stringify(Object.keys(body).sort()) !== JSON.stringify(["claim", "expectedRevision", "x", "y"])
        || body.expectedRevision !== game.scoring?.revision
        || (body.claim !== "alive" && body.claim !== "dead")
        || !Number.isInteger(body.x)
        || !Number.isInteger(body.y)
      ) {
        harness.contractErrors.push(`${requestName(request)} sent ${JSON.stringify(body)}`);
        await fulfillJson(route, {
          ok: false,
          code: "invalid_browser_contract",
          error: "Invalid scoring-resume browser contract.",
        }, 400);
        return;
      }
      harness.scoringBodies.resume.push(body);
      game.phase = "play";
      game.turn = body.claim === "alive" ? "white" : "black";
      game.consecutivePasses = 0;
      game.scoring = null;
      game.scoringRevision += 1;
      game.lastResume = {
        claim: body.claim,
        requestedBy: "black",
        disputedStone: { x: body.x as number, y: body.y as number },
      };
      game.version += 1;
      tickClock();
      recordServedGameClock();
      await fulfillJson(route, { ok: true, actor: PLAYER_KEY, game });
      return;
    }
    if (method === "POST" && url.pathname === "/api/locale" && exactQuery(url, {})) {
      if (options.realLocaleMutation) {
        await route.continue();
        return;
      }
      recordJsonContentType(harness, request);
      const body = request.postDataJSON() as { locale?: unknown };
      if (body.locale !== "en" && body.locale !== "de") {
        harness.contractErrors.push(`${requestName(request)} sent ${JSON.stringify(body)}`);
      }
      await fulfillJson(route, { ok: true, locale: body.locale });
      return;
    }

    diagnostics.unexpectedApi.push(requestName(request));
    await fulfillJson(route, {
      ok: false,
      code: "unexpected_browser_test_api",
      error: "Unexpected API request in isolated browser test.",
    }, 501);
  });

  return harness;
}

async function expectNoDocumentOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    body: document.body.scrollWidth - document.body.clientWidth,
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(overflow).toEqual({ body: 0, document: 0 });
}

async function expectControlInsideViewport(
  page: Page,
  locator: Locator,
  scroll = true,
  minimumHeight = 40,
) {
  if (scroll) await locator.scrollIntoViewIfNeeded();
  await expect.poll(async () => {
    const bounds = await locator.boundingBox();
    const viewport = page.viewportSize();
    return Boolean(
      bounds
      && viewport
      && bounds.x >= -0.5
      && bounds.y >= -0.5
      && bounds.x + bounds.width <= viewport.width + 0.5
      && bounds.y + bounds.height <= viewport.height + 0.5
    );
  }).toBe(true);
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (!box || !viewport) return;
  expect(box.width).toBeGreaterThan(0);
  expect(box.height).toBeGreaterThanOrEqual(minimumHeight);
  expect(box.x).toBeGreaterThanOrEqual(-0.5);
  expect(box.y).toBeGreaterThanOrEqual(-0.5);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 0.5);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 0.5);
}

async function expectKeyboardSkipLink(
  page: Page,
  accessibleName: string,
  options: { enterMain?: boolean } = {},
) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: accessibleName });
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toHaveAttribute("href", "#main-content");
  await expect.poll(async () => (await skipLink.boundingBox())?.y ?? -1).toBeGreaterThanOrEqual(-0.5);
  const box = await skipLink.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (box && viewport) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(-0.5);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  }
  if (options.enterMain === false) return;
  await skipLink.press("Enter");
  const main = page.locator("main#main-content");
  await expect(main).toHaveCount(1);
  await expect(main).toHaveAttribute("tabindex", "-1");
  await expect(main).toBeFocused();
}

async function expectCleanHarness(harness: ApiHarness) {
  await harness.flushDiagnostics();
  expect(harness.contractErrors, "API contract errors").toEqual([]);
  expect(harness.expectedHttpErrors, "unconsumed expected HTTP errors").toEqual([]);
  expect(harness.expectedRequestFailures, "unconsumed expected request failures").toEqual([]);
  expect(harness.diagnostics.unexpectedApi, "unexpected API requests").toEqual([]);
  expect(harness.diagnostics.externalRequests, "external HTTP(S) requests").toEqual([]);
  expect(harness.diagnostics.pageErrors, "page errors").toEqual([]);
  expect(harness.diagnostics.consoleErrors, "console errors").toEqual([]);
  expect(harness.diagnostics.requestFailures, "failed browser requests").toEqual([]);
  expect(harness.diagnostics.httpErrors, "HTTP error responses").toEqual([]);
  expect(harness.diagnostics.webSockets, "WebSocket attempts").toEqual([]);
}

function expectStrictlyMonotonicServerNow(harness: ApiHarness) {
  expect(harness.serverNowValues.length, "served game clocks").toBeGreaterThan(1);
  const timestamps = harness.serverNowValues.map((value) => Date.parse(value));
  expect(timestamps.every(Number.isFinite), "valid serverNow timestamps").toBe(true);
  for (let index = 1; index < timestamps.length; index += 1) {
    expect(
      timestamps[index],
      `serverNow ${harness.serverNowValues[index]} must follow ${harness.serverNowValues[index - 1]}`,
    ).toBeGreaterThan(timestamps[index - 1]);
  }
}

async function waitForHarnessSignal(
  signal: Promise<void>,
  description: string,
  timeoutMs = 4_000,
) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      signal,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`Timed out waiting for browser harness signal: ${description}`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

const SCORING_AND_RECONNECT_PROJECTS = ["chromium-320-touch", "chromium-1024"];

for (const locale of ["en", "de"] as const) {
  test(`${locale.toUpperCase()} scoring lifecycle reconciles conflict and dispute`, async ({ page }, testInfo) => {
    test.skip(
      !SCORING_AND_RECONNECT_PROJECTS.includes(testInfo.project.name),
      "One touch and one desktop project cover the scoring lifecycle.",
    );
    const harness = await installApiHarness(page, { gameScenario: "scoring-lifecycle" });
    const localeCopy = copy[locale];
    const gamePath = locale === "en" ? `/game/${GAME_ID}` : `/de/game/${GAME_ID}`;

    await page.goto(gamePath);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    const pass = page.getByRole("button", { name: localeCopy.pass, exact: true });
    await expect(pass).toBeEnabled();
    await expectControlInsideViewport(page, pass, true, 24);
    await pass.click();
    await expect.poll(() => harness.moveBodies.length).toBe(1);
    expect(harness.moveBodies[0]).toEqual({ isPass: true, expectedVersion: 4 });
    await expect(page.getByText(localeCopy.opponentTurn, { exact: true }).first()).toBeVisible();

    harness.opponentPass();
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    const board = page.locator('.go-board[data-interaction-mode="mark-dead"]');
    await expect(board).toBeVisible();
    await expect(page.getByText(localeCopy.scoringStarted, { exact: true })).toBeVisible();
    await expectNoDocumentOverflow(page);

    const activateGroup = async (cell: Locator) => {
      await cell.scrollIntoViewIfNeeded();
      if (testInfo.project.name.endsWith("-touch")) await cell.tap();
      else {
        await cell.focus();
        await cell.press("Enter");
      }
    };
    let blackGroupCell = page.getByRole("gridcell", {
      name: localeCopy.markBlackC17,
      exact: true,
    });
    await activateGroup(blackGroupCell);
    await expect(page.getByRole("gridcell", { selected: true })).toHaveCount(2);
    expect(harness.scoringBodies.deadStones[0]).toEqual({
      x: 2,
      y: 2,
      dead: true,
      expectedRevision: 1,
    });

    blackGroupCell = page.getByRole("gridcell", {
      name: localeCopy.restoreBlackC17,
    });
    await activateGroup(blackGroupCell);
    await expect(page.getByRole("gridcell", { selected: true })).toHaveCount(0);
    expect(harness.scoringBodies.deadStones[1]).toEqual({
      x: 2,
      y: 2,
      dead: false,
      expectedRevision: 2,
    });

    blackGroupCell = page.getByRole("gridcell", {
      name: localeCopy.markBlackC17,
      exact: true,
    });
    await activateGroup(blackGroupCell);
    await expect(page.getByRole("gridcell", { selected: true })).toHaveCount(2);
    expect(harness.scoringBodies.deadStones[2]).toEqual({
      x: 2,
      y: 2,
      dead: true,
      expectedRevision: 3,
    });

    const conflict = harness.armScoringRevisionConflict();
    blackGroupCell = page.getByRole("gridcell", {
      name: localeCopy.restoreBlackC17,
    });
    const scoringError = page.getByRole("alert").filter({ hasText: localeCopy.scoringConflict });
    try {
      await activateGroup(blackGroupCell);
      await waitForHarnessSignal(
        conflict.reconciliationRequested,
        "the 409 scoring reconciliation read",
      );
      await expect(scoringError).toBeVisible();
      expect(harness.scoringBodies.deadStones[3]).toEqual({
        x: 2,
        y: 2,
        dead: false,
        expectedRevision: 4,
      });
    } finally {
      conflict.release();
    }
    await expect(scoringError).toHaveCount(0);
    await expect(page.getByRole("gridcell", { selected: true })).toHaveCount(4);

    harness.opponentConfirm();
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    const scoringControls = page.locator(".scoring-controls");
    await expect(scoringControls).toContainText(localeCopy.opponent);
    await expect(scoringControls.getByText(localeCopy.confirmed, { exact: true })).toBeVisible();
    const confirmScore = page.getByRole("button", {
      name: localeCopy.confirmScore,
      exact: true,
    });
    await expectControlInsideViewport(page, confirmScore, true, 24);
    await confirmScore.click();
    await expect.poll(() => harness.scoringBodies.confirm.length).toBe(1);
    expect(harness.scoringBodies.confirm).toEqual([{ expectedRevision: 5 }]);

    const result = page.getByRole("dialog", { name: localeCopy.defeat });
    await expect(result).toBeVisible();
    const findAnother = result.getByRole("button", {
      name: localeCopy.findAnother,
      exact: true,
    });
    await expect(findAnother).toBeFocused();
    await expectControlInsideViewport(page, findAnother, false, 24);
    await expect(result.getByRole("region", { name: localeCopy.agreedDetails })).toBeVisible();
    await expectNoDocumentOverflow(page);
    await result.getByRole("button", { name: localeCopy.viewBoard, exact: true }).click();
    await expect(result).toBeHidden();
    await expect(page.locator(".focused-board-status")).toBeFocused();
    await expect(page.getByText(localeCopy.agreedScore, { exact: true })).toBeVisible();

    harness.resetGame("scoring-dispute");
    await page.reload();
    await expect(page.locator('.go-board[data-interaction-mode="mark-dead"]')).toBeVisible();
    const challengeDead = page.getByRole("button", {
      name: localeCopy.challengeDead,
      exact: true,
    });
    await expectControlInsideViewport(page, challengeDead, true, 24);
    await challengeDead.click();
    await expect.poll(() => harness.scoringBodies.resume.length).toBe(1);
    expect(harness.scoringBodies.resume).toEqual([{
      claim: "alive",
      x: 2,
      y: 2,
      expectedRevision: 1,
    }]);
    await expect(page.locator(".scoring-controls")).toHaveCount(0);
    await expect(page.getByText(localeCopy.disputeResumed, { exact: true })).toBeVisible();
    await expect(page.getByText(localeCopy.opponentTurn, { exact: true }).first()).toBeVisible();
    await expect(page.locator('[role="gridcell"][aria-selected="true"]')).toHaveCount(0);
    await expectNoDocumentOverflow(page);
    expectStrictlyMonotonicServerNow(harness);
    await expectCleanHarness(harness);
    expect(harness.handledHttpErrors).toEqual([{
      code: "scoring_revision_conflict",
      method: "POST",
      pathname: `/api/games/${GAME_ID}/scoring/dead-stones`,
      status: 409,
    }]);
  });

  test(`${locale.toUpperCase()} game connection recovers or ends safely`, async ({ page }, testInfo) => {
    test.skip(
      !SCORING_AND_RECONNECT_PROJECTS.includes(testInfo.project.name),
      "One touch and one desktop project cover game reconnect states.",
    );
    const harness = await installApiHarness(page, { gameScenario: "scoring-lifecycle" });
    const localeCopy = copy[locale];
    const gamePath = locale === "en" ? `/game/${GAME_ID}` : `/de/game/${GAME_ID}`;
    const playPath = locale === "en" ? "/play" : "/de/play";

    await page.goto(gamePath);
    const connection = page.locator(".game-connection");
    const pass = page.getByRole("button", { name: localeCopy.pass, exact: true });
    const grid = page.getByRole("grid", { name: /19 × 19/ });
    const chat = page.getByRole("textbox", { name: localeCopy.chatMessage, exact: true });
    await expect(connection).toHaveAttribute("data-state", "live");
    await expect(page.getByRole("status").filter({ hasText: localeCopy.live })).toBeVisible();
    await expect(pass).toBeEnabled();
    await expect(chat).toBeEnabled();

    await expect.poll(() => harness.gameReadStartedAt.length).toBeGreaterThan(1);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expect(connection).toHaveAttribute("data-state", "reconnecting");
    await expect(page.getByRole("status").filter({ hasText: localeCopy.reconnecting })).toBeVisible();
    await expect(pass).toBeDisabled();
    await expect(chat).toBeDisabled();
    await expect(grid.getByRole("gridcell").first()).toHaveAttribute("aria-disabled", "true");
    await expectNoDocumentOverflow(page);

    const offlinePresentationSync = harness.armGameReadGate();
    try {
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await waitForHarnessSignal(
        offlinePresentationSync.requestStarted,
        "the offline-presentation recovery read",
      );
      await page.waitForTimeout(250);
      await expect(connection).toHaveAttribute("data-state", "reconnecting");
    } finally {
      offlinePresentationSync.release();
    }
    await expect(connection).toHaveAttribute("data-state", "live");
    await expect(page.getByRole("status").filter({ hasText: localeCopy.live })).toBeVisible();
    await expect(pass).toBeEnabled();
    await expect(chat).toBeEnabled();

    const readsBeforeNetworkFailure = harness.gameReadStartedAt.length;
    harness.queueGameReadFault("network_error");
    await expect.poll(() => harness.gameReadStartedAt.length).toBe(readsBeforeNetworkFailure + 1);
    await expect.poll(() => harness.handledRequestFailures.length).toBe(1);
    await harness.flushDiagnostics();
    expect(harness.faultDiagnostics[0]).toMatchObject({
      code: "net::ERR_INTERNET_DISCONNECTED",
      fault: "network_error",
      gameReadSequence: readsBeforeNetworkFailure + 1,
      method: "GET",
      pathname: `/api/games/${GAME_ID}`,
      queuedAt: expect.any(Number),
      servedAt: expect.any(Number),
    });
    expect(harness.handledRequestFailures).toEqual([{
      errorText: "net::ERR_INTERNET_DISCONNECTED",
      method: "GET",
      pathname: `/api/games/${GAME_ID}`,
    }]);
    await expect(connection).toHaveAttribute("data-state", "reconnecting");
    await expect(pass).toBeDisabled();
    await expect(chat).toBeDisabled();
    await expect(grid.getByRole("gridcell").first()).toHaveAttribute("aria-disabled", "true");

    const failedNetworkSync = harness.armGameReadGate();
    try {
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await waitForHarnessSignal(
        failedNetworkSync.requestStarted,
        "the failed-network recovery read",
      );
      await page.waitForTimeout(250);
      await expect(connection).toHaveAttribute("data-state", "reconnecting");
    } finally {
      failedNetworkSync.release();
    }
    await expect(connection).toHaveAttribute("data-state", "live");
    await expect.poll(() => harness.gameReadStartedAt.length).toBe(readsBeforeNetworkFailure + 2);
    await expect(page.getByRole("status").filter({ hasText: localeCopy.live })).toBeVisible();
    await expect(pass).toBeEnabled();
    await expect(chat).toBeEnabled();

    const readsBeforeRateLimit = harness.gameReadStartedAt.length;
    harness.queueGameReadFault("rate_limited");
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(connection).toHaveAttribute("data-state", "delayed");
    await expect.poll(() => harness.gameReadStartedAt.length).toBe(readsBeforeRateLimit + 1);
    const rateLimitDiagnostic = harness.faultDiagnostics[1];
    expect(rateLimitDiagnostic).toMatchObject({
      code: "rate_limited",
      fault: "rate_limited",
      gameReadSequence: readsBeforeRateLimit + 1,
      method: "GET",
      pathname: `/api/games/${GAME_ID}`,
      queuedAt: expect.any(Number),
      servedAt: expect.any(Number),
    });
    await expect(page.getByRole("status").filter({ hasText: localeCopy.syncDelayed })).toBeVisible();
    await expect(pass).toBeDisabled();
    await expect(chat).toBeDisabled();
    await page.waitForTimeout(700);
    expect(harness.gameReadStartedAt).toHaveLength(readsBeforeRateLimit + 1);
    await expect(connection).toHaveAttribute("data-state", "live", { timeout: 4_000 });
    await expect.poll(() => harness.gameReadStartedAt.length).toBe(readsBeforeRateLimit + 2);
    expect(
      harness.gameReadStartedAt[readsBeforeRateLimit + 1]
        - harness.gameReadStartedAt[readsBeforeRateLimit],
      "Retry-After: 1 must prevent an early game-state retry",
    ).toBeGreaterThanOrEqual(1_000);
    await expect(pass).toBeEnabled();
    await expect(chat).toBeEnabled();

    const readsBeforeSessionExpiry = harness.gameReadStartedAt.length;
    harness.queueGameReadFault("session_expired");
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(connection).toHaveAttribute("data-state", "session_expired");
    await expect.poll(() => harness.gameReadStartedAt.length).toBe(readsBeforeSessionExpiry + 1);
    expect(harness.faultDiagnostics[2]).toMatchObject({
      code: "session_expired",
      fault: "session_expired",
      gameReadSequence: readsBeforeSessionExpiry + 1,
      method: "GET",
      pathname: `/api/games/${GAME_ID}`,
      queuedAt: expect.any(Number),
      servedAt: expect.any(Number),
    });
    await expect(page.getByRole("status").filter({ hasText: localeCopy.sessionExpired })).toBeVisible();
    await expect(chat).toBeDisabled();
    const recovery = page.getByRole("button", {
      name: localeCopy.startNewSession,
      exact: true,
    });
    await expect(recovery).toBeVisible();
    await expectControlInsideViewport(page, recovery, true, 24);
    await expect(pass).toBeDisabled();
    const recoveryHadFocus = await recovery.evaluate((element) => document.activeElement === element);
    const terminalReadCount = harness.gameReadVersions.length;
    const terminalChatReadCount = harness.chatReadStartedAt.length;
    const provesTerminalSchedulingBoundary = locale === "en"
      && testInfo.project.name === "chromium-1024";
    await page.waitForTimeout(provesTerminalSchedulingBoundary ? 5_200 : 250);
    expect(harness.gameReadVersions).toHaveLength(terminalReadCount);
    expect(harness.chatReadStartedAt).toHaveLength(terminalChatReadCount);
    await recovery.click();
    await expect(page).toHaveURL(`${ORIGIN}${playPath}`);
    await expectNoDocumentOverflow(page);
    expectStrictlyMonotonicServerNow(harness);
    await expectCleanHarness(harness);
    expect(harness.handledHttpErrors).toEqual([
      {
        code: "rate_limited",
        method: "GET",
        pathname: `/api/games/${GAME_ID}`,
        status: 429,
      },
      {
        code: "session_expired",
        method: "GET",
        pathname: `/api/games/${GAME_ID}`,
        status: 401,
      },
    ]);
    expect(
      recoveryHadFocus,
      "terminal guest-session recovery must receive focus without another Tab press",
    ).toBe(true);
  });
}

for (const locale of ["en", "de"] as const) {
  test(`${locale.toUpperCase()} anonymous 19x19 play is responsive and operable`, async ({ page }, testInfo) => {
    const harness = await installApiHarness(page);
    const localeCopy = copy[locale];
    const playPath = locale === "en" ? "/play?size=19" : "/de/play?size=19";
    const gamePath = locale === "en" ? `/game/${GAME_ID}` : `/de/game/${GAME_ID}`;

    await page.goto(playPath);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    const size19 = page.getByRole("button", { name: /19×19/ });
    await expect(size19).toHaveAttribute("aria-pressed", "true");
    const boardPreview = page.locator('.play-board-preview[role="img"]');
    const previewGrid = boardPreview.locator('svg[data-board-size="19"]');
    await expect(previewGrid.locator('line[data-axis="vertical"]')).toHaveCount(19);
    await expect(previewGrid.locator('line[data-axis="horizontal"]')).toHaveCount(19);
    await expect(previewGrid.locator(".play-board-center-stone")).toHaveAttribute("cx", "50");
    await expect(previewGrid.locator(".play-board-center-stone")).toHaveAttribute("cy", "50");
    const findOpponent = page.getByRole("button", { name: localeCopy.findOpponent });
    await expect(findOpponent).toBeEnabled();
    const size13 = page.getByRole("button", { name: /13×13/ });
    await size13.click();
    await expect(boardPreview.locator('svg[data-board-size="13"]')).toBeVisible();
    await expect(boardPreview.locator('line[data-axis="vertical"]')).toHaveCount(13);
    await expect(boardPreview.locator(".play-board-center-stone")).toHaveAttribute("cx", "50");
    await expect(boardPreview.locator(".play-board-center-stone")).toHaveAttribute("cy", "50");
    await size19.click();
    await expect(previewGrid).toBeVisible();
    await expectControlInsideViewport(page, findOpponent);
    await expectNoDocumentOverflow(page);

    await findOpponent.click();
    await expect(page).toHaveURL(new RegExp(`${gamePath.replaceAll("/", "\\/")}$`));
    expect(harness.matchmakingBodies).toEqual([{ boardSize: 19, timeControl: "blitz" }]);

    const grid = page.getByRole("grid", { name: /19 × 19/ });
    await expect(grid).toBeVisible();
    await expect(grid.getByRole("gridcell")).toHaveCount(361);
    await expect(page.getByText(localeCopy.yourTurn, { exact: true }).first()).toBeVisible();
    await expectNoDocumentOverflow(page);
    expect(harness.gameReadVersions[0]).toBeNull();
    await expect.poll(
      () => harness.gameReadVersions.filter((version) => version === 0).length,
      { timeout: 4_000 },
    ).toBeGreaterThan(0);

    await expectKeyboardSkipLink(page, localeCopy.skipToContent);
    await page.keyboard.press("Tab");
    const rovingCell = grid.locator('[role="gridcell"][tabindex="0"]');
    await expect(rovingCell).toHaveCount(1);
    await expect(rovingCell).toBeFocused();
    const initialBoardLabel = await rovingCell.getAttribute("aria-label");
    await rovingCell.press("ArrowRight");
    const movedRovingCell = grid.locator('[role="gridcell"][tabindex="0"]');
    await expect(movedRovingCell).toBeFocused();
    expect(await movedRovingCell.getAttribute("aria-label")).not.toBe(initialBoardLabel);
    await movedRovingCell.press("Home");
    await expect(grid.locator('[role="gridcell"][tabindex="0"]')).toHaveCount(1);

    const resign = page.getByRole("button", { name: localeCopy.resign, exact: true });
    await resign.click();
    const confirmation = page.getByRole("alertdialog", { name: localeCopy.resignTitle });
    await expect(confirmation).toBeVisible();
    const modalButtons = confirmation.getByRole("button");
    const cancel = confirmation.getByRole("button", { name: localeCopy.cancel, exact: true });
    await expect(cancel).toBeFocused();
    await cancel.press("Shift+Tab");
    await expect(modalButtons.first()).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(modalButtons.last()).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(modalButtons.first()).toBeFocused();
    await expect(page.locator(".focused-game-shell")).toHaveAttribute("aria-hidden", "true");
    expect(await page.locator(".focused-game-shell").evaluate((element) =>
      (element as HTMLElement).inert,
    )).toBe(true);
    await page.keyboard.press("Escape");
    await expect(confirmation).toBeHidden();
    await expect(resign).toBeFocused();

    const touchProject = testInfo.project.name.endsWith("-touch");
    if (touchProject) {
      await grid.evaluate((element) => element.scrollIntoView({ block: "start" }));
      const overviewBoard = await page.locator(".go-board").boundingBox();
      expect(overviewBoard).not.toBeNull();
      if (!overviewBoard) return;

      await page.touchscreen.tap(
        overviewBoard.x + overviewBoard.width / 2,
        overviewBoard.y + overviewBoard.height / 2,
      );
      await expect(page.locator(".go-board-shell")).toHaveAttribute("data-precision", "true");
      const firstPreview = page.getByRole("gridcell", { selected: true });
      await expect(firstPreview).toHaveCount(1);
      await expect(firstPreview).toBeFocused();
      await expect(firstPreview).toHaveAttribute("tabindex", "0");
      expect(harness.moveBodies).toEqual([]);

      const showWholeBoard = page.getByRole("button", { name: localeCopy.showWholeBoard });
      await expectControlInsideViewport(page, page.locator(".precision-placement-toolbar"), false);
      await expectControlInsideViewport(page, showWholeBoard, false);
      await showWholeBoard.focus();
      await showWholeBoard.press("Enter");
      await expect(page.locator(".go-board-shell")).toHaveAttribute("data-precision", "false");
      await expect(page.locator('[role="gridcell"]:focus')).toHaveCount(1);

      const resetBoard = await page.locator(".go-board").boundingBox();
      expect(resetBoard).not.toBeNull();
      if (!resetBoard) return;
      await page.touchscreen.tap(
        resetBoard.x + resetBoard.width / 2,
        resetBoard.y + resetBoard.height / 2,
      );
      const preview = page.getByRole("gridcell", { selected: true });
      await expect(preview).toHaveCount(1);
      await expect(preview).toBeFocused();
      await expect(preview).toHaveAttribute("tabindex", "0");
      expect(harness.moveBodies).toEqual([]);
      const differentPreview = grid.getByRole("gridcell").first();
      await differentPreview.tap();
      await expect(differentPreview).toHaveAttribute("aria-selected", "true");
      await expect(differentPreview).toBeFocused();
      await expect(differentPreview).toHaveAttribute("tabindex", "0");
      expect(harness.moveBodies).toEqual([]);
      await differentPreview.tap();
    } else {
      const firstIntersection = grid.getByRole("gridcell").first();
      await firstIntersection.focus();
      if (testInfo.project.name === "chromium-1024") {
        await firstIntersection.click();
      } else {
        await firstIntersection.press("Enter");
      }
      await expect(firstIntersection).toBeFocused();
    }

    await expect.poll(() => harness.moveBodies.length).toBe(1);
    expect(harness.moveBodies[0]).toEqual({ x: 0, y: 0, expectedVersion: 0 });
    await expect(page.getByText(localeCopy.opponentTurn, { exact: true }).first()).toBeVisible();
    await expect.poll(
      () => harness.gameReadVersions.filter((version) => version === 1).length,
      { timeout: 4_000 },
    ).toBeGreaterThan(0);
    await expectNoDocumentOverflow(page);
    await expectCleanHarness(harness);
  });
}

for (const locale of ["en", "de"] as const) {
  test(`${locale.toUpperCase()} mobile disclosure follows real keyboard focus`, async ({ page }) => {
    const width = page.viewportSize()?.width ?? Number.POSITIVE_INFINITY;
    test.skip(width > 840, "The desktop projects use the persistent sidebar.");
    await page.setViewportSize({ width, height: 360 });
    const harness = await installApiHarness(page);
    const localeCopy = copy[locale];
    const playPath = locale === "en" ? "/play?size=19" : "/de/play?size=19";
    const learnDestination = locale === "en"
      ? "/register?returnTo=%2Flearn"
      : "/de/register?returnTo=%2Flearn";

    await page.goto(playPath);
    const menuButton = page.locator(".mobile-nav > .icon-button");
    const mobileNavigation = page.getByRole("navigation", {
      name: localeCopy.mobileNavigation,
    });
    await menuButton.focus();
    await menuButton.press("Enter");
    await expect(menuButton).toHaveAttribute("aria-expanded", "true");
    await expect(mobileNavigation).toBeVisible();

    const menuControls = mobileNavigation.locator('a[href], button:not([disabled])');
    const menuControlCount = await menuControls.count();
    expect(menuControlCount).toBeGreaterThan(1);
    await page.keyboard.press("Tab");
    for (let index = 0; index < menuControlCount; index += 1) {
      const activeControl = page.locator(":focus");
      await expect(activeControl).toHaveCount(1);
      expect(await activeControl.evaluate((element) =>
        Boolean(element.closest(".mobile-menu")),
      )).toBe(true);
      await expectControlInsideViewport(page, activeControl, false, 24);
      if (index < menuControlCount - 1) await page.keyboard.press("Tab");
    }

    await page.keyboard.press("Tab");
    await expect(mobileNavigation).toBeHidden();
    await expect(menuButton).toHaveAttribute("aria-expanded", "false");
    const focusAfterMenu = page.locator(":focus");
    await expect(focusAfterMenu).toHaveCount(1);
    expect(await focusAfterMenu.evaluate((element) =>
      !Boolean(element.closest(".mobile-nav")),
    )).toBe(true);
    await expectControlInsideViewport(page, focusAfterMenu, false);

    await menuButton.focus();
    await menuButton.press("Enter");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(menuButton).toBeFocused();
    await expect(mobileNavigation).toBeVisible();
    await page.keyboard.press("Shift+Tab");
    expect(await page.locator(":focus").evaluate((element) =>
      Boolean(element.closest(".mobile-nav")),
    )).toBe(true);
    await expect(mobileNavigation).toBeVisible();
    await page.keyboard.press("Shift+Tab");
    await expect(mobileNavigation).toBeHidden();
    await expect(page.getByRole("link", { name: localeCopy.skipToContent })).toBeFocused();

    await menuButton.focus();
    await menuButton.press("Enter");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Escape");
    await expect(mobileNavigation).toBeHidden();
    await expect(menuButton).toBeFocused();

    await menuButton.click();
    await expect(mobileNavigation).toBeVisible();
    await menuButton.click();
    await expect(mobileNavigation).toBeHidden();
    await expect(menuButton).toBeFocused();

    await menuButton.press("Enter");
    const learnLink = mobileNavigation.getByRole("link", { name: localeCopy.learn, exact: true });
    await learnLink.focus();
    await learnLink.press("Enter");
    await expect(page).toHaveURL(`${ORIGIN}${learnDestination}`);
    await expect(mobileNavigation).toBeHidden();
    await expectCleanHarness(harness);
  });

  test(`${locale.toUpperCase()} game loading and unavailable states expose keyboard skip navigation`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-1024", "One desktop project covers transient game shells.");
    const localeCopy = copy[locale];
    const gamePath = locale === "en" ? `/game/${GAME_ID}` : `/de/game/${GAME_ID}`;
    const harness = await installApiHarness(page, {
      guestUnavailable: true,
      holdSession: true,
    });

    await page.goto(gamePath);
    await harness.sessionRequested;
    await expect(page.locator('main#main-content[aria-busy="true"]')).toBeVisible();
    await expectKeyboardSkipLink(page, localeCopy.skipToContent);

    harness.releaseSession();
    await expect(page.getByRole("heading", { name: localeCopy.unavailable })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: localeCopy.unavailable })).toBeVisible();
    await expectKeyboardSkipLink(page, localeCopy.skipToContent);
    await expectCleanHarness(harness);
  });
}

test("language switch preserves the play route, query, and fragment", async ({ page }, testInfo) => {
  test.skip(
    !["chromium-320-touch", "chromium-1024"].includes(testInfo.project.name),
    "One touch and one desktop project cover the real locale switch.",
  );
  const harness = await installApiHarness(page, { realLocaleMutation: true });

  await page.goto("/play?size=19&source=browser#queue");
  let languageMenu = page.getByRole("button", { name: "Choose language: English" });
  if (testInfo.project.name === "chromium-320-touch") {
    const mobileNavigation = page.getByRole("navigation", { name: "Mobile navigation" });
    await page.locator(".mobile-nav > .icon-button").click();
    await expect(mobileNavigation).toBeVisible();
    languageMenu = mobileNavigation.getByRole("button", { name: "Choose language: English" });
  }
  await languageMenu.click();
  const localeResponse = page.waitForResponse((response) =>
    response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/locale",
  );
  await page.getByRole("menuitemradio", { name: "Deutsch" }).click();
  const response = await localeResponse;
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  await expect(page).toHaveURL(`${ORIGIN}/de/play?size=19&source=browser#queue`);
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(page.getByRole("button", { name: /19×19/ })).toHaveAttribute("aria-pressed", "true");
  await expectNoDocumentOverflow(page);
  await expectCleanHarness(harness);
});

test("locale preference survives a rejected oversized mutation", async ({ page }, testInfo) => {
  test.skip(
    !["chromium-320-touch", "chromium-1024"].includes(testInfo.project.name),
    "One touch and one desktop project cover the real locale boundary.",
  );
  const address = testInfo.project.name === "chromium-320-touch"
    ? "203.0.113.230"
    : "203.0.113.231";
  const requestHeaders = {
    "Content-Type": "application/json",
    "x-real-ip": address,
  };
  const saved = await page.request.post(`${ORIGIN}/api/locale`, {
    data: { locale: "de" },
    headers: requestHeaders,
  });
  expect(saved.status()).toBe(200);
  expect(await saved.json()).toEqual({ ok: true, locale: "de" });
  const setCookie = saved.headers()["set-cookie"] ?? "";
  expect(setCookie).toMatch(/^gostone_locale=de;/);
  expect(setCookie).toMatch(/Path=\//);
  expect(setCookie).toMatch(/Max-Age=31536000/);
  expect(setCookie).toMatch(/Secure/i);
  expect(setCookie).toMatch(/HttpOnly/i);
  expect(setCookie).toMatch(/SameSite=lax/i);

  // The production cookie is Secure, while this isolated browser server is
  // intentionally HTTP. Mirror the validated preference in its local jar so
  // the remaining journey can prove rejection and remembered routing.
  await page.context().addCookies([{
    domain: "127.0.0.1",
    httpOnly: true,
    name: "gostone_locale",
    path: "/",
    sameSite: "Lax",
    secure: false,
    value: "de",
  }]);
  const browserCookie = (await page.context().cookies(ORIGIN))
    .find(({ name }) => name === "gostone_locale");
  expect(browserCookie).toMatchObject({
    httpOnly: true,
    name: "gostone_locale",
    path: "/",
    sameSite: "Lax",
    secure: false,
    value: "de",
  });

  const rejected = await page.request.post(`${ORIGIN}/api/locale`, {
    data: { locale: "en", padding: "x".repeat(1_024) },
    headers: requestHeaders,
  });
  expect(rejected.status()).toBe(400);
  expect(rejected.headers()["set-cookie"]).toBeUndefined();
  expect(await rejected.json()).toMatchObject({ ok: false, code: "invalid_locale" });
  expect((await page.context().cookies(ORIGIN)).find(
    ({ name }) => name === "gostone_locale",
  )?.value).toBe("de");

  const harness = await installApiHarness(page);
  await page.goto("/?source=remembered&tag=a&tag=b#landing");
  await expect(page).toHaveURL(`${ORIGIN}/de?source=remembered&tag=a&tag=b#landing`);
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expectNoDocumentOverflow(page);
  await expectCleanHarness(harness);
});
