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
