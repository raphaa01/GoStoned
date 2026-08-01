import { expect, test, type Page, type Route } from "@playwright/test";
import { de } from "../../lib/i18n/catalogs/de";
import { en } from "../../lib/i18n/catalogs/en";

const USER = {
  id: "11111111-1111-4111-8111-111111111111",
  username: "global_player",
  displayName: "Global Player",
  playerKey: "user:11111111-1111-4111-8111-111111111111",
};

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    body: JSON.stringify(body),
    contentType: "application/json",
    status,
  });
}

async function assertNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(
    dimensions.scrollWidth,
    `document width ${dimensions.scrollWidth}px exceeds viewport ${dimensions.clientWidth}px`,
  ).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

for (const [locale, dictionary] of [["en", en], ["de", de]] as const) {
  test(`${locale.toUpperCase()} onboarding, global leaderboard, and rating preferences are honest and responsive`, async ({ page }) => {
    let signedIn = false;
    let registrationBody: unknown;
    let preferenceBody: unknown;
    let ratingDisplayPreference = "both";

    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (pathname === "/api/auth/session") {
        await fulfillJson(route, { ok: true, user: signedIn ? USER : null });
        return;
      }
      if (pathname === "/api/auth/register" && request.method() === "POST") {
        registrationBody = request.postDataJSON();
        await fulfillJson(route, { ok: false, code: "username_taken" }, 409);
        return;
      }
      if (pathname === "/api/stats") {
        await fulfillJson(route, {
          ok: true,
          observedAt: "2026-07-31T12:00:00.000Z",
          leaderboard: [{
            position: 1,
            playerName: "Honest Human",
            games: 24,
            wins: 15,
            rating: 1642.4,
            ratingDeviation: 58.2,
          }],
        });
        return;
      }
      if (pathname === "/api/profile") {
        await fulfillJson(route, {
          ok: true,
          user: USER,
          rating: {
            rating: 1642.4,
            ratingDeviation: 58.2,
            volatility: 0.06,
            ratedGameCount: 24,
            isProvisional: false,
            algorithmVersion: "glicko2-global-v1",
            lastRatingPeriodAt: "2026-07-30T12:00:00.000Z",
            highestRating: 1660,
            ratingChange30Days: 42.4,
          },
          preferences: {
            displayPreference: "both",
            botMatchPreference: "never",
            handicapPreference: "even-only",
            preferenceRevision: 1,
            startingStrengthEstimate: "known",
            knownRank: "12k",
          },
          history: [{
            id: "rated-game-1:user",
            gameId: "rated-game-1",
            boardSize: 19,
            ratingBefore: 1600,
            ratingAfter: 1642.4,
            ratingChange: 42.4,
            result: "win",
            recordedAt: "2026-07-30T12:00:00.000Z",
          }],
          recentGames: [{
            gameId: "rated-game-1",
            boardSize: 19,
            timeControl: "rapid",
            opponentName: "Calibrated KataGo",
            opponentIsBot: true,
            opponentBotProfileVersion: "calibrated-bot-profile-v1",
            result: "win",
            gameResult: "B+R",
            ratingBefore: 1600,
            ratingAfter: 1642.4,
            ratingChange: 42.4,
            rated: true,
            finishedAt: "2026-07-30T12:00:00.000Z",
            moveCount: 81,
          }],
        });
        return;
      }
      if (pathname === "/api/profile/rating") {
        await fulfillJson(route, {
          ok: true,
          rating: {
            value: 1642.4,
            deviation: 58.2,
            isProvisional: false,
            displayPreference: ratingDisplayPreference,
          },
        });
        return;
      }
      if (pathname === "/api/profile/preferences" && request.method() === "PATCH") {
        preferenceBody = request.postDataJSON();
        ratingDisplayPreference = "rank-primary";
        await fulfillJson(route, {
          ok: true,
          preferences: {
            displayPreference: "rank-primary",
            botMatchPreference: "calibrated-rated-after-wait",
            preferenceRevision: 2,
          },
        });
        return;
      }
      if (pathname === "/api/profile/preferences" && request.method() === "GET") {
        await fulfillJson(route, {
          ok: true,
          preferences: {
            displayPreference: "rank-primary",
            botMatchPreference: "never",
            preferenceRevision: 1,
          },
        });
        return;
      }
      await fulfillJson(route, { ok: false, code: "unexpected_browser_api" }, 501);
    });

    const prefix = locale === "en" ? "" : "/de";
    await page.goto(`${prefix}/register`);
    await page.getByLabel(dictionary.auth.username).fill("global_player");
    await page.getByLabel(dictionary.auth.password).fill("correct-horse-battery");
    await page.getByLabel(dictionary.auth.startingStrength).selectOption("known");
    await expect(page.getByLabel(dictionary.auth.knownRank)).toBeVisible();
    await page.getByLabel(dictionary.auth.knownRank).selectOption("3d");
    await page.getByRole("button", { name: dictionary.auth.createAccount }).click();
    await expect(page.locator(".form-error")).toContainText(dictionary.auth.errors.username_taken);
    expect(registrationBody).toEqual({
      username: "global_player",
      password: "correct-horse-battery",
      startingStrength: "known",
      knownRank: "3d",
    });
    await assertNoHorizontalOverflow(page);

    signedIn = true;
    await page.goto(`${prefix}/leaderboard`);
    await expect(page.getByRole("heading", { name: dictionary.leaderboard.title })).toBeVisible();
    await expect(page.getByRole("rowheader", { name: "Honest Human" })).toBeVisible();
    await expect(page.locator("tbody td:last-child strong")).toHaveText(
      locale === "de" ? "8. Kyu" : "8 kyu",
    );
    await expect(page.getByText(dictionary.leaderboard.globalScope, { exact: false }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /9|13|19/ })).toHaveCount(0);
    await assertNoHorizontalOverflow(page);

    await page.goto(`${prefix}/profile`);
    await expect(page.getByText(dictionary.profile.globalRating, { exact: true })).toBeVisible();
    await expect(page.locator(".profile-header__rating .rating-label")).toContainText(
      locale === "de" ? "8. Kyu" : "8 kyu",
    );
    if ((page.viewportSize()?.width ?? 0) > 840) {
      await expect(page.locator(".sidebar-user .rating-label")).toContainText(
        locale === "de" ? "8. Kyu" : "8 kyu",
      );
    } else {
      await page.getByRole("button", { name: dictionary.nav.openMenu }).click();
      await expect(page.locator(".mobile-menu .rating-label")).toContainText(
        locale === "de" ? "8. Kyu" : "8 kyu",
      );
      await page.getByRole("button", { name: dictionary.nav.closeMenu }).click();
    }
    await expect(page.getByText("Calibrated KataGo", { exact: false })).toBeVisible();
    await expect(
      page.getByRole("link", {
        name: new RegExp(`Calibrated KataGo.*${dictionary.profile.botBadge}`),
      }),
    ).toBeVisible();
    await expect(page.locator(".rating-chart svg")).toBeVisible();
    await page.locator(".rating-preferences-shell > summary").click();
    await expect(page.getByText(dictionary.profile.botCalibrationNotice, { exact: true })).toBeVisible();
    await page.getByLabel(dictionary.profile.displayPreference).selectOption("rank-primary");
    await page.getByLabel(dictionary.profile.botPreference).selectOption("calibrated-rated-after-wait");
    await page.getByRole("button", { name: dictionary.profile.savePreferences }).click();
    await expect(page.getByRole("status").filter({ hasText: dictionary.profile.preferencesSaved })).toBeVisible();
    expect(preferenceBody).toEqual({
      displayPreference: "rank-primary",
      botMatchPreference: "calibrated-rated-after-wait",
    });
    await expect(page.locator(".profile-rating-band .rating-label")).toContainText(
      locale === "de" ? "8. Kyu" : "8 kyu",
    );
    await assertNoHorizontalOverflow(page);
  });
}
