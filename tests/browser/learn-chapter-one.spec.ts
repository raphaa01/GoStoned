import { expect, test } from "@playwright/test";

test("completes and remembers interactive chapter-one lessons", async ({ page }) => {
  await page.goto("/de/learn");

  await expect(page.getByRole("heading", { name: "Deine ersten sechs Go-Lektionen." })).toBeVisible();
  await expect(page.getByRole("grid", { name: "Interaktives Lernbrett" })).toBeVisible();

  await page.locator('[data-coordinate="C4"]').click();
  await expect(page.getByText(/Der goldene Punkt ist nun/)).toBeVisible();
  await expect(page.getByText("1/6")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: /1\. Das Spielziel/ })).toHaveClass(/is-complete/);

  await page.getByRole("button", { name: /2\. Schwarz und Weiß/ }).click();
  await page.locator('[data-coordinate="B6"]').click();
  await page.locator('[data-coordinate="C6"]').click();
  await page.locator('[data-coordinate="D6"]').click();

  await expect(page.getByText(/Drei Zugpaare sind vollständig/)).toBeVisible();
  await expect(page.getByText("2/6")).toBeVisible();
});
