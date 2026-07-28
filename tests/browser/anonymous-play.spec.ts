import { expect, test, type Locator, type Page, type Request, type Route } from "@playwright/test";
import type { GameState, StoredMove } from "../../lib/game/types";

const ORIGIN = "http://127.0.0.1:3100";
const EXPECTED_PLAYER_HEADER = "x-gostone-expected-player";
const PLAYER_KEY = "guest:11111111-1111-4111-8111-111111111111";
const OPPONENT_KEY = "guest:22222222-2222-4222-8222-222222222222";
const GAME_ID = "33333333-3333-4333-8333-333333333333";

const copy = {
  en: {
    cancel: "Cancel",
    findOpponent: "Find an opponent",
    languageChoice: "German",
    learn: "Learn",
    mobileNavigation: "Mobile navigation",
    openMenu: "Open menu",
    opponentTurn: "Opponent's turn",
    resign: "Resign",
    resignTitle: "Resign this game?",
    showWholeBoard: "Show whole board",
    skipToContent: "Skip to main content",
    unavailable: "Game unavailable",
    yourTurn: "Your turn",
  },
  de: {
    cancel: "Abbrechen",
    findOpponent: "Gegner finden",
    languageChoice: "Englisch",
    learn: "Lernen",
    mobileNavigation: "Mobile Navigation",
    openMenu: "Menü öffnen",
    opponentTurn: "Der Gegner ist am Zug",
    resign: "Aufgeben",
    resignTitle: "Diese Partie aufgeben?",
    showWholeBoard: "Ganzes Brett zeigen",
    skipToContent: "Zum Hauptinhalt springen",
    unavailable: "Partie nicht verfügbar",
    yourTurn: "Du bist am Zug",
  },
} as const;

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
  contractErrors: string[];
  diagnostics: BrowserDiagnostics;
  gameReadVersions: Array<number | null>;
  matchmakingBodies: unknown[];
  moveBodies: Array<{ expectedVersion: number; x: number; y: number }>;
  releaseSession: () => void;
  sessionRequested: Promise<void>;
};

type ApiHarnessOptions = {
  guestUnavailable?: boolean;
  holdSession?: boolean;
  realLocaleMutation?: boolean;
};

function blankBoard() {
  return Array.from({ length: 19 }, () => Array<null>(19).fill(null));
}

