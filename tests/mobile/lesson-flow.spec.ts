import { expect, test, type Page } from "@playwright/test";
import { installHarness, assertNoOverflow } from "../shared/boardDesignHarness";
import { emptyLearnProgress, LEARN_LESSON_IDS } from "../../lib/learn/progress";
import { lessonById, line, type LearnLesson } from "../../lib/learn/curriculum";
import { continuesOwnTurn } from "../../lib/learn/lessonFlow";

async function openLesson(page: Page, id: LearnLesson["id"]) {
  await installHarness(page);
  const index = LEARN_LESSON_IDS.indexOf(id as typeof LEARN_LESSON_IDS[number]);
  const progress = { ...emptyLearnProgress(), completedLessonIds: LEARN_LESSON_IDS.slice(0, index),
    currentLessonId: id, updatedAt: new Date().toISOString() };
  await page.route("**/api/learn/progress", async (route) => route.fulfill({ json: { ok: true, progress } }));
  await page.goto("/de/learn");
  await expect(page.locator(".mobile-splash")).toHaveAttribute("aria-hidden", "true");
  await page.locator(".learn-next-dock__button").click();
  return lessonById(id);
}

for (const id of ["s4-ladder", "s4-net", "s4-snapback", "s2-ko", "s3-challenge"] as const) {
  test(`${id}: own turns stay the same colour, replies are automatic, Continue only changes tasks`, async ({ page }) => {
    const lesson = await openLesson(page, id);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const player = page.locator(".learn-player");
    const learnerColor = lesson.steps.find((step) => step.kind === "play" || step.kind === "illegal")!.toPlay;
    for (const [index, step] of lesson.steps.entries()) {
      await expect(player).toHaveAttribute("data-step-id", step.id);
      if (step.kind === "info") {
        await expect(player.locator('.learn-player__step-mode[data-mode="info"]')).toBeVisible();
        await page.getByRole("button", { name: "Weiter", exact: true }).click();
        continue;
      }
      await expect(player.locator('.learn-player__step-mode[data-mode="action"]')).toBeVisible();
      if (step.kind === "play" || step.kind === "illegal") {
        await expect(player).toHaveAttribute("data-player-color", learnerColor!);
        await expect(player.locator(".learn-player__step-mode")).toContainText(learnerColor === "black" ? "Du spielst Schwarz." : "Du spielst Weiß.");
      }
      const count = step.kind === "select" ? step.selectionCount ?? step.targets!.length : 1;
      for (const point of step.targets!.slice(0, count)) await page.getByRole("gridcell").nth(point.y * step.size! + point.x).click();
      await expect(page.getByRole("button", { name: /^Nächsten Zug zeigen/ })).toHaveCount(0);
      if (continuesOwnTurn(step, lesson.steps[index + 1])) {
        await expect(player).toHaveAttribute("data-step-id", lesson.steps[index + 1].id);
        await expect(player.locator('.learn-player__step-mode[data-mode="action"]')).toBeVisible();
        await expect(player.locator(".learn-player__next")).toBeDisabled();
        await expect(player.locator(".learn-teacher__speech")).toContainText(line(step.success!, "de"));
      } else {
        await expect(player).toHaveAttribute("data-step-id", step.id);
        await expect(player.locator('.learn-player__step-mode[data-mode="solved"]')).toBeVisible();
        const next = page.getByRole("button", { name: index === lesson.steps.length - 1 ? "Lektion abschließen" : "Weiter", exact: true });
        await expect(next).toBeEnabled();
        await next.click();
      }
    }
    await expect(page.locator(".learn-player")).toHaveCount(0);
    await assertNoOverflow(page);
    expect(errors).toEqual([]);
  });
}

test("commented game shows the first opponent reply, then exactly one trainer ply per click", async ({ page }) => {
  const lesson = await openLesson(page, "s5-commented-game");
  const decisions = lesson.steps.filter((step) => step.kind === "play");
  for (const [index, step] of decisions.entries()) {
    await expect(page.locator(".learn-player")).toHaveAttribute("data-step-id", step.id);
    const point = step.targets![0];
    await page.getByRole("gridcell").nth(point.y * 9 + point.x).click();
    const remaining = step.replies!.length - 1;
    if (!remaining) continue; // next own decision is already interactive
    const reveal = page.getByRole("button", { name: /^Nächsten Zug zeigen/ });
    await expect(page.locator(".interactive-learn-board__point.has-stone")).toHaveCount((index + 1) * 2);
    for (let reply = 1; reply < step.replies!.length; reply++) {
      await expect(reveal).toHaveText(new RegExp(`${reply + 1}/${step.replies!.length}`));
      await expect(page.locator('.learn-player__step-mode[data-mode="info"]')).toBeVisible();
      const stones = await page.locator(".interactive-learn-board__point.has-stone").count();
      await reveal.click();
      await expect(page.locator(".interactive-learn-board__point.has-stone")).toHaveCount(stones + Number(step.replies![reply] !== null));
    }
    await expect(reveal).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Weiter", exact: true })).toBeEnabled();
  }
});
