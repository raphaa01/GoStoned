import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  chromium,
  expect,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { closePool, getPool, query } from "../lib/db";
import { getDatabaseUrl, isUnambiguousLocalDatabase } from "../lib/env";
import { assertSmokeDatabaseIdentity } from "../lib/smokeDatabase";
import { createSession, SESSION_COOKIE } from "../lib/auth/session";
import { getTournamentDetail } from "../lib/tournaments/service";
import { resignGame } from "../lib/game/gameService";
import { EXPECTED_PLAYER_HEADER } from "../lib/auth/playerBinding";

async function main() {
  assert.ok(isUnambiguousLocalDatabase(getDatabaseUrl()));
  await assertSmokeDatabaseIdentity(getPool());
  const base = process.env.TOURNAMENT_BROWSER_URL ?? "http://127.0.0.1:3187";
  assert.equal(new URL(base).hostname, "127.0.0.1");
  const browser = await chromium.launch({ headless: true });
  const users: string[] = [];
  const contexts: BrowserContext[] = [];
  const pages = new Map<string, Page>();
  const errors: string[] = [];
  let id: string | null = null;
  try {
    for (let i = 0; i < 3; i++) {
      const user = (
        await query<{ id: string }>(
          "INSERT INTO users(username,display_name) VALUES ($1,$2) RETURNING id",
          [
            `tb_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
            `Browser Player ${i + 1}`,
          ],
        )
      ).rows[0].id;
      users.push(user);
      await query(
        `INSERT INTO player_glicko2_ratings(player_key,user_id,rating,rating_deviation,volatility,rated_game_count,algorithm_version,last_rating_period_at)
        VALUES ($1,$2,1200,120,0.06,10,'glicko2-v1-tau-0.5',statement_timestamp())`,
        [`user:${user}`, user],
      );
      const token = await createSession(user);
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        colorScheme: "dark",
      });
      contexts.push(context);
      await context.addCookies([
        {
          name: SESSION_COOKIE,
          value: token,
          url: base,
          httpOnly: true,
          sameSite: "Lax",
        },
      ]);
      await context.addInitScript(() =>
        localStorage.setItem("gostone.theme.v1", "dark"),
      );
      const page = await context.newPage();
      pages.set(user, page);
      page.on("pageerror", (e) => errors.push(e.message));
    }
    const host = pages.get(users[0])!;
    await host.goto(`${base}/de/tournaments`);
    await expect(
      host.getByRole("heading", { name: "Turniere", exact: true }),
    ).toBeVisible();
    await expect(
      host.getByText("Letzte 7 Tage", { exact: false }),
    ).toBeVisible();
    await host
      .getByRole("button", { name: "Turnier erstellen", exact: true })
      .click();
    await host.getByLabel("Name", { exact: true }).fill("Evening Go");
    await host.getByRole("combobox", { name: /Brett/ }).selectOption("9");
    await host
      .getByRole("button", { name: "Turnier erstellen", exact: true })
      .last()
      .click();
    await host.waitForURL(/\/tournaments\/[0-9a-f-]+$/);
    id = new URL(host.url()).pathname.split("/").at(-1)!;
    const code = await host
      .locator(".tournament-invite-code strong")
      .innerText();
    const rejectedOrigin = await host.request.post(`${base}/api/tournaments`, {
      headers: {
        origin: "https://elsewhere.invalid",
        [EXPECTED_PLAYER_HEADER]: `user:${users[0]}`,
      },
      data: { action: "start", id },
    });
    assert.equal(rejectedOrigin.status(), 403);
    const wrongIdentity = await host.request.get(
      `${base}/api/tournaments?id=${id}`,
      {
        headers: { [EXPECTED_PLAYER_HEADER]: `user:${users[1]}` },
      },
    );
    assert.equal(wrongIdentity.status(), 409);
    for (const user of users.slice(1)) {
      const page = pages.get(user)!;
      await page.goto(`${base}/de/tournaments`);
      await page
        .getByRole("textbox", { name: "Turniercode", exact: true })
        .fill(code);
      await page
        .getByRole("button", { name: "Mit Code beitreten", exact: true })
        .click();
      await page.waitForURL(new RegExp(id));
    }
    await expect(host.locator(".tournament-invite-code")).toBeVisible();
    await host.bringToFront();
    await expect(
      host.locator(".tournament-lobby .tournament-heading > span"),
    ).toHaveText("3 / 8");
    await host.screenshot({
      path: ".cache/tournaments-lobby-dark.png",
      fullPage: true,
    });
    await host.evaluate(() => {
      document.documentElement.dataset.theme = "light";
      document.documentElement.style.colorScheme = "light";
    });
    await host.screenshot({
      path: ".cache/tournaments-lobby-light.png",
      fullPage: true,
    });
    await host.setViewportSize({ width: 390, height: 844 });
    await host.screenshot({
      path: ".cache/tournaments-lobby-mobile.png",
      fullPage: true,
    });
    assert(
      await host.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      "Mobile lobby must not overflow horizontally.",
    );
    for (const width of [320, 768, 1024, 1120]) {
      await host.setViewportSize({ width, height: 900 });
      assert(
        await host.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        `Lobby overflow at ${width}px`,
      );
    }
    await host.setViewportSize({ width: 1440, height: 1000 });
    await host
      .getByRole("button", { name: "Turnier starten", exact: true })
      .click();
    await expect(
      host.getByText("Jeder gegen jeden", { exact: false }).first(),
    ).toBeVisible();
    const detail = await getTournamentDetail(users[0], id);
    const pairing = detail.matches.find((m) => m.round === 1 && m.whiteId)!;
    assert.ok(pairing);
    for (const user of [pairing.blackId!, pairing.whiteId!])
      await pages
        .get(user)!
        .getByRole("button", { name: "Bereit", exact: true })
        .click();
    const black = pages.get(pairing.blackId!)!;
    const white = pages.get(pairing.whiteId!)!;
    await Promise.all([
      black.waitForURL(/\/game\//),
      white.waitForURL(/\/game\//),
    ]);
    const playing = await getTournamentDetail(users[0], id);
    const game = playing.matches.find((m) => m.status === "playing")!;
    const viewerId = users.find(
      (u) => u !== pairing.blackId && u !== pairing.whiteId,
    )!;
    const viewer = pages.get(viewerId)!;
    await viewer
      .getByRole("button", { name: "Zuschauen", exact: true })
      .first()
      .click();
    await expect(
      viewer.locator(".tournament-watch").getByRole("grid"),
    ).toBeVisible();
    await expect(
      viewer.locator(".tournament-watch").getByRole("gridcell").first(),
    ).toBeDisabled();
    await viewer.screenshot({
      path: ".cache/tournaments-spectator.png",
      fullPage: true,
    });
    await expect(
      black.getByRole("link", { name: "Zurück zum Turnier" }),
    ).toBeVisible();
    await resignGame(game.gameId!, `user:${pairing.blackId}`);
    await black.getByRole("link", { name: "Zurück zum Turnier" }).click();
    await expect(
      black.getByRole("heading", { name: "Rangliste", exact: true }),
    ).toBeVisible();
    assert.deepEqual(
      errors,
      [],
      "Browser flow must not produce uncaught errors.",
    );
    console.log(
      "Browser → API → PostgreSQL → lobby → ready → live game → spectator → standings passed at desktop and mobile widths.",
    );
  } finally {
    await browser.close();
    if (id) {
      const games = await query<{ game_id: string }>(
        "SELECT game_id FROM tournament_matches WHERE tournament_id=$1 AND game_id IS NOT NULL",
        [id],
      );
      await query("DELETE FROM tournaments WHERE id=$1", [id]);
      if (games.rows.length)
        await query("DELETE FROM games WHERE id=ANY($1::uuid[])", [
          games.rows.map((r) => r.game_id),
        ]);
    }
    if (users.length)
      await query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
    await closePool();
  }
}
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
