import { expect, test, type Page } from "@playwright/test";
import { installHarness, USER, assertNoOverflow } from "../shared/boardDesignHarness";
import { MOBILE_KATAGO } from "../../lib/mobile/katagoContract";

async function harness(page: Page, native = true, enabled = true, blunder = false, platform: "android" | "ios" = "android", replyDelay = 300) {
  await installHarness(page);
  const entitlement = { enabled };
  await page.route("**/api/auth/session", route => route.fulfill({ json: { ok: true, user: { ...USER, coachBetaEnabled: entitlement.enabled } } }));
  await page.addInitScript(({ native, blunder, identity, platform, replyDelay }) => {
    if (!native) return;
    const calls: { method: string; options: Record<string, unknown> }[] = [];
    Object.defineProperty(window, "coachNativeCalls", { value: calls });
    if (platform === "android") Object.defineProperty(window, "androidBridge", { value: {} });
    else Object.defineProperty(window, "webkit", { value: { messageHandlers: { bridge: { postMessage: () => undefined }, gostoneChrome: { postMessage: () => undefined } } } });
    Object.defineProperty(window, "Capacitor", { writable: true, configurable: true, value: {
      PluginHeaders: [
        { name: "GoStoneKataGo", methods: ["getStatus", "analyzePosition", "cancel"].map(name => ({ name, rtype: "promise" })) },
        { name: "App", methods: [{ name: "getLaunchUrl", rtype: "promise" }, { name: "addListener", rtype: "callback" }] },
      ],
      nativeCallback: () => "listener",
      nativePromise: async (plugin: string, method: string, options: Record<string, unknown>) => {
        if (plugin !== "GoStoneKataGo") return {};
        calls.push({ method, options });
        if (method === "getStatus") return { available: true, ...identity };
        if (method === "cancel") return {};
        const input = options.input as { boardSize: number; moves: { move: string; color: string }[] };
        const moveCount = input.moves.length;
        const player = input.moves.at(-1)?.color === "black" ? "W" : "B";
        const columns = "ABCDEFGHJKLMNOPQRST";
        const preferred = player === "B" ? "C3" : "G7";
        const move = input.moves.at(-1)?.move === "pass" ? "pass" : !input.moves.some(m => m.move === preferred) ? preferred : [...columns].find(c => !input.moves.some(m => m.move === `${c}1`))! + "1";
        const scoreLead = blunder && player === "W" ? 12 : 0;
        // Search remains asynchronous to exercise cancellation and stale guards.
        await new Promise(resolve => setTimeout(resolve, options.maxTime === 7 ? replyDelay : 15));
        return { turn: { turnNumber: moveCount, rootInfo: { currentPlayer: player, visits: 32, winrate: .5, scoreLead }, moveInfos: [{ move, order: 0, visits: 30, winrate: .5, scoreLead, pv: [move] }], ...(options.includeOwnership ? { ownership: Array.from({ length: input.boardSize ** 2 }, (_, i) => i % 2 ? .8 : -.8) } : {}) } };
      },
    } });
  }, { native, blunder, platform, replyDelay, identity: { engineVersion: MOBILE_KATAGO.engineVersion, modelSha256: MOBILE_KATAGO.modelSha256 } });
  return entitlement;
}

async function place(page: Page, x: number, y: number) {
  await page.locator('.go-board [role="gridcell"]').nth(y * 9 + x).click();
}

