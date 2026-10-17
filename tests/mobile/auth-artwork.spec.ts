import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"] as const) {
  test(`native ${theme} home and account stones use restrained lighting`, async ({ page }, info) => {
    await page.addInitScript(value => localStorage.setItem("gostone.mobile.theme.v1", value), theme);
    await page.route("**/api/**", route => route.fulfill({
      contentType: "application/json", body: JSON.stringify({ ok: true, user: null, providers: [] }),
    }));
    for (const path of ["/de", "/de/login", "/de/register"]) {
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("data-mobile-theme", theme);
      const stone = page.locator(path === "/de" ? ".mobile-home-stone span" : ".mobile-auth-mark span");
      await expect(stone).toBeVisible();
      await expect(page.locator(".mobile-splash")).toBeHidden();
      const background = await stone.evaluate(node => getComputedStyle(node).backgroundImage);
      expect(background).toContain("radial-gradient");
      expect(background).not.toContain("rgb(255, 255, 255)");
      await page.screenshot({ path: `.cache/native-stone-${theme}-${path.replaceAll("/", "-")}-${info.project.name}.png` });
    }
  });
}
