import { expect, test, type Page } from "@playwright/test";
import { installHarness, USER, GAME_ID, assertNoOverflow } from "../shared/boardDesignHarness";
import { installLearningFixture } from "../shared/betaFixHarness";

async function installCompactFixture(page: Page) {
  await installHarness(page);
  await installLearningFixture(page);
  const requests = { profile: 0, stats: 0, puzzles: 0, attempts: 0 };
  const recentGames = Array.from({ length: 10 }, (_, index) => ({
    gameId: `${GAME_ID.slice(0, -1)}${index}`, boardSize: 9, timeControl: "blitz", opponentName: index ? `Player ${index}` : "AutumnGoban3",
    result: index % 2 ? "loss" : "win", gameResult: "B+R", rated: true, ratingChange: index % 2 ? -9 : 20,
    ratingBefore: 900, ratingAfter: 920, moveCount: 42, finishedAt: new Date().toISOString(),
  }));
  await page.route("**/api/profile", async (route) => {
    requests.profile++;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true,
      rating: { rating: 473, highestRating: 990, ratedGameCount: 46, ratingChange30Days: 113 }, preferences: { displayPreference: "both" }, recentGames,
      history: Array.from({ length: 16 }, (_, index) => ({ id: String(index), ratingBefore: 1000 - index * 30, ratingAfter: 990 - index * 30, result: "loss", recordedAt: new Date(Date.now() - (16 - index) * 86400000).toISOString() })),
    }) });
  });
  await page.route("**/api/stats", async (route) => {
    requests.stats++;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, observedAt: new Date().toISOString(),
      leaderboard: [{ position: 1, playerName: "AutumnGoban3", games: 24, wins: 15, rating: 1642, ratingDeviation: 58 }],
    }) });
  });
  await page.route("**/api/friends", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, dashboard: { friends: [], requests: [], invites: [] } }) }));
  await page.route("**/api/matchmaking", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, actor: USER.playerKey, matchmaking: { status: "idle" } }) }));
  await page.route("**/api/puzzles**", async (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/attempt")) {
      requests.attempts++;
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, actor: USER.playerKey, attempt: {
        puzzleId: GAME_ID, outcome: "continue", solved: false, attemptCount: 1, firstAttemptCorrect: true,
        variationProgress: [{ x: 2, y: 2, color: "black", move: "C7" }], variationRevision: 1, solution: null, displayLine: [],
      } }) });
    }
    requests.puzzles++;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, actor: USER.playerKey, status: "ready", mode: "daily", expectedPerCategory: 1,
      categoryCounts: {}, puzzles: [{ id: GAME_ID, kind: "daily", category: null, dailyDate: new Date().toISOString().slice(0, 10), boardSize: 9, toPlay: "black",
        board: Array.from({ length: 9 }, () => Array(9).fill(null)), difficulty: "beginner", attemptCount: requests.attempts,
        publishedAt: new Date().toISOString(), solved: false, firstAttemptCorrect: null, variationProgress: requests.attempts ? [{ x: 2, y: 2, color: "black", move: "C7" }] : [], variationRevision: requests.attempts, solution: null,
      }],
    }) });
  });
  return requests;
}

test("returning to daily puzzle, leaderboard, review and profile reuses reads; moves invalidate puzzle progress", async ({ page }) => {
  const requests = await installCompactFixture(page);
  await page.goto("/");
  await expect(page.getByText("AutumnGoban3", { exact: true })).toBeVisible();
  const tabs = page.locator(".mobile-tab-bar");
  await tabs.getByRole("link", { name: "Puzzles", exact: true }).click();
  await expect(page.locator(".go-board")).toBeVisible();
  await tabs.getByRole("link", { name: "Home", exact: true }).click();
  await tabs.getByRole("link", { name: "Puzzles", exact: true }).click();
  await expect(page.locator(".go-board")).toBeVisible();
  expect(requests.puzzles).toBe(1);
  await page.locator(".intersection").nth(20).click();
  await expect.poll(() => requests.attempts).toBe(1);
  await tabs.getByRole("link", { name: "Home", exact: true }).click();
  await tabs.getByRole("link", { name: "Puzzles", exact: true }).click();
  await expect(page.locator(".stone--black")).toHaveCount(1);
  expect(requests.puzzles).toBe(2);
  for (let visit = 0; visit < 2; visit++) {
    await tabs.getByRole("link", { name: "Leaderboard", exact: true }).click();
    await expect(page.locator(".leaderboard-player-name")).toHaveText("AutumnGoban3");
    await tabs.getByRole("link", { name: "Review", exact: true }).click();
    await expect(page.getByText("AutumnGoban3", { exact: true })).toBeVisible();
  }
  await tabs.getByRole("link", { name: "Home", exact: true }).click();
  await page.locator(".mobile-profile-button").click();
  await expect(page.locator(".profile-rating-band")).toBeVisible();
  expect(requests.profile).toBe(1);
  expect(requests.stats).toBe(1);
});

for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 1366 }, { width: 1366, height: 1024 }]) {
  test(`all app destinations fit ${viewport.width}×${viewport.height} in light and dark`, async ({ page }, info) => {
    test.skip(info.project.name !== "mobile-390-touch", "One touch-device sweep covers phone and tablet orientations.");
    test.setTimeout(90000);
    await page.setViewportSize(viewport);
    await installCompactFixture(page);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const theme of ["light", "dark"]) {
      await page.addInitScript((value) => localStorage.setItem("gostone.mobile.theme.v1", value), theme);
      for (const route of ["/", "/play", "/puzzles", "/learn", "/review", "/leaderboard", "/profile", "/profile/settings", "/friends"]) {
        await page.goto(route);
        await expect(page.locator(".mobile-splash")).toHaveAttribute("aria-hidden", "true");
        await assertNoOverflow(page);
        const outside = await page.locator("main :is(h1,h2,.profile-metrics article,.play-board-preview,.time-selector,.leaderboard-table)").evaluateAll((elements) => elements.filter((element) => {
          const box = element.getBoundingClientRect();
          return box.width && (box.x < -1 || box.right > innerWidth + 1);
        }).map((element) => element.className));
        expect(outside, route).toEqual([]);
        if (route === "/play") {
          const board = (await page.locator(".play-board-preview").boundingBox())!;
          const time = (await page.locator(".time-selector").boundingBox())!;
          expect(board.x + board.width <= time.x || board.y + board.height <= time.y, "board and time selector must not overlap").toBe(true);
          if (viewport.width >= 760) expect(board.width).toBeGreaterThan(300);
        }
        if (route === "/") {
          await expect(page.getByText("Find the strongest move on the board.")).toHaveCount(0);
          const actions = (await page.locator(".mobile-home-actions").boundingBox())!;
          expect(actions.height).toBeLessThan(210);
        }
        if (["/", "/play", "/profile", "/review"].includes(route)) await page.screenshot({ path: `.cache/compact-${route.replaceAll("/", "") || "home"}-${theme}-${viewport.width}.png` });
      }
    }
    expect(errors).toEqual([]);
  });
}
