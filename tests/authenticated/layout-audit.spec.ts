import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { installHarness, USER } from "../shared/boardDesignHarness";
import { installLearningFixture } from "../shared/betaFixHarness";

// Server-rendered account pages need a real isolated PostgreSQL session;
// browser API fixtures alone cannot authorize their server-side page guard.
for (const theme of ["light", "dark"]) test(`authenticated website layout audit (${theme})`, async ({ context, page }, info) => {
  test.setTimeout(90000);
  const identity = crypto.randomUUID().replaceAll("-", "");
  const registered = await context.request.post("/api/auth/register", { data: {
    username: `audit_${identity.slice(0, 12)}`, email: `${identity}@example.test`, password: crypto.randomUUID(),
    startingStrength: "unspecified", knownRank: null, boardPlacement: "direct",
  } });
  expect(registered.status()).toBe(201);
  await installHarness(page);
  await installLearningFixture(page);
  await page.route("**/api/friends", route => route.fulfill({ json: { ok: true, actor: USER.playerKey,
    dashboard: { friends: [], requests: [], invites: [] } } }));
  await page.addInitScript(value => localStorage.setItem("gostone.theme.v1", value), theme);
  await mkdir(".cache/visual-audit", { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  for (const route of ["profile", "profile/settings", "friends", "learn", "learn/ai", "review"]) {
    await page.goto(`/de/${route}`);
    await expect(page).toHaveURL(new RegExp(`/de/${route}$`));
    await expect(page.locator("main h1").first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), route).toBe(true);
    if (route === "learn") {
      await expect(page.locator(".learn-route-node").first()).toBeVisible();
      expect(await page.locator(".learn-route-node, .learn-route-node__copy").evaluateAll(elements => elements.filter(element => {
        const box = element.getBoundingClientRect();
        return box.left < -1 || box.right > innerWidth + 1;
      }).length)).toBe(0);
    }
    await page.screenshot({ path: `.cache/visual-audit/audit-web-${route.replaceAll("/", "-")}-${theme}-${info.project.name}.png`, fullPage: true, animations: "disabled" });
  }
  expect(errors).toEqual([]);
});
