import { expect, test } from "@playwright/test";

test("keeps the primary homepage action visible and proportionally anchored", async ({ page }) => {
  await page.goto("/");

  const hero = page.locator(".web-home__main");
  const startPlay = page.getByRole("link", { name: "Start a game" });

  await expect(hero).toBeVisible();
  await expect(startPlay).toBeVisible();

  const heroBox = await hero.boundingBox();
  const buttonBox = await startPlay.boundingBox();
  const viewport = page.viewportSize();

  expect(heroBox).not.toBeNull();
  expect(buttonBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (!heroBox || !buttonBox || !viewport) return;

  expect(buttonBox.x).toBeGreaterThanOrEqual(0);
  expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(viewport.width);
  expect(buttonBox.y).toBeGreaterThanOrEqual(heroBox.y);
  expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(viewport.height);

  const shortcuts = (await page.locator('.home-shortcuts').boundingBox())!;
  expect(buttonBox.y).toBeGreaterThanOrEqual(shortcuts.y + shortcuts.height);
});

test("puts tournaments and learning next to each other on the German home page", async ({ page }) => {
  await page.goto("/de");
  const tournaments = page.locator(".home-tournament");
  const learning = page.locator(".home-learning");
  await expect(tournaments).toHaveAttribute("href", "/de/tournaments");
  await expect(learning.locator("progress")).toHaveAttribute("max", /\d+/);
  const left = (await tournaments.boundingBox())!;
  const right = (await learning.boundingBox())!;
  expect(left.y).toBe(right.y);
  expect(left.x + left.width).toBeLessThan(right.x);
  await expect(page.locator("main a[href*='/puzzles']")).toHaveCount(0);
});

test("links from the German home page to GoStone in the App Store on iPhone", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" });
  });
  await page.goto("/de");

  const appStoreUrl = "https://apps.apple.com/de/app/gostone-lerne-und-spiele-go/id6819760816";
  const banner = page.getByRole("link", { name: "In der GoStone-App spielen App Store" });
  await expect(banner).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("link", { name: "Partie starten" })).toBeInViewport({ ratio: 1 });
  await page.route(appStoreUrl, (route) => route.fulfill({ body: "GoStone App Store" }));
  await banner.click();
  await expect(page).toHaveURL(appStoreUrl);
});

test("shows the home page banner on an iPad using a desktop user agent", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" });
    Object.defineProperty(navigator, "maxTouchPoints", { value: 5 });
  });
  await page.goto("/");
  const banner = page.getByRole("link", { name: "Play in the GoStone app App Store" });
  await expect(banner).toBeVisible();

  await page.goto("/play");
  await expect(banner).toHaveCount(0);
});

for (const device of [
  { name: "Mac", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 0 },
  { name: "Android", userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9)", maxTouchPoints: 5 },
]) {
  test(`keeps the home page banner hidden on ${device.name}`, async ({ page }) => {
    await page.addInitScript(({ userAgent, maxTouchPoints }) => {
      Object.defineProperty(navigator, "userAgent", { value: userAgent });
      Object.defineProperty(navigator, "maxTouchPoints", { value: maxTouchPoints });
    }, device);
    // Hero requests activity after hydration, when the banner can detect the device.
    await Promise.all([
      page.waitForRequest((request) => new URL(request.url()).pathname === "/api/games"),
      page.goto("/"),
    ]);
    await expect(page.getByRole("link", { name: "Play in the GoStone app App Store" })).toHaveCount(0);
  });
}
