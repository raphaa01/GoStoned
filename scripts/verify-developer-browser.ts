import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import "dotenv/config";
import { closePool, getPool, query } from "../lib/db";
import { getDatabaseUrl, isUnambiguousLocalDatabase } from "../lib/env";
import { assertSmokeDatabaseIdentity } from "../lib/smokeDatabase";
import { hashPassword } from "../lib/auth/password";
import { LEARN_LESSONS, line } from "../lib/learn/curriculum";

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3101";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(baseUrl).hostname), "Developer verification is local-only.");
assert.ok(isUnambiguousLocalDatabase(getDatabaseUrl()), "Developer verification requires an isolated local database.");

async function run() {
  await assertSmokeDatabaseIdentity(getPool());
  const id = "2f507157-9a4a-4960-b3c8-87fa721cdd26";
  const username = `dev_test_${randomUUID().slice(0, 8)}`;
  const password = randomUUID(); // An ephemeral local fixture, never the real account password.
  await query("INSERT INTO users (id, username, display_name, password_hash) VALUES ($1, $2, $2, $3)", [id, username, await hashPassword(password)]);
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${baseUrl}/de/login`);
    const login = await page.evaluate(async credentials => {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(credentials) });
      return { status: response.status, body: await response.json() };
    }, { username, password });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.developerAccess, true);
    assert.equal(login.body.user.analysisUnlimited, true);
    assert.equal(login.body.user.coachBetaEnabled, true);
    await page.goto(`${baseUrl}/de/learn`);
    await expect(page.locator(".learn-route-node")).toHaveCount(LEARN_LESSONS.length);
    await expect(page.locator(".learn-route-node:disabled")).toHaveCount(0);
    await expect(page.locator(".learn-path-stage.is-locked")).toHaveCount(0);
    const last = LEARN_LESSONS.at(-1)!;
    await page.locator(".learn-route-node").filter({ hasText: line(last.title, "de") }).click();
    await expect(page.locator(".learn-player__heading h1")).toHaveText(line(last.title, "de"));
    const progress = await page.evaluate(async () => (await fetch("/api/learn/progress")).json());
    assert.deepEqual(progress.progress?.completedLessonIds ?? [], []);
    assert.deepEqual(progress.progress?.completedStages ?? [], []);
    const logout = await page.evaluate(async () => (await fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status);
    assert.equal(logout, 200);
    await page.goto(`${baseUrl}/de/learn`);
    await expect(page).toHaveURL(/\/de\/register\?returnTo=/);
    await expect(page.locator(".learn-route-node")).toHaveCount(0);
    assert.deepEqual(errors, []);
    console.log(`Real developer session grants analysis/coach entitlements and all ${LEARN_LESSONS.length} lessons without forging progress; logout closes the server account gate.`);
  } finally {
    await browser.close();
    await query("DELETE FROM users WHERE id = $1 AND username = $2", [id, username]);
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; }).finally(closePool);
