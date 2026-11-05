import assert from "node:assert/strict";
import test from "node:test";
import { BotWorkerTransport } from "./workerTransport";
import { browserBotRetryDelay } from "./retryPolicy";
import { ApiRequestError } from "@/lib/client/api";
import type {
  GoStoneBotWorkerRequest,
  GoStoneBotWorkerResponse,
} from "./modelV1";

class FakeWorker {
  stopped = false;
  sent: GoStoneBotWorkerRequest[] = [];
  listeners = new Map<
    string,
    Array<(event: { data: GoStoneBotWorkerResponse }) => void>
  >();
  addEventListener(
    type: string,
    fn: (event: { data: GoStoneBotWorkerResponse }) => void,
  ) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  terminate() {
    this.stopped = true;
  }
  postMessage(value: GoStoneBotWorkerRequest) {
    this.sent.push(value);
  }
  emit(type: string, data = {} as GoStoneBotWorkerResponse) {
    for (const fn of this.listeners.get(type) ?? []) fn({ data });
  }
}
const request = (id: string) =>
  ({ id, kind: "capture-go", position: {} }) as GoStoneBotWorkerRequest;

test("a hung worker rejects all pending work and the next move creates a fresh worker", async () => {
  const workers: FakeWorker[] = [];
  const transport = new BotWorkerTransport(() => {
    const w = new FakeWorker();
    workers.push(w);
    return w as unknown as Worker;
  }, 15);
  const outcomes = await Promise.allSettled([
    transport.request(request("first")),
    transport.request(request("second")),
  ]);
  assert(outcomes.every((r) => r.status === "rejected"));
  assert.equal(workers.length, 1);
  assert.equal(workers[0].stopped, true);
  const next = transport.request(request("third"));
  assert.equal(workers.length, 2);
  // A stale response from the terminated worker must not resolve a fresh request.
  workers[0].emit("message", {
    id: "third",
    ok: true,
    kind: "capture-go",
    point: null,
  });
  workers[1].emit("message", {
    id: "third",
    ok: true,
    kind: "capture-go",
    point: null,
  });
  assert.equal((await next).id, "third");
});
test("worker crashes and structured clone failures both allow recovery", async () => {
  for (const event of ["error", "messageerror"]) {
    const workers: FakeWorker[] = [];
    const transport = new BotWorkerTransport(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w as unknown as Worker;
    }, 100);
    const pending = transport.request(request("failed"));
    workers[0].emit(event);
    await assert.rejects(pending);
    assert.equal(workers[0].stopped, true);
    const next = transport.request(request("recovered"));
    workers[1].emit("message", {
      id: "recovered",
      ok: true,
      kind: "capture-go",
      point: null,
    });
    assert.equal((await next).ok, true);
  }
});
test("postMessage failures release all requests instead of leaving the action stuck", async () => {
  const transport = new BotWorkerTransport(() => {
    const w = new FakeWorker();
    w.postMessage = () => {
      throw new Error("clone failed");
    };
    return w as unknown as Worker;
  }, 100);
  await assert.rejects(transport.request(request("clone")), /clone failed/);
});
test("bot retries transport/stale position failures, respects rate limits and stops for identity errors", () => {
  assert.equal(browserBotRetryDelay(new Error("network"), 0), 1000);
  assert.equal(browserBotRetryDelay(new Error("network"), 20), 15000);
  assert.equal(
    browserBotRetryDelay(new ApiRequestError("stale", { status: 409 }), 1),
    2000,
  );
  assert.equal(
    browserBotRetryDelay(
      new ApiRequestError("limit", { status: 429, retryAfterSeconds: 40 }),
      1,
    ),
    40000,
  );
  for (const status of [401, 403, 404])
    assert.equal(
      browserBotRetryDelay(new ApiRequestError("identity", { status }), 1),
      null,
    );
  assert.equal(
    browserBotRetryDelay(
      new ApiRequestError("model", { status: 409, code: "bot_model_mismatch" }),
      1,
    ),
    null,
  );
});
