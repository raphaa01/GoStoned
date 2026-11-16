import { registerGameReadabilityTests } from "../shared/gameReadabilityHarness";
import { expect, test } from "@playwright/test";
import { GAME_ID, gameFor, installHarness } from "../shared/boardDesignHarness";

registerGameReadabilityTests();

test("a denied chat request leaves an authorized online game playable", async ({ page }) => {
  const state = await installHarness(page);
  state.game = gameFor(9, "matchmaking");
  let chatDenied = false;
  await page.route(`**/api/games/${GAME_ID}/chat?*`, route => {
    chatDenied = true;
    return route.fulfill({ status: 403, json: { ok: false, code: "chat_not_participant" } });
  });
  await page.goto(`/de/game/${GAME_ID}`);
  await expect.poll(() => chatDenied).toBe(true);
  await page.locator(".go-board .intersection").nth(40).click();
  await expect.poll(() => state.moves.length).toBe(1);
});
