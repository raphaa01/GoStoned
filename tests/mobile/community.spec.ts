import { expect, test } from "@playwright/test";
import { communityFlow } from "../shared/communityHarness";
communityFlow(true);
test("privacy, rules and contact are reachable on the signed-out app home", async ({ page }) => {
  await page.route("**/api/**", route => route.fulfill({ json: { ok: true, user: null } }));
  await page.goto("/de/");
  await expect(page.getByRole("link", { name: "Datenschutz", exact: true })).toHaveAttribute("href", "https://gostone.app/de/privacy");
  await expect(page.getByRole("link", { name: "Community-Regeln", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Kontakt", exact: true })).toBeVisible();
});
