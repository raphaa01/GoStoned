import { expect, test } from "@playwright/test";
import { GAME_ID, USER, installHarness } from "./boardDesignHarness";

export function communityFlow(mobile: boolean) {
  test("registration requires an explicit rule agreement and reading rules preserves the form", async ({ page }) => {
    await page.route("**/api/**", route => route.fulfill({ json: { ok: true, user: null, providers: [] } }));
    await page.goto("/de/register");
    if (mobile) await expect(page.locator(".mobile-splash")).toHaveAttribute("aria-hidden", "true");
    await page.getByLabel("Benutzername", { exact: true }).fill("quiet_player");
    await page.getByLabel("E-Mail-Adresse", { exact: true }).fill("quiet@example.test");
    await page.getByLabel("Passwort", { exact: true }).fill("correct-horse-battery");
    const agreement = page.locator('input[name="communityRules"]');
    await expect(agreement).not.toBeChecked();
    await page.getByRole("button", { name: "Konto erstellen", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "Community-Regeln", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("Behandle andere respektvoll");
    await page.getByRole("dialog").getByRole("button", { name: "Abbrechen", exact: true }).click();
    await expect(page.getByLabel("Benutzername", { exact: true })).toHaveValue("quiet_player");
    await expect(page.getByRole("link", { name: "Datenschutz", exact: true }).first()).toBeVisible();
    await agreement.check();
    await page.getByRole("button", { name: "Konto erstellen", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Kannst du schon Go spielen?" })).toBeVisible();
  });

  test("a private game report can retry without sending a target or disrupting the board", async ({ page }) => {
    await installHarness(page);
    const payloads: unknown[] = [];
    await page.route(`**/api/games/${GAME_ID}/report`, async route => {
      payloads.push(route.request().postDataJSON());
      if (payloads.length === 1) return route.abort("failed");
      await route.fulfill({ json: { ok: true, actor: USER.playerKey, reported: true } });
    });
    await page.goto(`/de/game/${GAME_ID}`);
    if (mobile) await expect(page.locator(".mobile-splash")).toHaveAttribute("aria-hidden", "true");
    // The board stays intact while safety controls are used.
    await expect(page.locator(".go-board .stone")).toHaveCount(2);
    const stones = 2;
    await page.getByRole("button", { name: "Spieler melden", exact: true }).click();
    await page.getByLabel("Grund", { exact: true }).selectOption("threat_or_sexual_safety");
    await page.getByRole("button", { name: "Meldung senden", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("Bitte erneut versuchen.");
    await page.getByRole("button", { name: "Meldung senden", exact: true }).click();
    await expect(page.getByRole("button", { name: "Meldung eingegangen", exact: true })).toBeDisabled();
    expect(payloads).toEqual([{ category: "threat_or_sexual_safety" }, { category: "threat_or_sexual_safety" }]);
    await expect(page.locator(".go-board .stone")).toHaveCount(stones);
  });

  test("a slow report can be dismissed while its submission completes", async ({ page }) => {
    await installHarness(page);
    let finish!: () => void;
    const release = new Promise<void>(resolve => { finish = resolve; });
    await page.route(`**/api/games/${GAME_ID}/report`, async route => {
      await release;
      await route.fulfill({ json: { ok: true, actor: USER.playerKey, reported: true } });
    });
    try {
      await page.goto(`/de/game/${GAME_ID}`);
      if (mobile) await expect(page.locator(".mobile-splash")).toHaveAttribute("aria-hidden", "true");
      await expect(page.locator(".go-board .stone")).toHaveCount(2);
      await page.getByRole("button", { name: "Spieler melden", exact: true }).click();
      await page.getByRole("button", { name: "Meldung senden", exact: true }).click();
      await expect(page.getByRole("button", { name: "Wird gesendet…", exact: true })).toBeDisabled();
      await page.getByRole("button", { name: "Abbrechen", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.locator(".go-board .stone")).toHaveCount(2);
      finish();
      await expect(page.getByRole("button", { name: "Meldung eingegangen", exact: true })).toBeDisabled();
    } finally { finish(); }
  });
}