for (const platform of ["android", "ios"] as const) {
  test(`${platform}: tapping during the opponent turn leaves no ghost preview`, async ({ page }, info) => {
    test.setTimeout(90000);
    await harness(page, true, true, false, platform, 1200);
    await page.route("**/api/profile/preferences", route => route.fulfill({ json: { ok: true, preferences: { boardPlacement: "zoom" } } }));
    await page.goto("/de/play/coach");
    await expect(page.getByRole("button", { name: "Spiel starten" })).toBeEnabled({ timeout: 30000 });
    await page.getByRole("button", { name: "Spiel starten" }).click();
    await place(page, 2, 6);
    await expect(page.getByText("Coach überlegt …", { exact: true })).toBeVisible();
    const point = page.locator('.go-board [role="gridcell"]').nth(4 * 9 + 3);
    await expect(point).toHaveAttribute("aria-disabled", "true");
    const bounds = await point.boundingBox();
    expect(bounds).not.toBeNull();
    const x = bounds!.x + bounds!.width / 2, y = bounds!.y + bounds!.height / 2;
    if (info.project.use.hasTouch) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
    await expect(page.getByRole("button", { name: "Hilfe", exact: true })).toBeEnabled();
    await expect(point).toHaveAttribute("aria-disabled", "false");
    await expect(page.locator(".go-board .stone")).toHaveCount(2);
    const preview = await point.evaluate(element => {
      const style = getComputedStyle(element, "::before");
      return { background: style.backgroundColor, image: style.backgroundImage, width: parseFloat(style.width) };
    });
    expect(preview.background).toBe("rgba(0, 0, 0, 0)");
    expect(preview.image).toBe("none");
    expect(preview.width).toBeLessThan(10);
    // Removing hover must not remove the real star points.
    const star = page.locator(".go-board .intersection.is-star").first();
    expect(await star.evaluate(element => getComputedStyle(element, "::before").backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
    if (info.project.use.hasTouch) {
      const session = await page.context().newCDPSession(page);
      await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      await expect(page.locator(".touch-magnifier")).toBeVisible();
      await expect(point).toHaveClass(/is-precision-preview/);
      expect(await point.evaluate(element => getComputedStyle(element, "::after").content)).toBe('""');
      await session.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
      await expect(page.locator(".touch-magnifier")).toHaveCount(0);
      await expect(page.locator(".go-board .stone")).toHaveCount(2);
      await session.detach();
    }
  });
}

test("coach entry is native-only, opt-in and direct routes fail closed", async ({ page }) => {
  await harness(page, false, true);
  await page.goto("/de/play");
  await expect(page.locator(".mobile-coach-entry")).toHaveCount(0);
  await page.goto("/de/play/coach");
  await expect(page.getByText("Diese Beta ist für dein Konto noch nicht freigeschaltet.")).toBeVisible();
});

test("disabled mobile accounts cannot see or open the coach", async ({ page }) => {
  await harness(page, true, false);
  await page.goto("/de/play");
  await expect(page.locator(".mobile-coach-entry")).toHaveCount(0);
  await page.goto("/de/play/coach");
  await expect(page.getByText("Diese Beta ist für dein Konto noch nicht freigeschaltet.")).toBeVisible();
});

test("real ONNX comment, reply, hint, ownership, undo and revocation work in the mobile flow", async ({ page }) => {
  test.setTimeout(90000);
  const entitlement = await harness(page);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/de/play");
  await expect(page.locator(".mobile-coach-entry")).toContainText("Beta");
  await page.locator(".mobile-coach-entry").click();
  await expect(page.getByRole("button", { name: "Spiel starten" })).toBeEnabled({ timeout: 30000 });
  await page.getByRole("button", { name: "Spiel starten" }).click();
  const started = Date.now();
  await place(page, 2, 6);
  await expect(page.locator(".learn-teacher__speech p").first()).not.toHaveText("Ich schaue mir deinen Zug an …", { timeout: 15000 });
  await expect(page.locator(".learn-teacher__speech p").first()).not.toHaveText("Für diesen Zug habe ich keinen sicheren Kommentar.");
  const text = await page.locator(".learn-teacher__speech p").first().innerText();
  console.log(`Coach real WASM comment after move: ${Date.now() - started}ms; ${text}`);
  await expect(page.getByRole("button", { name: "Hilfe", exact: true })).toBeEnabled();
  // White's reply must not replace the comment with an explanation of White.
  await expect(page.locator(".learn-teacher__speech p").first()).toHaveText(text);
  await page.screenshot({ path: `test-results/coach-light-${page.viewportSize()!.width}.png`, fullPage: true });
  await page.getByRole("button", { name: "Punkteschätzung", exact: false }).click();
  await expect(page.locator(".mobile-coach-scorebar")).toBeVisible();
  await expect(page.getByText(/KataGo-Schätzung, keine endgültige Wertung/)).toBeVisible();
  await page.getByRole("button", { name: "Hilfe", exact: true }).click();
  await expect(page.locator(".go-board .is-hint")).toHaveCount(1);
  await page.getByRole("button", { name: "Zug zurück", exact: true }).click();
  await expect(page.locator(".learn-teacher__speech")).toContainText("Setze deinen ersten Stein");
  await assertNoOverflow(page);
  entitlement.enabled = false;
  await page.evaluate(() => window.dispatchEvent(new Event("gostone:auth-change")));
  await expect(page.getByText("Diese Beta ist für dein Konto noch nicht freigeschaltet.")).toBeVisible();
  expect(errors).toEqual([]);
});

test("confirmed blunders offer retry before the reply and undo restores human turn", async ({ page }) => {
  test.setTimeout(90000);
  await harness(page, true, true, true);
  await page.goto("/de/play/coach");
  await expect(page.getByRole("button", { name: "Spiel starten" })).toBeEnabled({ timeout: 30000 });
  await page.getByRole("button", { name: "Spiel starten" }).click();
  await place(page, 0, 0);
  await expect(page.getByRole("button", { name: "Nochmal", exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".mobile-coach-estimate-toggle")).toContainText("Grober Fehler");
  const replyCalls = await page.evaluate(() => (window as unknown as { coachNativeCalls: { options: { maxTime?: number } }[] }).coachNativeCalls.filter(c => c.options?.maxTime === 7).length);
  expect(replyCalls).toBe(0);
  await page.getByRole("button", { name: "Nochmal", exact: true }).click();
  await expect(page.getByRole("button", { name: "Passen", exact: true })).toBeEnabled();
  await expect(page.locator(".learn-teacher__speech")).toContainText("Setze deinen ersten Stein");
});

test("dark coach survives undo during reply, passes and resignation without stale stones", async ({ page }) => {
  test.setTimeout(90000);
  await harness(page);
  await page.addInitScript(() => localStorage.setItem("gostone.mobile.theme.v1", "dark"));
  await page.goto("/de/play/coach");
  await expect(page.getByRole("button", { name: "Spiel starten" })).toBeEnabled({ timeout: 30000 });
  await page.getByRole("button", { name: "Spiel starten" }).click();
  await place(page, 2, 6);
  await expect(page.getByText("Coach überlegt …", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Zug zurück", exact: true }).click();
  await expect(page.getByRole("button", { name: "Passen", exact: true })).toBeEnabled();
  await expect(page.locator(".go-board .stone")).toHaveCount(0);
  await page.screenshot({ path: `test-results/coach-dark-${page.viewportSize()!.width}.png`, fullPage: true });
  await page.getByRole("button", { name: "Passen", exact: true }).click();
  await expect(page.getByText(/Beide haben gepasst/)).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".go-board .stone")).toHaveCount(0);
  await page.getByRole("button", { name: "Neues Spiel", exact: true }).click();
  await page.getByRole("button", { name: "Spiel starten" }).click();
  await page.getByRole("button", { name: "Aufgeben", exact: true }).click();
  await expect(page.getByText("Du hast aufgegeben.", { exact: true })).toBeVisible();
});

test("iOS native route supports a 13x13 board and uses only position analyses", async ({ page }) => {
  test.setTimeout(90000);
  await harness(page, true, true, false, "ios");
  await page.goto("/de/play/coach");
  await expect(page.getByRole("button", { name: "Spiel starten" })).toBeEnabled({ timeout: 30000 });
  await page.getByRole("button", { name: "13 × 13", exact: true }).click();
  await page.getByRole("button", { name: "Spiel starten" }).click();
  await expect(page.locator('[role="gridcell"]')).toHaveCount(169);
  await page.locator('[role="gridcell"]').nth(10 * 13 + 2).click();
  await expect(page.getByRole("button", { name: "Hilfe", exact: true })).toBeEnabled({ timeout: 15000 });
  await expect(page.locator(".mobile-coach-estimate-toggle")).toContainText("Gut");
  const calls = await page.evaluate(() => (window as unknown as { coachNativeCalls: { method: string; options: { input?: { boardSize: number }; maxTime?: number } }[] }).coachNativeCalls);
  expect(calls.some(c => c.options?.input?.boardSize === 13)).toBe(true);
  expect(calls.some(c => c.method === "analyze")).toBe(false);
  expect(calls.filter(c => c.method === "analyzePosition").every(c => c.options.maxTime! <= 7)).toBe(true);
  await assertNoOverflow(page);
});
