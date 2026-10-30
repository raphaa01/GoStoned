import { expect, test } from "@playwright/test";
import { installHarness, USER } from "./boardDesignHarness";

// The same contract is exercised in Next.js and the bundled iOS/Android client.
export function accountDeletionFlow() {
  for (const incomplete of [false, true]) test(`account deletion needs only confirmation${incomplete ? " even without a saved email" : ""}`, async ({ page }) => {
    await installHarness(page);
    let deleted = false;
    let attempts = 0;
    const submitted: unknown[] = [];
    const receipt = { id: "deletion-receipt", status: "completed", requestedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(), dueAt: new Date().toISOString() };
    await page.route("**/api/auth/session", route => route.fulfill({ json: { ok: true,
      user: deleted ? null : { ...USER, ...(incomplete ? { emailRequired: true } : {}) } } }));
    await page.route("**/api/account/deletion-request", async route => {
      if (route.request().method() === "POST") {
        submitted.push(route.request().postDataJSON());
        if (attempts++ === 0) return route.fulfill({ status: 503, json: { ok: false, code: "deletion_failed" } });
        deleted = true;
      }
      return route.fulfill({ json: { ok: true, enabled: true, hasIdentity: !deleted, request: deleted ? receipt : null } });
    });
    // The email gate renders on login as well; it must offer deletion without
    // completing registration, adding an email, or creating a password.
    await page.goto(incomplete ? "/de/login" : "/de/delete-account");
    await page.evaluate(id => {
      localStorage.setItem(`gostone.learn.path.v1:${id}`, "private-progress");
      localStorage.setItem("gostone.learn.path.v1:another-account", "keep");
    }, USER.id);
    const flow = page.locator(".account-deletion-flow");
    const remove = flow.getByRole("button", { name: "Konto löschen", exact: true });
    await expect(remove).toBeVisible();
    await remove.click();
    await expect(remove).toBeDisabled();
    await flow.getByRole("button", { name: "Abbrechen" }).click();
    expect(submitted).toHaveLength(0);
    await remove.click();
    await flow.getByRole("checkbox").check();
    await remove.click();
    await expect(flow.getByRole("alert")).toContainText("konnte nicht abgeschlossen werden");
    expect(deleted).toBe(false);
    await remove.click();
    await expect(page).toHaveURL(/\/de\/delete-account$/);
    await expect(page.locator(".account-deletion-flow").getByRole("status")).toContainText("wurden gelöscht");
    await expect(page.locator(".account-email-gate")).toHaveCount(0);
    expect(submitted).toEqual([{ confirmed: true }, { confirmed: true }]);
    expect(await page.evaluate(id => localStorage.getItem(`gostone.learn.path.v1:${id}`), USER.id)).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem("gostone.learn.path.v1:another-account"))).toBe("keep");
    await page.reload();
    await expect(page.locator(".account-deletion-flow").getByRole("status")).toContainText("wurden gelöscht");
  });

  test("signed-out deletion page links to existing login and returns directly to deletion", async ({ page }) => {
    await page.route("**/api/**", route => route.fulfill({ json: { ok: true, user: null,
      enabled: true, hasIdentity: false, request: null, providers: [] } }));
    await page.goto("/de/delete-account");
    await page.locator(".account-deletion-flow").getByRole("link", { name: "Anmelden", exact: true }).click();
    await expect(page).toHaveURL(/\/de\/login\?returnTo=%2Fdelete-account$/);
  });
}
