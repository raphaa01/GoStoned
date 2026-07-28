import assert from "node:assert/strict";
import test from "node:test";
import { createOperationLatch } from "./operationLatch";

test("an operation latch rejects same-tick duplicates", () => {
  const latch = createOperationLatch();
  const first = latch.acquire();
  assert.ok(first);
  assert.equal(latch.acquire(), null);
  assert.equal(latch.release(first), true);
  assert.ok(latch.acquire());
});

test("an older completion cannot release a newer operation", () => {
  const latch = createOperationLatch();
  const oldOperation = latch.acquire();
  assert.ok(oldOperation);
  latch.invalidate();
  const newOperation = latch.acquire();
  assert.ok(newOperation);

  assert.equal(latch.release(oldOperation), false);
  assert.equal(latch.acquire(), null);
  assert.equal(latch.release(newOperation), true);
  assert.ok(latch.acquire());
});
