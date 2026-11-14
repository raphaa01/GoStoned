import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import {
  chromium,
  devices,
  expect,
  webkit,
  type Browser,
  type Page,
} from "@playwright/test";
import { preview } from "vite";
import { closePool, getPool, query } from "../lib/db";
import { getDatabaseUrl, isUnambiguousLocalDatabase } from "../lib/env";
import { assertSmokeDatabaseIdentity } from "../lib/smokeDatabase";
import { createSession, SESSION_COOKIE } from "../lib/auth/session";
import {
  confirmScore,
  getGameState,
  resignGame,
  submitMove,
} from "../lib/game/gameService";
import {
  getRapidActivity,
  getTournamentDashboard,
  getTournamentDetail,
  joinTournament,
} from "../lib/tournaments/service";

const api = process.env.TOURNAMENT_BROWSER_URL ?? "http://127.0.0.1:3101";
const app = "http://127.0.0.1:4181";
const audit = ".cache/visual-audit/mobile-tournaments";

async function noOverflow(page: Page) {
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  const bounds = await page.locator(".tournaments").first().boundingBox();
  assert(
    bounds &&
      bounds.x >= 0 &&
      bounds.x + bounds.width <= page.viewportSize()!.width + 1,
  );
}

async function run() {
  assert(isUnambiguousLocalDatabase(getDatabaseUrl()));
  assert.equal(new URL(api).hostname, "127.0.0.1");
  await assertSmokeDatabaseIdentity(getPool());
  await mkdir(audit, { recursive: true });
  const server = await preview({
    configFile: "vite.mobile.config.mts",
    preview: { port: 4181, host: "127.0.0.1", strictPort: true },
  });
  const browsers: Browser[] = [];
  const users: string[] = [];
  const events: string[] = [];
  const errors: string[] = [];
  let phone: Page | undefined;
  try {
    const chrome = await chromium.launch();
    browsers.push(chrome);
    const safari =
      process.env.GOSTONE_TEST_WEBKIT === "1" ? await webkit.launch() : chrome;
    if (safari !== chrome) browsers.push(safari);
    async function account(name: string) {
      const id = (
        await query<{ id: string }>(
          "INSERT INTO users(username,display_name) VALUES ($1,$2) RETURNING id",
          [`mt_${randomUUID().replaceAll("-", "").slice(0, 12)}`, name],
        )
      ).rows[0].id;
      users.push(id);
      await query(
        `INSERT INTO player_glicko2_ratings(player_key,user_id,rating,rating_deviation,volatility,rated_game_count,algorithm_version,last_rating_period_at)
        VALUES ($1,$2,1700,120,0.06,10,'glicko2-v1-tau-0.5',statement_timestamp())`,
        [`user:${id}`, id],
      );
      await query(
        "INSERT INTO player_rating_preferences(user_id) VALUES ($1)",
        [id],
      );
      return { id, session: await createSession(id) };
    }
    async function client(browser: Browser, session: string, device?: string) {
      const context = await browser.newContext({
        ...(device
          ? devices[device]
          : { viewport: { width: 1440, height: 900 } }),
        serviceWorkers: "block",
      });
      await context.addCookies([
        {
          name: SESSION_COOKIE,
          value: session,
          url: api,
          httpOnly: true,
          sameSite: "Lax",
        },
      ]);
      const page = await context.newPage();
      page.on("pageerror", (e) => errors.push(e.message));
      if (device) {
        const nativeOrigin = device.startsWith("Pixel")
          ? "https://localhost"
          : "capacitor://localhost";
        // Route the packaged app's production API requests to the isolated server.
        // Keep the native Origin and real session so route and account guards run.
        await page.route("**/api/**", async (route) => {
          const request = route.request();
          const url = new URL(request.url());
          if (request.method() === "OPTIONS") {
            await route.fulfill({
              status: 204,
              headers: {
                "access-control-allow-origin": app,
                "access-control-allow-credentials": "true",
                "access-control-allow-methods": "GET, POST, PATCH, DELETE",
                "access-control-allow-headers":
                  request.headers()["access-control-request-headers"] ??
                  "content-type",
              },
            });
            return;
          }
          const response = await route.fetch({
            url: `${api}${url.pathname}${url.search}`,
            maxRedirects: 0,
            headers: {
              ...(await request.allHeaders()),
              origin: nativeOrigin,
              cookie: `${SESSION_COOKIE}=${session}`,
            },
          });
          await route.fulfill({
            response,
            headers: {
              ...response.headers(),
              "access-control-allow-origin": app,
              "access-control-allow-credentials": "true",
            },
          });
        });
      }
      return page;
    }
    const alice = await account("App Player");
    const bob = await account("Web Player");
    const carol = await account("Android Player");
    await query(
      "INSERT INTO friendships(requester_id,addressee_id,status,responded_at) VALUES ($1,$2,'accepted',statement_timestamp())",
      [alice.id, bob.id],
    );
    phone = await client(safari, alice.session, "iPhone 13");
    const tablet = await client(safari, alice.session, "iPad (gen 7)");
    const android = await client(chrome, carol.session, "Pixel 7");
    const web = await client(chrome, bob.session);
    const dashboard = await getTournamentDashboard(alice.id);
    const rapid = dashboard.monthly.find(
      (t) => t.monthlyMode === "rapid" && t.category === dashboard.category,
    )!;
    events.push(rapid.id);
    await query(
      "UPDATE tournaments SET status='lobby',starts_at=statement_timestamp()+interval '2 days',ends_at=statement_timestamp()+interval '9 days' WHERE id=$1",
      [rapid.id],
    );
    for (let i = 0; i < 6; i++) {
      const entrant = await account(`Group Player ${i + 1}`);
      await joinTournament(entrant.id, { id: rapid.id });
    }
    await phone.goto(`${app}/de`);
    const homeLink = phone.locator(".mobile-home-tournament-link");
    await expect(homeLink).toContainText("Nicht angemeldet");
    await homeLink.click();
    await expect(
      phone.getByRole("heading", { name: "Monthly Rapid", exact: true }),
    ).toBeVisible();
    await expect(phone.locator(".tournament-countdown")).toBeVisible();
    await expect(phone.locator(".tournament-activity")).toHaveCount(0);
    await expect(
      phone.getByRole("heading", { name: "Monthly Classic", exact: true }),
    ).toHaveCount(0);
    await phone.getByText("Format", { exact: true }).click();
    await expect(phone.getByText(/Bis zu 10 Partien/)).toBeVisible();
    await phone.getByRole("button", { name: "Anmelden", exact: true }).click();
    await expect(phone.getByText(/^Angemeldet ·/)).toBeVisible();
    await noOverflow(phone);
    await phone.screenshot({
      path: `${audit}/iphone-rapid.png`,
      fullPage: true,
    });
    await phone.locator('.mobile-tab-bar a[href="/de"]').click();
    await expect(homeLink.getByText("Angemeldet", { exact: true })).toBeVisible();

    await web.goto(`${api}/de/tournaments/${rapid.id}`);
    await web.getByRole("button", { name: "Beitreten", exact: true }).click();
    await expect(
      web.getByRole("button", { name: "Beitreten", exact: true }),
    ).toHaveCount(0);
    await query(
      "UPDATE tournaments SET starts_at=statement_timestamp()-interval '1 hour',ends_at=statement_timestamp()+interval '1 hour' WHERE id=$1",
      [rapid.id],
    );
    await homeLink.click();
    await expect(phone.getByText("0 / 10 Partien")).toBeVisible();
    await expect(phone.locator(".tournament-activity")).toBeVisible();
    await expect(phone.locator(".tournament-countdown")).toHaveCount(0);
    const groupTable = phone.locator(".tournament-live .rapid-standings tbody");
    await expect(groupTable.locator("tr")).not.toHaveCount(8);
    await phone.getByRole("button", { name: "Ganze Gruppe anzeigen" }).click();
    await expect(groupTable.locator("tr")).toHaveCount(8);
    await phone
      .getByRole("button", { name: "Weniger Spieler anzeigen" })
      .click();
    await phone
      .getByRole("button", { name: "Partie suchen", exact: true })
      .click();
    await web
      .getByRole("button", { name: "Partie suchen", exact: true })
      .click();
    await Promise.all(
      [phone, web].map((page) =>
        page.getByRole("button", { name: "Bereit", exact: true }).click(),
      ),
    );
    await Promise.all([phone, web].map((page) => page.waitForURL(/\/game\//)));
    const gameId = new URL(phone.url()).pathname.split("/").at(-1)!;
    assert(web.url().endsWith(gameId));
    await expect(phone.getByRole("gridcell")).toHaveCount(169);
    assert.equal(await getRapidActivity(), 2);
    const game = await getGameState(gameId, `user:${alice.id}`);
    assert.equal(game.komi, 6.5);
    const firstPass = await submitMove(gameId, game.blackPlayerKey, {
      isPass: true,
      expectedVersion: game.version,
    });
    const scoring = await submitMove(gameId, game.whitePlayerKey, {
      isPass: true,
      expectedVersion: firstPass.version,
    });
    const revision = scoring.scoring!.revision;
    await confirmScore(gameId, game.blackPlayerKey, revision);
    const scored = await confirmScore(gameId, game.whitePlayerKey, revision);
    assert.equal(scored.result, "W+6.5");
    await phone.waitForURL(/\/tournaments$/);
    await expect(phone.getByText("1 / 10 Partien")).toBeVisible();
    const won = scored.winnerKey === `user:${alice.id}`;
    await expect(
      phone
        .locator(".tournament-live .rapid-standings tr[data-self=true] td")
        .last(),
    ).toHaveText(
      new Intl.NumberFormat("de", { signDisplay: "exceptZero" }).format(
        won ? 6.5 : -6.5,
      ),
    );

    await query(
      "UPDATE tournaments SET ends_at=statement_timestamp() WHERE id=$1",
      [rapid.id],
    );
    await getTournamentDetail(alice.id, rapid.id);
    await tablet.goto(`${app}/de/tournaments`);
    await expect(
      tablet.getByRole("heading", { name: "Weltweit", exact: true }),
    ).toBeVisible();
    const winner =
      scored.winnerKey === `user:${alice.id}` ? "App Player" : "Web Player";
    await expect(
      tablet.getByRole("row", { name: new RegExp(`${winner}.*9`) }).first(),
    ).toBeVisible();
    const friends = tablet
      .locator(".tournament-standings")
      .filter({
        has: tablet.getByRole("heading", { name: "Freunde", exact: true }),
      });
    await expect(
      friends.getByRole("row", { name: new RegExp(`${winner}.*9`) }),
    ).toBeVisible();
    await tablet.getByText("Turnierhistorie", { exact: true }).click();
    await expect(tablet.locator(".tournament-history")).toContainText(
      winner === "App Player" ? "#1" : "#2",
    );
    await noOverflow(tablet);
    await tablet.screenshot({
      path: `${audit}/ipad-rapid.png`,
      fullPage: true,
    });
    await phone.goto(`${app}/de/profile`);
    await expect(
      phone
        .locator(".profile-metrics article")
        .filter({ hasText: "Turniersiege" })
        .locator("strong"),
    ).toHaveText(winner === "App Player" ? "1" : "0");

    await android.goto(`${app}/de/tournaments`);
    await android
      .getByRole("button", { name: "Turnier erstellen", exact: true })
      .click();
    await android.getByLabel("Name", { exact: true }).fill("Android Cup");
    await android
      .getByRole("button", { name: "Turnier erstellen", exact: true })
      .last()
      .click();
    await android.waitForURL(/\/tournaments\/[0-9a-f-]+$/);
    const privateId = new URL(android.url()).pathname.split("/").at(-1)!;
    events.push(privateId);
    await noOverflow(android);
    const code = await android
      .locator(".tournament-invite-code strong")
      .innerText();
    await phone.goto(`${app}/de/tournaments`);
    await phone
      .getByRole("textbox", { name: "Turniercode", exact: true })
      .fill(code);
    await phone
      .getByRole("button", { name: "Mit Code beitreten", exact: true })
      .click();
    await phone.waitForURL(new RegExp(privateId));
    await android
      .getByRole("button", { name: "Turnier starten", exact: true })
      .click();
    await Promise.all(
      [android, phone].map((page) =>
        page.getByRole("button", { name: "Bereit", exact: true }).click(),
      ),
    );
    await Promise.all(
      [android, phone].map((page) => page.waitForURL(/\/game\//)),
    );
    const privateGameId = new URL(android.url()).pathname.split("/").at(-1)!;
    const final = await resignGame(privateGameId, `user:${alice.id}`);
    assert.equal(final.rated, false);
    await android.waitForURL(new RegExp(privateId));
    await expect(android.locator(".tournament-result")).toContainText("#1");
    await noOverflow(android);
    await android.screenshot({
      path: `${audit}/android-private.png`,
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    console.log(
      "Bundled iPhone/iPad/Android layouts, real cross-client Rapid, profile wins, history and private tournament lifecycle passed.",
    );
  } catch (error) {
    await phone
      ?.screenshot({ path: `${audit}/failure.png`, fullPage: true })
      .catch(() => undefined);
    throw error;
  } finally {
    for (const browser of browsers) await browser.close();
    await server.close();
    if (events.length)
      await query("DELETE FROM tournaments WHERE id=ANY($1::uuid[])", [events]);
    if (users.length)
      await query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
  }
}

void run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closePool);
