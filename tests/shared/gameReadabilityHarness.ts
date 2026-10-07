import { expect, test, type Locator } from "@playwright/test";
import { gameFor, GAME_ID, installHarness, USER } from "./boardDesignHarness";

async function contrast(locator: Locator, background: Locator = locator) {
  const foreground = await locator.evaluate((element) => getComputedStyle(element).color);
  const surface = await background.evaluate((element) => getComputedStyle(element).backgroundColor);
  const luminance = (value: string) => {
    const channels = value.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((channel) => {
      const normalized = channel / 255;
      return normalized <= .04045 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4;
    });
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  };
  const values = [luminance(foreground), luminance(surface)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
}

export function registerGameReadabilityTests() {
  for (const theme of ["light", "dark"]) for (const phase of ["main", "byo-yomi"] as const) {
    test(`game clock and Pass remain readable (${theme}, ${phase})`, async ({ page }, info) => {
      test.skip(!/390|1440/.test(info.project.name), "Phone and wide layouts exercise the shared controls.");
      const state = await installHarness(page);
      await page.addInitScript((theme) => {
        localStorage.setItem("gostone.mobile.theme.v1", theme);
        localStorage.setItem("gostone.theme.v1", theme);
      }, theme);
      state.game = gameFor(13, "friendly");
      if (phase === "byo-yomi") state.game.clock.black = {
        mainTimeMs: 0, displayTimeMs: 30000, periodsRemaining: 5, phase,
      };
      await page.goto(`/de/game/${GAME_ID}`);
      const running = page.locator(".player-clock.is-running");
      await expect(running).toBeVisible();
      expect(await contrast(running.locator("strong"), running)).toBeGreaterThanOrEqual(4.5);
      expect(await contrast(running.locator("span"), running)).toBeGreaterThanOrEqual(4.5);
      const idle = page.locator(".player-clock:not(.is-running)");
      expect(await contrast(idle.locator("strong"), idle)).toBeGreaterThanOrEqual(4.5);
      const pass = page.locator(".game-action-pass");
      await expect(pass).toBeEnabled();
      expect(await contrast(pass)).toBeGreaterThanOrEqual(4.5);
      if (await page.locator(".mobile-splash").count()) await expect(page.locator(".mobile-splash")).toHaveAttribute("aria-hidden", "true");
      await pass.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `.cache/game-readability-${theme}-${phase}-${info.project.name}.png` });
      state.game.turn = "white";
      state.game.version++;
      await expect(pass).toBeDisabled();
      expect(await contrast(pass)).toBeGreaterThanOrEqual(4.5);
    });
  }

  for (const size of [9, 13, 19] as const) {
    test(`${size}×${size}: a stone stays centered from first paint through confirmation`, async ({ page }, info) => {
      test.skip(!/390|1440/.test(info.project.name), "Phone and wide layouts exercise the shared controls.");
      const state = await installHarness(page);
      state.game = gameFor(size, "friendly");
      let release!: () => void;
      const responseGate = new Promise<void>((resolve) => { release = resolve; });
      const middle = Math.floor(size / 2);
      await page.route(`**/api/games/${GAME_ID}/moves`, async (route) => {
        const body = route.request().postDataJSON();
        expect(body).toMatchObject({ x: middle, y: middle, expectedVersion: 2 });
        state.moves.push(body);
        await responseGate;
        state.game.board[middle][middle] = "black";
        state.game.moveCount++; state.game.version++; state.game.turn = "white";
        state.game.moves.push({ moveNumber: 3, color: "black", x: middle, y: middle, isPass: false, createdAt: new Date().toISOString() });
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, actor: USER.playerKey, game: state.game }) });
      });
      await page.goto(`/de/game/${GAME_ID}`);
      if (await page.locator(".mobile-splash").count()) await expect(page.locator(".mobile-splash")).toHaveAttribute("aria-hidden", "true");
      const point = page.locator(".intersection").nth(middle * size + middle);
      if (info.project.use.hasTouch) await point.tap(); else await point.click();
      try {
        await expect.poll(() => state.moves.length).toBe(1);
        const stone = point.locator(".stone--black");
        await expect(stone).toHaveCount(1);
        const originalNode = await stone.elementHandle();
        // Seek the actual placement animation, including its first frame, so a
        // fast response or a slow CI frame cannot conceal an initial displacement.
        const offsets = await stone.evaluate((element) => {
          const animation = element.getAnimations()[0];
          animation?.pause();
          const offsets = [0, 20, 95, 190].map((time) => {
            if (animation) animation.currentTime = time;
            const stone = element.getBoundingClientRect();
            const cell = element.parentElement!.getBoundingClientRect();
            return { x: stone.x + stone.width / 2 - (cell.x + cell.width / 2),
              y: stone.y + stone.height / 2 - (cell.y + cell.height / 2),
              opacity: Number(getComputedStyle(element).opacity) };
          });
          animation?.play();
          return offsets;
        });
        for (const offset of offsets) {
          expect(Math.abs(offset.x)).toBeLessThan(.5);
          expect(Math.abs(offset.y)).toBeLessThan(.5);
          expect(offset.opacity).toBe(1);
        }
        release();
        await expect(page.locator(".game-panel-player.is-you .player-clock")).not.toHaveClass(/is-running/);
        await expect(page.locator(".game-action-pass")).toBeDisabled();
        expect(await originalNode!.evaluate((element) => element.isConnected)).toBe(true);
        await expect(stone).toHaveCount(1);
        await expect(page.locator(".go-board .stone")).toHaveCount(3);
        const finalOffset = await stone.evaluate((element) => {
          const stone = element.getBoundingClientRect(), cell = element.parentElement!.getBoundingClientRect();
          return Math.hypot(stone.x + stone.width / 2 - (cell.x + cell.width / 2), stone.y + stone.height / 2 - (cell.y + cell.height / 2));
        });
        expect(finalOffset).toBeLessThan(.5);
      } finally { release(); }
    });
  }
}
