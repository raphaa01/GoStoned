import { expect, test } from "@playwright/test";
import { installHarness, assertNoOverflow, GAME_ID } from "../shared/boardDesignHarness";
import { registerThemeLessonTests } from "../shared/themeLessonHarness";

registerThemeLessonTests(true);

test("review has one complete frame in light and dark mode", async ({ page }, info) => {
  await installHarness(page);
  await page.route("**/api/profile", async (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, recentGames: [
    { gameId: GAME_ID, moveCount: 42, opponentName: "BambooShade", boardSize: 13, timeControl: "classic", result: "loss", gameResult: "W+19.5", finishedAt: new Date().toISOString(), rated: false },
  ] }) }));
  await page.goto("/review");
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => localStorage.setItem("gostone.mobile.theme.v1", value), theme);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-mobile-theme", theme);
    await expect(page.getByText("BambooShade", { exact: true })).toBeVisible();
    const picker = page.locator('section[class*="gamePicker"]');
    const borders = await picker.evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth];
    });
    expect(borders).toEqual(["1px", "1px", "1px", "1px"]);
    await assertNoOverflow(page);
    await expect(page.locator(".mobile-splash")).toHaveAttribute("aria-hidden", "true");
    await page.screenshot({ path: `.cache/review-frame-${theme}-${info.project.name}.png` });
  }
});