function createGame(): GameState {
  return {
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
    clock: {
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
    },
    turn: "black",
    moveCount: 0,
    board: blankBoard(),
    moves: [],
  };
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

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    body: JSON.stringify(body),
    contentType: "application/json; charset=utf-8",
    headers: { "Cache-Control": "no-store" },
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
  const harness: ApiHarness = {
    contractErrors: [],
    diagnostics,
    gameReadVersions: [],
    matchmakingBodies: [],
    moveBodies: [],
    releaseSession,
    sessionRequested,
  };
  const game = createGame();
  let matched = false;
  let clockTick = 1;

  const tickClock = () => {
    clockTick += 1;
    game.clock.serverNow = new Date(Date.UTC(2026, 0, 1, 0, 0, clockTick)).toISOString();
  };

  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => diagnostics.pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    const cancelledNextPrefetch = request.method() === "GET"
      && url.origin === ORIGIN
      && url.searchParams.has("_rsc")
      && request.failure()?.errorText === "net::ERR_ABORTED";
    if (cancelledNextPrefetch) return;
    diagnostics.requestFailures.push(
      `${requestName(request)}: ${request.failure()?.errorText ?? "unknown failure"}`,
    );
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      diagnostics.httpErrors.push(`${response.status()} ${requestName(response.request())}`);
    }
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
            ? { status: "matched", gameId: GAME_ID, boardSize: 19, timeControl: "rapid" }
            : { status: "idle", gameId: null, boardSize: null, timeControl: null },
        });
        return;
      }
      if (method === "POST") {
        recordJsonContentType(harness, request);
        const body = request.postDataJSON();
        harness.matchmakingBodies.push(body);
        if (JSON.stringify(body) !== JSON.stringify({ boardSize: 19, timeControl: "rapid" })) {
          harness.contractErrors.push(`${requestName(request)} sent ${JSON.stringify(body)}`);
        }
        matched = true;
        await fulfillJson(route, {
          ok: true,
          actor: PLAYER_KEY,
          matchmaking: { status: "matched", gameId: GAME_ID, boardSize: 19, timeControl: "rapid" },
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
        harness.gameReadVersions.push(knownVersion === null ? null : Number(knownVersion));
        tickClock();
        if (knownVersion !== null && Number(knownVersion) === game.version) {
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
      if (
        JSON.stringify(keys) !== JSON.stringify(["expectedVersion", "x", "y"])
        || body.expectedVersion !== game.version
        || !Number.isInteger(body.x)
        || !Number.isInteger(body.y)
      ) {
        harness.contractErrors.push(`${requestName(request)} sent ${JSON.stringify(body)}`);
      } else {
        const move = body as { expectedVersion: number; x: number; y: number };
        harness.moveBodies.push(move);
        game.board[move.y][move.x] = "black";
        const storedMove: StoredMove = {
          moveNumber: 1,
          color: "black",
          x: move.x,
          y: move.y,
          isPass: false,
          createdAt: "2026-01-01T00:00:03.000Z",
        };
        game.moves = [storedMove];
        game.moveCount = 1;
        game.turn = "white";
        game.version = 1;
        tickClock();
      }
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
  expect(harness.contractErrors, "API contract errors").toEqual([]);
  expect(harness.diagnostics.unexpectedApi, "unexpected API requests").toEqual([]);
  expect(harness.diagnostics.externalRequests, "external HTTP(S) requests").toEqual([]);
  expect(harness.diagnostics.pageErrors, "page errors").toEqual([]);
  expect(harness.diagnostics.consoleErrors, "console errors").toEqual([]);
  expect(harness.diagnostics.requestFailures, "failed browser requests").toEqual([]);
  expect(harness.diagnostics.httpErrors, "HTTP error responses").toEqual([]);
  expect(harness.diagnostics.webSockets, "WebSocket attempts").toEqual([]);
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
    const findOpponent = page.getByRole("button", { name: localeCopy.findOpponent });
    await expect(findOpponent).toBeEnabled();
    await expectControlInsideViewport(page, findOpponent);
    await expectNoDocumentOverflow(page);

    await findOpponent.click();
    await expect(page).toHaveURL(new RegExp(`${gamePath.replaceAll("/", "\\/")}$`));
    expect(harness.matchmakingBodies).toEqual([{ boardSize: 19, timeControl: "rapid" }]);

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
      expect(harness.moveBodies).toEqual([]);
      const differentPreview = grid.getByRole("gridcell").first();
      await differentPreview.tap();
      await expect(differentPreview).toHaveAttribute("aria-selected", "true");
      await expect(differentPreview).toBeFocused();
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
    expect(harness.moveBodies[0]).toEqual({ x: expect.any(Number), y: expect.any(Number), expectedVersion: 0 });
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
    const learnPath = locale === "en" ? "/learn" : "/de/learn";

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
    await expect(page).toHaveURL(`${ORIGIN}${learnPath}`);
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
  let languageButton = page.getByRole("button", { name: "German" });
  if (testInfo.project.name === "chromium-320-touch") {
    const mobileNavigation = page.getByRole("navigation", { name: "Mobile navigation" });
    await page.locator(".mobile-nav > .icon-button").click();
    await expect(mobileNavigation).toBeVisible();
    languageButton = mobileNavigation.getByRole("button", { name: "German" });
  }
  const localeResponse = page.waitForResponse((response) =>
    response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/locale",
  );
  await languageButton.click();
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
