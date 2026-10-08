import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { cachedRouteData, invalidateRouteData, puzzleRouteKey, readRouteData, routeCacheKey, routeSnapshot } from "./routeCache";

beforeEach(() => invalidateRouteData());

test("stale snapshots remain paintable during revalidation but mutations remove them", async () => {
  const key = puzzleRouteKey("daily", "alice");
  await readRouteData(key, async () => "last correct position", -1);
  assert.equal(cachedRouteData(key), undefined);
  let reject!: (reason: Error) => void;
  const pending = readRouteData(key, () => new Promise<string>((_resolve, fail) => { reject = fail; }));
  const failed = assert.rejects(pending, /offline/);
  await Promise.resolve();
  assert.equal(routeSnapshot(key), "last correct position");
  reject(new Error("offline"));
  await failed;
  assert.equal(routeSnapshot(key), "last correct position");
  assert.equal(await readRouteData(key, async () => "fresh"), "fresh");
  invalidateRouteData(key);
  assert.equal(routeSnapshot(key), undefined);
});

test("navigation and concurrent mounts share one request within its lifetime", async () => {
  let calls = 0;
  const load = async () => { calls++; return { rating: 900 }; };
  const key = routeCacheKey("profile", "alice");
  const [first, second] = await Promise.all([readRouteData(key, load), readRouteData(key, load)]);
  assert.equal(first, second);
  assert.equal(await readRouteData(key, load), first);
  assert.equal(calls, 1);
  assert.equal(cachedRouteData(key, Date.now() + 61_000), undefined);
});

test("expired snapshots refetch and account owners cannot share private data", async () => {
  const alice = routeCacheKey("profile", "alice");
  await readRouteData(alice, async () => "old", -1);
  assert.equal(await readRouteData(alice, async () => "updated"), "updated");
  assert.equal(cachedRouteData(routeCacheKey("profile", "bob")), undefined);
});

test("mutation and logout invalidation discard late reads without repopulating the cache", async () => {
  let finish!: (value: string) => void;
  const key = routeCacheKey("puzzle", "alice");
  const pending = readRouteData(key, () => new Promise<string>((resolve) => { finish = resolve; }));
  await Promise.resolve();
  invalidateRouteData(key);
  await readRouteData(key, async () => "new revision");
  finish("old revision");
  await pending;
  assert.equal(cachedRouteData(key), "new revision");
  invalidateRouteData();
  assert.equal(cachedRouteData(key), undefined);
});

test("failures are retryable and daily puzzle snapshots expire at the UTC date boundary", async () => {
  await assert.rejects(readRouteData("failed", async () => { throw new Error("offline"); }));
  assert.equal(await readRouteData("failed", async () => "online"), "online");
  assert.notEqual(puzzleRouteKey("daily", "alice", new Date("2026-10-07T23:59:59Z")), puzzleRouteKey("daily", "alice", new Date("2026-10-08T00:00:00Z")));
  assert.notEqual(puzzleRouteKey("daily", "alice"), puzzleRouteKey("practice", "alice"));
});
