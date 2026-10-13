import { expect, test } from "@playwright/test";
import { scoreLocalSettlement } from "../../lib/game/localSettlement";
import { assertNoOverflow, installHarness, USER } from "../shared/boardDesignHarness";

test.beforeEach(async ({ page }) => {
  await installHarness(page);
  await page.route("**/api/matchmaking", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, actor: USER.playerKey,
    matchmaking: { status: "idle", gameId: null, boardSize: null, timeControl: null } }) }));
});

test("local entry, board sizes, alternating stones, passes and both score confirmations", async ({ page }, info) => {
  const errors: string[] = [];
  const gameWrites: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => { if (request.method() !== "GET" && /\/api\/(games|matchmaking)/.test(request.url())) gameWrites.push(request.url()); });
  await page.route("**/api/local-game/score", async (route) => route.fulfill({ contentType: "application/json",
    body: JSON.stringify({ ok: true, ...scoreLocalSettlement(route.request().postDataJSON()) }) }));
  await page.goto("/de/play");
  await page.getByRole("link", { name: "Auf einem Gerät spielen" }).click();
  await expect(page.getByRole("heading", { name: "Auf einem Gerät spielen" })).toBeVisible();
  await page.screenshot({ path: `.cache/local-setup-${info.project.name}.png`, animations: "disabled" });
  await expect(page.locator(".mobile-tab-bar")).toHaveCount(0);
  for (const size of [9, 13, 19]) {
    await page.locator(".size-selector button").filter({ hasText: `${size}×${size}` }).click();
    await expect(page.locator(".play-board-preview")).toHaveAttribute("aria-label", new RegExp(String(size)));
  }
  await page.locator(".size-selector button").first().click();
  await page.getByRole("button", { name: "Spiel starten", exact: true }).click();
  const points = page.locator(".intersection");
  await expect(points).toHaveCount(81);
  const place = async (index: number) => { if (info.project.use.hasTouch) await points.nth(index).tap(); else await points.nth(index).click(); };
  await place(1); await place(0); await place(9); await place(80);
  await expect(points.nth(0).locator(".stone")).toHaveCount(0);
  await expect(page.locator(".local-turn")).toHaveText("Schwarz am Zug");
  await page.screenshot({ path: `.cache/local-board-${info.project.name}.png`, animations: "disabled" });
  await page.getByRole("button", { name: "Passen", exact: true }).click();
  await page.getByRole("button", { name: "Passen", exact: true }).click();
  await expect(page.locator(".local-score")).toContainText("6.5");
  await page.getByRole("button", { name: "Schwarz bestätigt", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Weiß bestätigt", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Weiß gewinnt");
  await expect(page.getByRole("dialog")).toContainText("4.5");
  await page.screenshot({ path: `.cache/local-result-${info.project.name}.png`, animations: "disabled" });
  await page.getByRole("button", { name: "Brett noch einmal ansehen", exact: true }).click();
  await assertNoOverflow(page);
  expect(gameWrites).toEqual([]);
  expect(errors).toEqual([]);
});

test("resignation confirms the current color and replay starts an empty game", async ({ page }) => {
  await page.goto("/de/play/local");
  await page.getByRole("button", { name: "Spiel starten", exact: true }).click();
  await page.getByRole("button", { name: "Aufgeben", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Aufgeben", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Weiß gewinnt durch Aufgabe");
  await page.getByRole("dialog").getByRole("button", { name: "Noch einmal spielen", exact: true }).click();
  await expect(page.locator(".local-turn")).toHaveText("Schwarz am Zug");
  await expect(page.locator(".go-board .stone")).toHaveCount(0);
});

test("scoring edits clear agreement; failed requests can retry and play can resume", async ({ page }, info) => {
  let fail = false;
  await page.route("**/api/local-game/score", async (route) => {
    if (fail) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: "Unavailable" }) });
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, ...scoreLocalSettlement(route.request().postDataJSON()) }) });
  });
  await page.addInitScript(() => localStorage.setItem("gostone.mobile.theme.v1", "dark"));
  await page.goto("/de/play/local");
  await page.getByRole("button", { name: "Spiel starten", exact: true }).click();
  const points = page.locator(".intersection");
  const place = async (index: number) => { if (info.project.use.hasTouch) await points.nth(index).tap(); else await points.nth(index).click(); };
  for (const index of [1, 0, 10, 9, 19, 80, 27, 71]) await place(index);
  await page.getByRole("button", { name: "Passen", exact: true }).click();
  await page.getByRole("button", { name: "Passen", exact: true }).click();
  const black = page.getByRole("button", { name: "Schwarz bestätigt", exact: true });
  await expect(black).toBeEnabled();
  await black.click();
  await expect(page.getByRole("button", { name: "Weiß bestätigt", exact: true })).toBeEnabled();
  await place(0);
  await expect(black).toBeEnabled();
  await expect(page.locator(".local-score strong").first()).toHaveText("5");
  await page.screenshot({ path: `.cache/local-scoring-dark-${info.project.name}.png`, animations: "disabled" });
  await place(0);
  await expect(black).toBeEnabled();
  await page.getByRole("button", { name: "Fortsetzen", exact: true }).click();
  await expect(page.locator(".local-turn")).toHaveText("Schwarz am Zug");
  fail = true;
  await page.getByRole("button", { name: "Passen", exact: true }).click();
  await page.getByRole("button", { name: "Passen", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Wertung nicht erreichbar");
  await expect(black).toBeDisabled();
  fail = false;
  await page.getByRole("button", { name: "Erneut versuchen", exact: true }).click();
  await expect(black).toBeEnabled();
});

for (const theme of ["light", "dark"]) test(`Go clock fills portrait and landscape, switches, pauses and resets (${theme})`, async ({ page }, info) => {
  await page.addInitScript((theme) => localStorage.setItem("gostone.mobile.theme.v1", theme), theme);
  await page.goto("/de/play/local");
  await page.getByRole("link", { name: "Go-Uhr" }).click();
  await page.getByRole("button", { name: "Uhr starten" }).click();
  const face = page.locator(".go-clock-face");
  await expect(face).toBeVisible();
  await expect(page.locator(".go-clock-current")).toContainText("Schwarz am Zug");
  await page.getByRole("button", { name: "Tippen zum Starten" }).click();
  await page.getByRole("button", { name: "Tippen zum Wechseln" }).click();
  await expect(face).toHaveClass(/go-clock-face--white/);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.locator(".go-clock-instruction")).toHaveText("Pausiert");
  const pausedTime = await page.locator(".go-clock-current strong").textContent();
  await page.waitForTimeout(1100);
  await expect(page.locator(".go-clock-current strong")).toHaveText(pausedTime!);
  await page.getByRole("button", { name: "Fortsetzen", exact: true }).click();
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    const bounds = await face.boundingBox();
    expect(Math.abs(bounds!.width - viewport.width)).toBeLessThan(1);
    expect(Math.abs(bounds!.height - viewport.height)).toBeLessThan(1);
    await page.screenshot({ path: `.cache/go-clock-${theme}-${viewport.width}-${info.project.name}.png` });
    await assertNoOverflow(page);
  }
  await page.getByRole("button", { name: "Zurücksetzen", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Zurücksetzen", exact: true }).click();
  await expect(page.getByRole("button", { name: "Tippen zum Starten" })).toBeVisible();
  await expect(page.locator(".go-clock-current strong")).toHaveText("5:00");
});
