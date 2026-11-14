import { expect, test } from "@playwright/test";
import { getFriendsCopy } from "../../lib/i18n/friends";
import type { FriendSummary } from "../../lib/friends/types";
import { assertNoOverflow, installHarness, USER } from "../shared/boardDesignHarness";

const friend: FriendSummary = {
  friendshipId: "caputh-friendship", userId: "caputh", username: "caputh10",
  displayName: "Caputh10", avatarStyle: "kifu-classic", presence: "online",
  unreadCount: 0, lastMessage: null, lastMessageAt: null,
};

for (const theme of ["light", "dark"]) {
  test(`the tournament stone rotates before a tap opens tournaments (${theme})`, async ({ page }, info) => {
    test.skip(info.project.name !== "mobile-390-touch");
    await installHarness(page);
    await page.addInitScript((theme) => localStorage.setItem("gostone.mobile.theme.v1", theme), theme);
    await page.goto("/");
    await expect(page.locator(".mobile-splash")).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator("main a[href*='/puzzles']")).toHaveCount(0);
    const link = page.getByRole("link", { name: "Tournaments", exact: true });
    const canvas = link.locator("canvas");
    const readStone = () => canvas.evaluate((node: HTMLCanvasElement) => node.toDataURL());
    const original = await readStone();
    const rect = (await canvas.boundingBox())!;
    await page.mouse.move(rect.x + rect.width * .28, rect.y + rect.height / 2);
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.width * .85, rect.y + rect.height / 2, { steps: 14 });
    await page.mouse.up();
    await expect.poll(readStone).not.toBe(original);
    await expect(page).toHaveURL("/");
    await link.tap();
    await expect(page).toHaveURL("/tournaments");
  });

  test(`invitation actions are reachable with native chrome suspended (${theme})`, async ({ page }, info) => {
    test.skip(info.project.name !== "mobile-390-touch");
    await page.setViewportSize({ width: 320, height: 568 });
    await installHarness(page);
    const copy = getFriendsCopy("en");
    await page.route("**/api/friends", (route) => route.fulfill({ json: {
      ok: true, actor: USER.playerKey, dashboard: { friends: [friend], requests: [], invites: [] },
    } }));
    const sent: unknown[] = [];
    await page.route(`**/api/friends/${friend.friendshipId}/invites`, (route) => {
      sent.push(route.request().postDataJSON());
      return route.fulfill({ json: { ok: true, actor: USER.playerKey } });
    });
    await page.addInitScript((theme) => {
      localStorage.setItem("gostone.mobile.theme.v1", theme);
      const events: { type: string; open?: boolean }[] = [];
      Object.defineProperty(window, "nativeChromeEvents", { value: events });
      Object.defineProperty(window, "webkit", {
        value: { messageHandlers: { gostoneChrome: { postMessage: (message: typeof events[number]) => events.push(message) } } },
      });
      document.documentElement.style.setProperty("--mobile-safe-top", "26px");
      document.documentElement.style.setProperty("--mobile-safe-bottom", "22px");
    }, theme);
    await page.goto("/friends");
    await expect(page.locator(".mobile-splash")).toHaveAttribute("aria-hidden", "true");
    const trigger = page.getByRole("button", { name: `${copy.invite} ${friend.displayName}` });
    await trigger.tap();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const modalEvents = () => page.evaluate(() => (Reflect.get(window, "nativeChromeEvents") as Array<{ type: string; open?: boolean }>)
      .filter((event) => event.type === "modal").map((event) => event.open));
    await expect.poll(modalEvents).toEqual([true]);
    await expect(dialog.getByText(copy.friendlyGame, { exact: true })).toHaveCount(1);
    await expect(page.locator(".mobile-tab-bar")).toBeHidden();

    await dialog.locator(".invite-choice-grid label").filter({ hasText: "13×13" }).tap();
    await dialog.getByLabel(copy.timeControl).selectOption("blitz");
    const submit = dialog.getByRole("button", { name: copy.sendInvite });
    await expect(submit).toBeInViewport({ ratio: 1 });
    await assertNoOverflow(page);
    await page.screenshot({ path: `.cache/visual-audit/friend-invitation-${theme}-320.png` });
    await submit.tap();
    await expect.poll(() => sent).toEqual([{ boardSize: 13, timeControl: "blitz" }]);
    await expect(dialog).toHaveCount(0);
    await expect.poll(modalEvents).toEqual([true, false]);
    await expect(page.locator(".mobile-tab-bar")).toBeVisible();
    await expect(trigger).toBeFocused();
  });
}
