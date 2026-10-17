import { expect, test, type Locator, type Page } from "@playwright/test";
import { getBeginnerGuideCopy } from "../../lib/i18n/beginnerGuide";
import { getBoardPlacementCopy } from "../../lib/i18n/boardPlacement";

// Reproduce password managers that change the DOM without input/change events.
async function autofill(field: Locator, value: string) {
  await field.evaluate((input, nextValue) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, nextValue);
  }, value);
}

async function installApi(page: Page) {
  const submissions: Array<{ path: string; body: Record<string, unknown> }> = [];
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let body: object = { ok: true, user: null, providers: [] };
    let status = 200;
    if (route.request().method() === "POST") {
      submissions.push({ path, body: route.request().postDataJSON() });
      if (path === "/api/auth/login" || path === "/api/auth/register") {
        status = 401;
        body = { ok: false, code: "invalid_credentials" };
      }
    }
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  });
  return submissions;
}

export function registerAuthAutofillTests(mobile: boolean) {
  test("autofilled login submits visible credentials by click and Enter without opening recovery", async ({ page }) => {
    const submissions = await installApi(page);
    await page.goto("/de/login");
    const form = page.locator(".auth-form");
    await expect(form).toBeVisible();
    await expect(form.locator("button")).toHaveCount(1);
    const username = form.locator('[name="username"]');
    const password = form.locator('[name="password"]');
    await autofill(username, "Saved_Player");
    await autofill(password, "  saved-password-42  ");
    await form.getByRole("button", { name: "Anmelden", exact: true }).click();
    await expect(form.getByRole("alert")).toBeVisible();
    await expect(password).toHaveValue("  saved-password-42  ");
    await autofill(username, "saved@example.test");
    await autofill(password, "replacement-password-123");
    await password.press("Enter");
    await expect.poll(() => submissions.length).toBe(2);
    expect(submissions).toEqual([
      { path: "/api/auth/login", body: { username: "Saved_Player", password: "  saved-password-42  " } },
      { path: "/api/auth/login", body: { username: "saved@example.test", password: "replacement-password-123" } },
    ]);
    await expect(page.getByRole("heading", { name: "Anmelden", exact: true })).toBeVisible();
  });

  test("autofilled registration preserves all fields through onboarding and retries", async ({ page }) => {
    const submissions = await installApi(page);
    const onboarding = getBeginnerGuideCopy("de").onboarding;
    const placement = getBoardPlacementCopy("de");
    await page.goto("/de/register");
    const form = page.locator(".auth-form");
    await expect(form).toBeVisible();
    await autofill(form.locator('[name="username"]'), "New_Player");
    await autofill(form.locator('[name="email"]'), "new@example.test");
    await autofill(form.locator('[name="password"]'), "generated-password-123");
    await form.locator('button[type="submit"]').click();
    await page.getByRole("button", { name: onboarding.canPlayNo, exact: true }).click();
    await page.getByRole("button", { name: new RegExp(placement.zoom) }).click();
    await page.getByRole("button", { name: onboarding.skipTutorial, exact: true }).click();
    await expect(form.getByRole("alert")).toBeVisible();
    expect(submissions).toEqual([{ path: "/api/auth/register", body: {
      username: "New_Player", email: "new@example.test", password: "generated-password-123",
      startingStrength: "new", knownRank: null, boardPlacement: "zoom",
    } }]);
    await expect(form.locator('[name="email"]')).toHaveValue("new@example.test");
    await expect(form.locator('[name="password"]')).toHaveValue("generated-password-123");
  });

  test("recovery reads autofilled email, code and new password and resends to the same address", async ({ page }) => {
    const submissions = await installApi(page);
    await page.goto("/de/login");
    await page.getByRole("button", { name: "Passwort vergessen?" }).click();
    const form = page.locator(".auth-form");
    await autofill(form.locator('[name="email"]'), "recovery@example.test");
    await form.locator('button[type="submit"]').click();
    await expect(form.locator('[name="email"]')).toBeDisabled();
    await page.getByRole("button", { name: "Neuen Code senden", exact: true }).click();
    await expect.poll(() => submissions.length).toBe(2);
    await expect(form.locator('button[type="submit"]')).toBeEnabled();
    await autofill(form.locator('[name="code"]'), "12345678");
    await autofill(form.locator('[name="password"]'), "  new-password-123  ");
    await form.locator('[name="password"]').press("Enter");
    await expect(page.getByRole("status")).toContainText("Dein Passwort wurde zurückgesetzt");
    expect(submissions).toEqual([
      { path: "/api/auth/password-reset", body: { action: "request", email: "recovery@example.test" } },
      { path: "/api/auth/password-reset", body: { action: "request", email: "recovery@example.test" } },
      { path: "/api/auth/password-reset", body: { action: "reset", email: "recovery@example.test", code: "12345678", password: "  new-password-123  " } },
    ]);
    await page.getByRole("button", { name: "Zurück zur Anmeldung" }).click();
    await expect(page.getByRole("heading", { name: "Anmelden", exact: true })).toBeVisible();
    await expect(page.locator('[name="password"]')).toHaveValue("");
  });

  test("invalid registration and recovery fields do not send requests", async ({ page }) => {
    const submissions = await installApi(page);
    await page.goto("/de/register");
    const form = page.locator(".auth-form");
    await form.locator('[name="username"]').fill("Valid_Player");
    await form.locator('[name="email"]').fill("invalid-address");
    await form.locator('[name="password"]').fill("valid-password-123");
    await form.locator('button[type="submit"]').click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(submissions).toHaveLength(0);
    await page.goto("/de/login");
    await page.getByRole("button", { name: "Passwort vergessen?" }).click();
    await page.locator('[name="email"]').fill("invalid-address");
    await page.locator('button[type="submit"]').click();
    expect(submissions).toHaveLength(0);
  });

  test("pending login submits once, recovers from a network error and returns to play", async ({ page }) => {
    await installApi(page);
    let attempts = 0;
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/api/auth/login", async route => {
      attempts++;
      if (attempts === 1) {
        await pending;
        await route.abort("failed");
      } else {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
      }
    });
    // requestSubmit is synthetic and bypasses React's user-event hydration
    // replay. Wait for the provider effect before exercising duplicate submits.
    const sessionReady = page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/session");
    await page.goto("/de/login?returnTo=/play");
    await sessionReady;
    const form = page.locator(".auth-form");
    await autofill(form.locator('[name="username"]'), "saved_player");
    await autofill(form.locator('[name="password"]'), "saved-password-123");
    await form.evaluate(node => { (node as HTMLFormElement).requestSubmit(); (node as HTMLFormElement).requestSubmit(); });
    await expect.poll(() => attempts).toBe(1);
    await expect(form.locator('button[type="submit"]')).toBeDisabled();
    await expect(page.getByRole("button", { name: "Passwort vergessen?" })).toBeDisabled();
    release();
    await expect(form.getByRole("alert")).toBeVisible();
    await expect(form.locator('[name="password"]')).toHaveValue("saved-password-123");
    await form.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/de\/play$/);
    expect(attempts).toBe(2);
  });

  if (mobile) test("switching mobile account modes clears the previous credentials and recovery state", async ({ page }) => {
    await installApi(page);
    await page.goto("/de/register");
    await page.locator('[name="username"]').fill("previous_player");
    await page.locator('[name="password"]').fill("previous-password-123");
    await page.locator(".auth-switch").getByRole("link").click();
    await expect(page.getByRole("heading", { name: "Anmelden", exact: true })).toBeVisible();
    await expect(page.locator('[name="username"]')).toHaveValue("");
    await expect(page.locator('[name="password"]')).toHaveValue("");
    await page.getByRole("button", { name: "Passwort vergessen?" }).click();
    await page.goBack();
    await expect(page.locator('[name="username"]')).toBeVisible();
    await expect(page.locator('[name="email"]')).toBeEditable();
  });
}
