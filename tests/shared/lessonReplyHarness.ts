import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { installHarness } from "./boardDesignHarness";
import { emptyLearnProgress, LEARN_LESSON_IDS, type LearnLessonId } from "../../lib/learn/progress";

export function registerLessonReplyTests(mobile: boolean) {
  async function openLesson(page: Page, id: LearnLessonId, initialStep = 1) {
    if (!mobile) {
      // The website's server-side gate requires a real disposable PostgreSQL session.
      const identity = crypto.randomUUID().replaceAll("-", "");
      const registered = await page.request.post("/api/auth/register", { headers: { "x-gostone-community-rules": "2026-10-30" }, data: {
        username: `reply_${identity.slice(0, 12)}`, email: `${identity}@example.test`, password: crypto.randomUUID(),
        startingStrength: "unspecified", knownRank: null, boardPlacement: "direct",
      } });
      expect(registered.status()).toBe(201);
    }
    await installHarness(page);
    const progress = { ...emptyLearnProgress(), completedLessonIds: LEARN_LESSON_IDS.slice(0, LEARN_LESSON_IDS.indexOf(id)),
      currentLessonId: id, lastStepByLesson: { [id]: initialStep }, updatedAt: new Date().toISOString() };
    await page.route("**/api/learn/progress", route => route.fulfill({ json: { ok: true, progress } }));
    await page.clock.install({ time: new Date("2026-10-25T12:00:00Z") });
    await page.goto("/de/learn");
    if (mobile) await expect(page.locator(".mobile-splash")).toHaveAttribute("aria-hidden", "true");
    await page.locator(".learn-next-dock__button").click();
    await expect(page.locator(".interactive-learn-board")).toBeVisible();
    await page.clock.pauseAt(new Date("2026-10-25T12:01:00Z"));
  }

  test("throw-in stays visible for two seconds before capture and the recapture stays immediate", async ({ page }, info) => {
    await openLesson(page, "s4-throw-in");
    const player = page.locator(".learn-player");
    const stone = page.getByRole("gridcell").nth(1);
    const reply = page.getByRole("gridcell").nth(0);
    await stone.click();
    await expect(stone).toHaveClass(/has-stone is-black/);
    await expect(player).toHaveAttribute("data-step-id", "throw-0");
    await expect(player.locator(".learn-player__step-mode")).toHaveAttribute("data-mode", "reply");
    await expect(player.locator(".learn-player__next")).toBeDisabled();
    await expect(player.locator('[role="gridcell"][aria-disabled="false"]')).toHaveCount(0);
    // A second pointer event during the pause cannot add or consume another move.
    await page.getByRole("gridcell").nth(24).click({ force: true });
    await expect(page.getByRole("gridcell").nth(24)).not.toHaveClass(/has-stone/);
    await page.clock.runFor(1_999);
    await expect(stone).toHaveClass(/has-stone is-black/);
    await expect(reply).not.toHaveClass(/has-stone/);
    await mkdir(".cache/visual-audit", { recursive: true });
    const artifact = `.cache/visual-audit/lesson-reply-${mobile ? "app" : "web"}-${info.project.name}`;
    await page.screenshot({ path: `${artifact}-before.png`, fullPage: true, animations: "disabled" });
    await page.clock.runFor(1);
    await expect(stone).not.toHaveClass(/has-stone/);
    await expect(reply).toHaveClass(/has-stone is-white/);
    await expect(player).toHaveAttribute("data-step-id", "throw-1");
    await expect(player.locator(".learn-player__step-mode")).toHaveAttribute("data-mode", "action");
    await page.screenshot({ path: `${artifact}-after.png`, fullPage: true, animations: "disabled" });
    // This decision has no authored reply, so no additional delay is introduced.
    await stone.click();
    await expect(stone).toHaveClass(/has-stone is-black/);
    await expect(player.locator(".learn-player__step-mode")).toHaveAttribute("data-mode", "solved");
    await expect(player.locator(".learn-player__next")).toBeEnabled();
  });

  test("restart and leaving the lesson cancel the delayed reply", async ({ page }) => {
    await openLesson(page, "s4-throw-in");
    const player = page.locator(".learn-player");
    const stone = page.getByRole("gridcell").nth(1);
    const restart = page.getByRole("button", { name: "Neu starten", exact: true });
    await stone.click();
    await page.clock.runFor(1_000);
    await restart.click();
    await page.clock.runFor(1_000);
    await expect(stone).not.toHaveClass(/has-stone/);
    await expect(player.locator(".learn-player__step-mode")).toHaveAttribute("data-mode", "action");
    await stone.click();
    await page.clock.runFor(1_000);
    await expect(stone).toHaveClass(/has-stone is-black/);
    await page.getByRole("button", { name: "Lernpfad", exact: true }).click();
    await page.locator(".learn-next-dock__button").click();
    await page.clock.runFor(3_000);
    await expect(stone).not.toHaveClass(/has-stone/);
    await expect(player).toHaveAttribute("data-step-id", "throw-0");
    await expect(player.locator(".learn-player__step-mode")).toHaveAttribute("data-mode", "action");
    await stone.click();
    await page.clock.runFor(2_000);
    await expect(player).toHaveAttribute("data-step-id", "throw-1");
  });

  test("the first trainer reply is delayed while later demonstration moves remain manual", async ({ page }) => {
    await openLesson(page, "s3-life-death");
    const board = page.locator(".interactive-learn-board");
    await board.getByRole("gridcell").nth(24).click();
    await expect(board.locator(".is-black.has-stone")).toHaveCount(21);
    await expect(board.locator(".is-white.has-stone")).toHaveCount(12);
    const reveal = page.getByRole("button", { name: /^Nächsten Zug zeigen/ });
    await expect(reveal).toHaveCount(0);
    await page.clock.runFor(2_000);
    await expect(board.locator(".is-white.has-stone")).toHaveCount(13);
    await expect(reveal).toHaveText(/2\/2/);
    await page.clock.runFor(10_000);
    await expect(board.locator(".is-black.has-stone")).toHaveCount(21);
    await expect(board.locator(".is-white.has-stone")).toHaveCount(13);
    await reveal.click();
    await expect(board.locator(".is-white.has-stone")).toHaveCount(0);
    await expect(board.locator(".is-black.has-stone")).toHaveCount(22);
  });
}
