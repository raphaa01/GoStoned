import { expect, test } from "@playwright/test";

const user = {
  id: "11111111-1111-4111-8111-111111111111",
  username: "legacy_player", displayName: "Legacy Player",
  playerKey: "user:11111111-1111-4111-8111-111111111111",
};

test("legacy email gate survives navigation and Escape, can save email, and offers logout", async ({ page }) => {
  let signedIn = true;
  let needsEmail = true;
  let saved: unknown;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = { ok: true };
    if (path === "/api/auth/session") body = { ok: true, user: signedIn ? { ...user, ...(needsEmail ? { emailRequired: true } : {}) } : null };
    else if (path === "/api/auth/email") { saved = route.request().postDataJSON(); needsEmail = false; }
    else if (path === "/api/auth/logout") signedIn = false;
    else if (path === "/api/profile/rating") body = { ok: true, rating: null };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("/de/leaderboard");
  await expect(page.getByRole("heading", { name: "E-Mail-Adresse ergänzen" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".account-email-gate")).toBeVisible();
  await page.goto("/de/login");
  await expect(page.locator(".account-email-gate")).toBeVisible();
  await page.getByLabel("E-Mail-Adresse", { exact: true }).fill("legacy@example.test");
  await page.getByRole("button", { name: "E-Mail speichern und fortfahren" }).click();
  await expect(page.locator(".account-email-gate")).toHaveCount(0);
  expect(saved).toEqual({ email: "legacy@example.test" });

  needsEmail = true;
  await page.reload();
  await expect(page.locator(".account-email-gate")).toBeVisible();
  await page.getByRole("button", { name: "Abmelden", exact: true }).click();
  await expect(page.locator(".account-email-gate")).toHaveCount(0);
  await expect(page.getByLabel("E-Mail oder Benutzername", { exact: true })).toBeVisible();
});

test("social accounts continue without an email gate", async ({ page }) => {
  await page.route("**/api/**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(new URL(route.request().url()).pathname === "/api/auth/session"
      ? { ok: true, user } : { ok: true, rating: null }),
  }));
  await page.goto("/de/login");
  await expect(page.getByRole("heading", { name: "Du bist bereits angemeldet" })).toBeVisible();
  await expect(page.locator(".account-email-gate")).toHaveCount(0);
});

test("password recovery submits the email, handles a wrong code, and returns to login after success", async ({ page }) => {
  const submitted: unknown[] = [];
  let redemption = 0;
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/password-reset") {
      const body = route.request().postDataJSON();
      submitted.push(body);
      if (body.action === "reset" && redemption++ === 0) {
        await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ ok: false, code: "invalid_reset_code" }) });
        return;
      }
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, user: null }) });
  });
  await page.goto("/de/login");
  await page.getByRole("button", { name: "Passwort vergessen?" }).click();
  await page.getByLabel("E-Mail-Adresse", { exact: true }).fill("player@example.test");
  await page.getByRole("button", { name: "Code senden", exact: true }).click();
  await expect(page.getByLabel("E-Mail-Adresse", { exact: true })).toBeDisabled();
  await page.getByLabel("8-stelliger Code").fill("12345678");
  await page.getByLabel("Neues Passwort", { exact: true }).fill("replacement123");
  await page.getByRole("button", { name: "Neues Passwort speichern" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Der Code ist falsch" })).toBeVisible();
  await page.getByLabel("8-stelliger Code").fill("87654321");
  await page.getByRole("button", { name: "Neues Passwort speichern" }).click();
  await expect(page.getByRole("status")).toContainText("Dein Passwort wurde zurückgesetzt");
  expect(submitted).toEqual([
    { action: "request", email: "player@example.test" },
    { action: "reset", email: "player@example.test", code: "12345678", password: "replacement123" },
    { action: "reset", email: "player@example.test", code: "87654321", password: "replacement123" },
  ]);
  await page.getByRole("button", { name: "Zurück zur Anmeldung" }).click();
  await expect(page.getByLabel("E-Mail oder Benutzername", { exact: true })).toBeVisible();
});
