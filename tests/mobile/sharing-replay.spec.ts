import { registerSharingReplayTests } from "../shared/sharingReplayHarness";
import { expect, test } from "@playwright/test";
import { GAME_ID, USER, gameFor, installHarness } from "../shared/boardDesignHarness";
registerSharingReplayTests(true);

for (const platform of ["android", "ios"] as const) for (const unavailable of [false, true]) {
  test(`${platform}: native sharing ${unavailable ? "falls back to the public link" : "receives the public HTTPS replay link"}`, async ({ page }) => {
    const state = await installHarness(page);
    state.game = { ...gameFor(9, "friendly"), status: "finished", winnerKey: USER.playerKey,
      result: "B+R", finishReason: "resignation", finishedAt: new Date().toISOString(), turn: null };
    await page.addInitScript(({ platform, unavailable }) => {
      const calls: unknown[] = [];
      Object.defineProperty(window, "shareCalls", { value: calls });
      if (platform === "android") Object.defineProperty(window, "androidBridge", { value: {} });
      else Object.defineProperty(window, "webkit", { value: { messageHandlers: { bridge: { postMessage: () => undefined }, gostoneChrome: { postMessage: () => undefined } } } });
      Object.defineProperty(window, "Capacitor", { writable: true, configurable: true, value: {
        PluginHeaders: [
          { name: "GoStoneShare", methods: [{ name: "share", rtype: "promise" }] },
          { name: "App", methods: [{ name: "getLaunchUrl", rtype: "promise" }, { name: "addListener", rtype: "callback" }, { name: "removeListener", rtype: "promise" }] },
        ],
        nativeCallback: () => "listener",
        nativePromise: async (plugin: string, method: string, options: unknown) => {
          if (plugin === "GoStoneShare" && method === "share") {
            calls.push(options);
            if (unavailable) throw new Error("Share sheet unavailable");
          }
          return {};
        },
      } });
      Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    }, { platform, unavailable });
    const token = "44444444-4444-4444-8444-444444444444";
    await page.route(`**/api/games/${GAME_ID}/share`, route => route.fulfill({ json: {
      ok: true, path: `/shared-game/${token}`, url: `https://gostone.app/shared-game/${token}`,
    } }));
    await page.goto(`/de/game/${GAME_ID}`);
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Partie teilen", exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { shareCalls: unknown[] }).shareCalls)).toEqual([
      { title: "GoStone", text: "Fertige Go-Partie", url: `https://gostone.app/de/shared-game/${token}` },
    ]);
    await expect(dialog.getByRole("textbox", { name: "Partie teilen" })).toHaveValue(`https://gostone.app/de/shared-game/${token}`);
    await expect(dialog.getByRole("alert")).toHaveCount(0);
  });
}
