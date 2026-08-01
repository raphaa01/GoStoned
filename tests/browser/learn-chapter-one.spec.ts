import { expect, test } from "@playwright/test";

test("completes and remembers six distinct Go lessons", async ({ page }) => {
  await page.goto("/de/learn");

  await expect(page.getByRole("heading", { name: "Verstehe Go – Zug für Zug." })).toBeVisible();
  await expect(page.getByRole("grid", { name: "Interaktives Lernbrett" })).toBeVisible();

  await page.locator('[data-coordinate="C2"]').click();
  await expect(page.getByText(/goldene Punkt ist jetzt/)).toBeVisible();
  await expect(page.getByText("1/6")).toBeVisible();

  await page.getByRole("button", { name: /Nächste Lektion/ }).click();
  for (const coordinate of ["C4", "B3", "D3", "C2"]) {
    await page.locator(`[data-coordinate="${coordinate}"]`).click();
  }
  await expect(page.getByText(/Genau vier/)).toBeVisible();
  await expect(page.getByText("2/6")).toBeVisible();

  await page.getByRole("button", { name: /Nächste Lektion/ }).click();
  await page.locator('[data-coordinate="C2"]').click();
  await expect(page.locator(".lesson-board__point.is-white")).toHaveCount(0);

  await page.getByRole("button", { name: /Nächste Lektion/ }).click();
  await page.locator('[data-coordinate="C2"]').click();
  await expect(page.getByText(/Gerettet/)).toBeVisible();

  await page.getByRole("button", { name: /Nächste Lektion/ }).click();
  await page.locator('[data-coordinate="C3"]').click();
  await expect(page.getByText("Verbunden. Alle drei Steine bilden jetzt eine Gruppe und teilen ihre Freiheiten.")).toBeVisible();

  await page.getByRole("button", { name: /Nächste Lektion/ }).click();
  await page.locator('[data-coordinate="C1"]').click();
  await expect(page.locator(".lesson-board__point.is-white")).toHaveCount(0);
  await expect(page.getByText("6/6")).toBeVisible();
  await expect(page.getByText("Kapitel 1 abgeschlossen")).toBeVisible();

  await page.reload();
  await expect(page.locator(".lesson-rail__item.is-complete")).toHaveCount(6);
});
