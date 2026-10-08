import { expect, test, type Page } from "@playwright/test";
import { GAME_ID, installHarness, gameFor } from "../shared/boardDesignHarness";
import { MOBILE_KATAGO } from "../../lib/mobile/katagoContract";

async function nativeReview(page: Page, platform: "android" | "ios", timeout: false | "reject" | "partial" = false) {
  const state = await installHarness(page);
  state.game = { ...gameFor(9, "friendly"), status: "finished", turn: null, result: "B+R", finishReason: "resignation" };
  let serverRequests = 0;
  await page.route(`**/api/games/${GAME_ID}/analysis`, route => {
    serverRequests++;
    return route.fulfill({ status: 500, json: { ok: false } });
  });
  await page.addInitScript(({ platform, identity, timeout }) => {
    const calls: { method: string; id?: unknown }[] = [];
    const listeners = new Map<string, (value: unknown) => void>();
    let pending: ((reason: Error) => void) | undefined;
    let analyses = 0;
    Object.defineProperty(window, "reviewCalls", { value: calls });
    if (platform === "android") Object.defineProperty(window, "androidBridge", { value: {} });
    else Object.defineProperty(window, "webkit", { value: { messageHandlers: { bridge: { postMessage: () => undefined }, gostoneChrome: { postMessage: () => undefined } } } });
    Object.defineProperty(window, "Capacitor", { writable: true, configurable: true, value: {
      PluginHeaders: [
        { name: "GoStoneKataGo", methods: ["getStatus", "analyze", "cancel", "removeListener"].map(name => ({ name, rtype: "promise" })).concat([{ name: "addListener", rtype: "callback" }]) },
        { name: "App", methods: [{ name: "getLaunchUrl", rtype: "promise" }, { name: "addListener", rtype: "callback" }, { name: "removeListener", rtype: "promise" }] },
      ],
      nativeCallback: (plugin: string, _method: string, options: { eventName: string }, callback: (value: unknown) => void) => {
        if (plugin === "GoStoneKataGo") listeners.set(options.eventName, callback);
        return "listener";
      },
      nativePromise: async (plugin: string, method: string, options: Record<string, unknown> = {}) => {
        if (plugin !== "GoStoneKataGo") return {};
        calls.push({ method, id: options.analysisId });
        if (method === "getStatus") return { available: true, ...identity };
        if (method === "removeListener") { listeners.delete(options.eventName as string); return {}; }
        if (method === "cancel") {
          pending?.(new DOMException("Cancelled", "AbortError")); pending = undefined;
          await new Promise(resolve => setTimeout(resolve, 50));
          return {};
        }
        analyses++;
        const turns = Array.from({ length: 3 }, (_, turnNumber) => ({
          turnNumber, rootInfo: { currentPlayer: turnNumber % 2 ? "W" : "B", visits: 2, winrate: .5, scoreLead: 0 },
          moveInfos: [{ move: turnNumber === 0 ? "A9" : "B9", order: 0, visits: 2, winrate: .5, scoreLead: 0, pv: ["A9"] }],
        }));
        if (timeout) {
          for (const turn of turns) listeners.get("progress")?.({ analysisId: options.analysisId, phase: "preview", completedTurns: turn.turnNumber + 1, totalTurns: 3, visitsPerTurn: 2, turn });
          if (timeout === "partial") return { turns, visitsPerTurn: 2, complete: false };
          throw new Error("Local analysis exceeded its time budget.");
        }
        if (analyses === 1) return new Promise((_resolve, reject) => { pending = reject; });
        return { turns, visitsPerTurn: 2 };
      },
    } });
  }, { platform, timeout, identity: { engineVersion: MOBILE_KATAGO.engineVersion, modelSha256: MOBILE_KATAGO.modelSha256 } });
  return () => serverRequests;
}

for (const platform of ["android", "ios"] as const) {
  test(`${platform}: review survives session refresh, cancels on back and can immediately restart`, async ({ page }) => {
    const serverRequests = await nativeReview(page, platform);
    await page.goto(`/de/review/${GAME_ID}`);
    const start = page.getByRole("button", { name: "Mit KataGo analysieren", exact: true });
    await expect(start).toBeVisible();
    await start.click();
    const calls = () => page.evaluate(() => (window as unknown as { reviewCalls: { method: string; id?: string }[] }).reviewCalls);
    await expect.poll(async () => (await calls()).filter(call => call.method === "analyze").length).toBe(1);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByRole("heading", { name: "KataGo analysiert jede Stellung…" })).toBeVisible();
    expect((await calls()).filter(call => call.method === "cancel")).toHaveLength(0);
    await page.getByRole("link", { name: "Alle Analysen", exact: true }).click();
    await expect.poll(async () => (await calls()).filter(call => call.method === "cancel").length).toBe(1);
    const first = await calls();
    expect(first.find(call => call.method === "cancel")?.id).toBe(first.find(call => call.method === "analyze")?.id);
    await page.goBack();
    await expect(start).toBeVisible();
    await start.click();
    await expect(page.getByRole("slider", { name: "Zug", exact: true })).toHaveAttribute("max", "2");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("slider", { name: "Zug", exact: true })).toHaveAttribute("max", "2");
    expect((await calls()).filter(call => call.method === "analyze")).toHaveLength(0);
    expect(serverRequests()).toBe(0);
  });

  for (const timeout of ["reject", "partial"] as const) test(`${platform}: native ${timeout} time limit retains the playable preview instead of Try again`, async ({ page }) => {
    const serverRequests = await nativeReview(page, platform, timeout);
    await page.goto(`/de/review/${GAME_ID}`);
    await page.getByRole("button", { name: "Mit KataGo analysieren", exact: true }).click();
    await expect(page.getByRole("slider", { name: "Zug", exact: true })).toHaveAttribute("max", "2");
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { reviewCalls: { method: string }[] }).reviewCalls.filter(call => call.method === "cancel").length)).toBe(1);
    expect(serverRequests()).toBe(0);
  });
}
