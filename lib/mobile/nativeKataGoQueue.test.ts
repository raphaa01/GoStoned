import assert from "node:assert/strict";
import test from "node:test";
import { createNativeKataGoQueue } from "./nativeKataGoQueue";

test("review and trainer share one engine and failed work releases the queue", async () => {
  const queue = createNativeKataGoQueue();
  const events: string[] = [];
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const review = queue(async () => {
    events.push("review");
    await blocked;
    events.push("closed");
    throw new DOMException("Cancelled", "AbortError");
  });
  const cancelled = assert.rejects(review, { name: "AbortError" });
  const trainer = queue(async () => { events.push("trainer"); return 42; });
  await Promise.resolve();
  assert.deepEqual(events, ["review"]);
  release();
  await cancelled;
  assert.equal(await trainer, 42);
  assert.deepEqual(events, ["review", "closed", "trainer"]);
});
