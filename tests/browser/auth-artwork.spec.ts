import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"] as const) {
  test(`${theme} stone artwork blends into home and account pages`, async ({ page }, info) => {
    await page.addInitScript(value => localStorage.setItem("gostone.theme.v1", value), theme);
    await page.route("**/api/**", route => route.fulfill({
      contentType: "application/json", body: JSON.stringify({ ok: true, user: null }),
    }));
    for (const path of ["/de", "/de/login", "/de/register"]) {
      await page.goto(path);
      const container = page.locator(path === "/de" ? ".hero-stone-stage" : ".auth-material");
      const image = container.locator(`.stone-artwork--${theme}`);
      await expect(image).toBeVisible();
      await expect(container.locator(`.stone-artwork--${theme === "dark" ? "light" : "dark"}`)).toBeHidden();
      await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      expect(await image.evaluate(node => getComputedStyle(node).filter)).toBe("none");
      if (theme === "dark") expect(await image.getAttribute("src")).toContain("gostone-hero-stone-dark");
      if (path !== "/de") expect(await image.evaluate(node => getComputedStyle(node).maskImage)).toContain("radial-gradient");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
      if (info.project.name.includes("1440") || info.project.name.includes("1280")) {
        await page.screenshot({ path: `.cache/stone-${theme}-${path.replaceAll("/", "-")}-${info.project.name}.png` });
      }
    }
  });
}
