import { expect, test, type Page } from "@playwright/test";

const PLAYER_KEY = "guest:11111111-1111-4111-8111-111111111111";
const PUZZLE_ID = "44444444-4444-4444-8444-444444444444";

function dailyBoard() {
  const board = Array.from({ length: 13 }, () => Array<"black" | "white" | null>(13).fill(null));
  board[10][1] = "black";
  board[10][2] = "white";
  board[11][1] = "white";
  return board;
}

async function installDailyPuzzleHarness(page: Page) {
  const attempts: unknown[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const fulfill = (body: unknown, status = 200) => route.fulfill({
      body: JSON.stringify(body),
      contentType: "application/json; charset=utf-8",
      headers: { "Cache-Control": "no-store" },
      status,
    });

    if (request.method() === "GET" && url.pathname === "/api/auth/session") {
      await fulfill({ ok: true, user: null });
      return;
    }
    if (request.method() === "POST" && url.pathname === "/api/auth/guest") {
      await fulfill({
        ok: true,
        identity: { playerKey: PLAYER_KEY, displayName: "Guest E2E" },
      }, 201);
      return;
    }
    if (request.method() === "GET" && url.pathname === "/api/puzzles") {
      await fulfill({
        ok: true,
        actor: PLAYER_KEY,
        status: "ready",
        mode: "daily",
        puzzles: [{
          id: PUZZLE_ID,
          kind: "daily",
          category: null,
          rankKyu: 20,
          collectionOrder: 22,
          dailyDate: "2026-09-29",
          boardSize: 13,
          toPlay: "black",
          board: dailyBoard(),
          difficulty: "intermediate",
          publishedAt: "2026-09-29T00:00:00.000Z",
          attemptCount: 0,
          solved: false,
          firstAttemptCorrect: null,
          variationProgress: [],
          variationRevision: 0,
          solution: null,
        }],
        expectedPerCategory: 10,
        categoryCounts: {
          life_and_death: 0,
          tesuji: 0,
          capturing_race: 0,
          endgame: 0,
          gokyo_life: 0,
          gokyo_death: 0,
          gokyo_ko: 0,
        },
        dailyCycleLength: 40,
      });
      return;
    }
    if (
      request.method() === "POST"
      && url.pathname === `/api/puzzles/${PUZZLE_ID}/attempt`
    ) {
      attempts.push(request.postDataJSON());
      await fulfill({
        ok: true,
        actor: PLAYER_KEY,
        attempt: {
          puzzleId: PUZZLE_ID,
          correct: true,
          outcome: "solved",
          solved: true,
          attemptCount: 1,
          firstAttemptCorrect: true,
          variationProgress: [],
          variationRevision: 1,
          displayLine: [],
          feedback: null,
          solution: {
            move: "A13",
            x: 0,
            y: 0,
            explanation: { de: "Richtig.", en: "Correct." },
            line: [{ color: "black", move: "A13", x: 0, y: 0 }],
          },
        },
      });
      return;
    }

    await fulfill({ ok: false, code: "not_found", error: "Unexpected test request." }, 404);
  });
  return attempts;
}

test("daily 13x13 puzzles use the offset press-and-drag touch lens", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.endsWith("-touch"), "Touch interaction is mobile-only.");
  const attempts = await installDailyPuzzleHarness(page);
  await page.goto("/de/puzzles");

  const board = page.locator('.go-board[data-size="13"]');
  await expect(board).toBeVisible();
  await board.evaluate((element) => element.scrollIntoView({ block: "center" }));
  const boardBounds = await board.boundingBox();
  const firstIntersection = board.getByRole("gridcell").first();
  const firstIntersectionBounds = await firstIntersection.boundingBox();
  expect(boardBounds).not.toBeNull();
  expect(firstIntersectionBounds).not.toBeNull();
  if (!boardBounds || !firstIntersectionBounds) return;

  const touchX = boardBounds.x + boardBounds.width / 2;
  const touchY = boardBounds.y + boardBounds.height / 2;
  const touchSession = await page.context().newCDPSession(page);
  await touchSession.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: touchX, y: touchY }],
  });

  const magnifier = page.locator(".touch-magnifier");
  await expect(magnifier).toBeVisible();
  const magnifierBounds = await magnifier.boundingBox();
  expect(magnifierBounds).not.toBeNull();
  expect(
    magnifierBounds
      ? magnifierBounds.y + magnifierBounds.height <= touchY - 48
        || magnifierBounds.y >= touchY + 48
      : false,
  ).toBe(true);

  await touchSession.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{
      x: firstIntersectionBounds.x + firstIntersectionBounds.width / 2,
      y: firstIntersectionBounds.y + firstIntersectionBounds.height / 2,
    }],
  });
  await expect(firstIntersection).toHaveAttribute("aria-selected", "true");
  await touchSession.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await touchSession.detach();

  await expect.poll(() => attempts.length).toBe(1);
  expect(attempts[0]).toEqual({ x: 0, y: 0, revision: 0 });
});
