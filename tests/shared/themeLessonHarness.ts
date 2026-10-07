import { expect, test } from "@playwright/test";
import { installHarness, assertNoOverflow } from "./boardDesignHarness";
import { emptyLearnProgress, LEARN_LESSON_IDS } from "../../lib/learn/progress";

export function registerThemeLessonTests(mobile: boolean) {
  test("light is the default and explicit dark/system choices persist", async ({ page }) => {
    await installHarness(page);
    await page.emulateMedia({ colorScheme: "dark" });
    const attribute = mobile ? "data-mobile-theme" : "data-theme";
    await page.goto("/de/profile/settings");
    await expect(page.locator("html")).toHaveAttribute(attribute, "light");
    await expect(page.getByRole("button", { name: "Lightmode", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Darkmode", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute(attribute, "dark");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute(attribute, "dark");
    await page.getByRole("button", { name: "System", exact: true }).click();
    await page.reload();
    await expect(page.getByRole("button", { name: "System", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveAttribute(attribute, "light");
  });

  test("life and death reveals each teaching move before the capture", async ({ page }, info) => {
    await installHarness(page);
    const progress = { ...emptyLearnProgress(), completedLessonIds: LEARN_LESSON_IDS.slice(0, 23),
      currentLessonId: "s3-life-death", lastStepByLesson: { "s3-life-death": 1 }, updatedAt: new Date().toISOString() };
    await page.route("**/api/learn/progress", async (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, progress }) }));
    await page.goto("/de/learn");
    await page.locator(".learn-next-dock__button").click();
    await expect(page.getByRole("heading", { name: "Leben oder Tod?", exact: true })).toBeVisible();
    const board = page.locator(".interactive-learn-board");
    await expect(board.locator(".is-black.has-stone")).toHaveCount(12);
    await board.getByRole("gridcell").nth(24).click();
    await expect(board.locator(".is-black.has-stone")).toHaveCount(12);
    await expect(board.locator(".is-white.has-stone")).toHaveCount(21);
    await expect(board.locator('[aria-disabled="false"]')).toHaveCount(0);
    const reveal = page.getByRole("button", { name: /^Nächsten Zug zeigen/ });
    await expect(reveal).toHaveText(/1\/2/);
    await reveal.click();
    await expect(board.locator(".is-black.has-stone")).toHaveCount(13);
    await expect(board.locator(".is-last")).toHaveAttribute("aria-label", /Schwarzer Stein/);
    await expect(reveal).toHaveText(/2\/2/);
    await page.getByRole("button", { name: "Neu starten", exact: true }).click();
    await expect(board.locator(".is-black.has-stone")).toHaveCount(12);
    await expect(board.locator(".is-white.has-stone")).toHaveCount(20);
    await board.getByRole("gridcell").nth(24).click();
    await reveal.click();
    await reveal.click();
    await expect(board.locator(".is-black.has-stone")).toHaveCount(0);
    await expect(board.locator(".is-white.has-stone")).toHaveCount(22);
    await expect(page.getByRole("button", { name: "Lektion abschließen", exact: true })).toBeEnabled();
    await expect(page.locator(".learn-player__feedback")).toContainText("Deshalb verschwinden sie");
    await assertNoOverflow(page);
    await page.screenshot({ path: `.cache/lesson-capture-${info.project.name}.png` });
  });
}
