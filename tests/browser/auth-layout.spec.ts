import { expect, test, type Page } from "@playwright/test";
import { getBeginnerGuideCopy } from "../../lib/i18n/beginnerGuide";

async function authControlOrder(page: Page): Promise<string[]> {
  return page.locator(".auth-card").evaluate((card) =>
    Array.from(card.querySelectorAll(".auth-submit, .auth-social-button"))
      .map((element) => {
        if (element.classList.contains("auth-submit")) return "submit";
        return element.textContent?.includes("Google") ? "google" : "social";
      }),
  );
}

test("keeps account creation first and moves experience setup into onboarding", async ({ page }) => {
  const onboarding = getBeginnerGuideCopy("en").onboarding;
  await page.goto("/register");

  await expect(page.getByText("Keep your ratings and play under one username.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: onboarding.canPlayTitle })).toHaveCount(0);
  expect(await authControlOrder(page)).toEqual(["submit", "google"]);

  await page.getByRole("textbox", { name: "Username" }).fill("new_player");
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  const onboardingDialog = page.getByRole("dialog", { name: onboarding.canPlayTitle });
  await expect(onboardingDialog).toBeVisible();
  await expect(onboardingDialog.getByRole("button", { name: onboarding.canPlayYes })).toBeVisible();
  await expect(onboardingDialog.getByRole("button", { name: onboarding.canPlayNo })).toBeVisible();

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
