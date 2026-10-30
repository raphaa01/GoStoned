import { expect, test } from "@playwright/test";
import { accountDeletionFlow } from "../shared/accountDeletionFlow";
import { installHarness } from "../shared/boardDesignHarness";

accountDeletionFlow();

test("native settings offer account deletion inside the app", async ({ page }) => {
  await installHarness(page);
  await page.route("**/api/account/deletion-request", route => route.fulfill({ json: {
    ok: true, enabled: true, hasIdentity: true, request: null,
  } }));
  await page.goto("/de/profile/settings");
  await expect(page.locator(".account-deletion-flow").getByRole("button", { name: "Konto löschen", exact: true })).toBeVisible();
});
