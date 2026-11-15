import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"] as const) {
  test(`native ${theme} account stones use restrained lighting`, async ({ page }, info) => {
    await page.addInitScript(value => localStorage.setItem("gostone.mobile.theme.v1", value), theme);
    await page.route("**/api/**", route => route.fulfill({
      contentType: "application/json", body: JSON.stringify({ ok: true, user: null, providers: [] }),
    }));
    for (const path of ["/de/login", "/de/register"]) {
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("data-mobile-theme", theme);
      const stone = page.locator(".mobile-auth-mark span");
      await expect(stone).toBeVisible();
      await expect(page.locator(".mobile-splash")).toBeHidden();
      const background = await stone.evaluate(node => getComputedStyle(node).backgroundImage);
      expect(background).toContain("radial-gradient");
      expect(background).not.toContain("rgb(255, 255, 255)");
      const field = page.locator(".auth-card .input-wrap").first();
      await expect(field).toHaveCSS("background-color", theme === "dark" ? "rgb(48, 46, 39)" : "rgb(245, 241, 233)");
      const placeholder = await field.locator("input").evaluate(node => ({
        color: getComputedStyle(node, "::placeholder").color,
        opacity: getComputedStyle(node, "::placeholder").opacity,
      }));
      expect(placeholder.color).toBe(theme === "dark" ? "rgb(198, 193, 185)" : "rgb(113, 106, 96)");
      expect(placeholder.opacity).toBe("1");
      await page.screenshot({ path: `.cache/native-stone-${theme}-${path.replaceAll("/", "-")}-${info.project.name}.png` });
    }
  });
}
