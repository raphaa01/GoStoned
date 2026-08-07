import { expect, test } from "@playwright/test";

test("requires an account before opening the interactive lessons", async ({ page }) => {
  await page.goto("/de/learn");

  await expect(page).toHaveURL(/\/de\/register\?returnTo=%2Flearn$/);
  await expect(page.getByRole("heading", { name: "Erstelle dein Konto" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Anmelden" }).last()).toHaveAttribute(
    "href",
    "/de/login?returnTo=%2Flearn",
  );
  await expect(page.getByRole("grid", { name: "Interaktives Lernbrett" })).toHaveCount(0);
});
