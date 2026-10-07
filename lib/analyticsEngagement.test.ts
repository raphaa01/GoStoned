import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { analyticsPath } from "./analytics/paths";
import { parseEngagementSample } from "./analytics/engagement";
import { parseTrafficPeriod, trafficWindow } from "./analytics/trafficOptions";
import { POST } from "../app/api/analytics/engagement/route";
import type { Pool } from "pg";
import { getEngagementReport } from "./analytics/engagement";

test("analytics allowlists public routes and removes game, review and share identifiers", () => {
  assert.equal(analyticsPath("/de/game/secret-id"), "/de/game/[id]");
  assert.equal(analyticsPath("/shared-game/secret-token"), "/shared-game/[id]");
  assert.equal(analyticsPath("/ja/review/secret-id"), "/ja/review/[id]");
  assert.equal(analyticsPath("/de/"), "/de");
  for (const path of ["/webanalytics", "/webanalytics/nested", "/api/auth/oauth/google", "/arbitrary/email@example.com", "/play?token=secret"]) {
    assert.equal(analyticsPath(path), null, path);
  }
});

test("engagement refuses arbitrary data, identities, invalid durations and admin paths", () => {
  const valid = { path: "/de/game/private-id", milliseconds: 30_000, started: false };
  assert.deepEqual(parseEngagementSample(valid), { path: "/de/game/[id]", milliseconds: 30_000, started: false });
  for (const body of [
    { ...valid, milliseconds: -1 }, { ...valid, milliseconds: 60_001 },
    { ...valid, milliseconds: NaN }, { ...valid, milliseconds: 1.5 },
    { ...valid, started: "true" }, { ...valid, account: "secret" },
    { ...valid, path: "/webanalytics" },
  ]) assert.equal(parseEngagementSample(body), null);
});

test("traffic periods are bounded and start on UTC days without querying future days", () => {
  const now = new Date("2026-10-07T12:34:00Z");
  assert.deepEqual(trafficWindow(now, 7), { since: "2026-10-01T00:00:00.000Z", until: now.toISOString() });
  assert.equal(parseTrafficPeriod("1"), 1);
  assert.equal(parseTrafficPeriod("7"), 7);
  assert.equal(parseTrafficPeriod(["7"]), 30);
  assert.equal(parseTrafficPeriod("365"), 30);
});

test("engagement endpoint rejects foreign origins and bounded invalid payloads before writing", async () => {
  function request(body: string, origin = "https://gostone.test") {
    return new NextRequest("https://gostone.test/api/analytics/engagement", {
      method: "POST", headers: { origin, "content-type": "application/json" }, body,
    });
  }
  assert.equal((await POST(request("{}", "https://foreign.test"))).status, 403);
  assert.equal((await POST(request("{}"))).status, 400);
  assert.equal((await POST(request("x".repeat(513)))).status, 400);
  assert.equal((await POST(request(JSON.stringify({ path: "/webanalytics", milliseconds: 2, started: true })))).status, 400);
});

test("same-origin engagement writes only anonymous counters and reports their sums", async () => {
  const previousPool = globalThis.goStonedDbPool;
  const previousEnvironment = process.env.VERCEL_ENV;
  const writes: unknown[][] = [];
  globalThis.goStonedDbPool = {
    query: async (sql: string, values: unknown[]) => {
      if (sql.startsWith("INSERT")) {
        writes.push(values);
        return { rows: [] };
      }
      return { rows: [{ path: "/play", views: "2", milliseconds: "60000" }, { path: "/privacy", views: "1", milliseconds: "10000" }] };
    },
  } as unknown as Pool;
  try {
    process.env.VERCEL_ENV = "production";
    const response = await POST(new NextRequest("https://gostone.test/api/analytics/engagement", {
      method: "POST", headers: { origin: "https://gostone.test", "content-type": "application/json" },
      body: JSON.stringify({ path: "/de/game/private", started: true, milliseconds: 1000 }),
    }));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.deepEqual(writes, [["/de/game/[id]", 1, 1000]]);
    const report = await getEngagementReport(new Date("2026-10-07T12:00:00Z"), 7);
    assert.equal(report.views, 3);
    assert.equal(report.milliseconds, 70000);
    process.env.VERCEL_ENV = "preview";
    const preview = await POST(new NextRequest("https://preview.test/api/analytics/engagement", {
      method: "POST", headers: { origin: "https://preview.test", "content-type": "application/json" },
      body: JSON.stringify({ path: "/play", started: true, milliseconds: 0 }),
    }));
    assert.equal(preview.status, 200);
    assert.equal(writes.length, 1);
  } finally {
    globalThis.goStonedDbPool = previousPool;
    if (previousEnvironment === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previousEnvironment;
  }
});
