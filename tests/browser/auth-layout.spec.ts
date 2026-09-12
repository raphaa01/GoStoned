import { expect, test, type Page } from "@playwright/test";

async function authControlOrder(page: Page): Promise<string[]> {
  return page.locator(".auth-card").evaluate((card) =>
    Array.from(card.querySelectorAll(".auth-submit, .auth-social-button, .auth-strength"))
      .map((element) => {
        if (element.classList.contains("auth-submit")) return "submit";
        if (element.classList.contains("auth-strength")) return "strength";
        return element.textContent?.includes("Google") ? "google" : "social";
      }),
  );
}

test("keeps account creation first and optional strength after social sign-in", async ({ page }) => {
  await page.goto("/register");

  await expect(page.getByText("Keep your ratings and play under one username.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Continue with Google" })).toBeVisible();
  await expect(page.locator("details.auth-strength")).not.toHaveAttribute("open", "");
  expect(await authControlOrder(page)).toEqual(["submit", "google", "strength"]);

  await page.goto("/login");

  await expect(page.getByText("Continue with your saved profile and ratings.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Continue with Google" })).toBeVisible();
  expect(await authControlOrder(page)).toEqual(["submit", "google"]);
});

test("uses one clear focus treatment for account fields", async ({ page }) => {
  await page.goto("/register");

  const username = page.getByRole("textbox", { name: "Username" });
  await username.focus();

  await expect(username).toBeFocused();
  expect(await username.evaluate((input) => getComputedStyle(input).outlineStyle)).toBe("none");
  expect(await username.locator("..").evaluate((wrapper) => getComputedStyle(wrapper).borderColor))
    .not.toBe("rgba(0, 0, 0, 0)");
});
