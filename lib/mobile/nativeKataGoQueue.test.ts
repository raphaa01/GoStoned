import assert from "node:assert/strict";
import test from "node:test";
import { createNativeKataGoQueue } from "./nativeKataGoQueue";

test("review and trainer share one engine and failed work releases the queue", async () => {
  const queue = createNativeKataGoQueue();
  const events: string[] = [];
  let release!: () => void;
  let markStarted!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  const review = queue(async () => {
    events.push("review");
    markStarted();
    await blocked;
    events.push("closed");
    throw new DOMException("Cancelled", "AbortError");
  });
  const cancelled = assert.rejects(review, { name: "AbortError" });
  const trainer = queue(async () => { events.push("trainer"); return 42; });
  await started;
  assert.deepEqual(events, ["review"]);
  release();
  await cancelled;
  assert.equal(await trainer, 42);
  assert.deepEqual(events, ["review", "closed", "trainer"]);
});

test("a cancelled or timed-out queue entry never starts when the active job ends", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const queue = createNativeKataGoQueue();
  let release!: () => void;
  let markStarted!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  const active = queue(() => {
    markStarted();
    return blocked;
  });
  await started;
  const controller = new AbortController();
  const cancelled = assert.rejects(queue(async () => assert.fail("cancelled work ran"), controller.signal), { name: "AbortError" });
  controller.abort();
  await cancelled;
  const expired = assert.rejects(queue(async () => assert.fail("expired work ran")), /still busy/);
  context.mock.timers.tick(45_000);
  await expired;
  release();
  await active;
  assert.equal(await queue(async () => 42), 42);
});
