import assert from "node:assert/strict";
import test from "node:test";
import { trainerAnalysisInput, type TrainerPositionAnalysis } from "@/lib/learn/aiTrainer";
import { createTrainingPosition } from "@/lib/learn/trainingGame";
import { MOBILE_KATAGO } from "./katagoContract";
import { createTrainerKataGoClient, validateTrainerAnalysis, type TrainerKataGoPlugin } from "./trainerKataGo";
import { createNativeKataGoQueue } from "./nativeKataGoQueue";

const input = trainerAnalysisInput(createTrainingPosition(9), "test", 1);
const turn: TrainerPositionAnalysis = {
  turnNumber: 0,
  rootInfo: { currentPlayer: "B", visits: 80, scoreLead: 1, winrate: .5 },
  moveInfos: [{ move: "D4", order: 0, visits: 60, scoreLead: 1, winrate: .5, pv: ["D4"] }],
};
const available = { available: true, engineVersion: MOBILE_KATAGO.engineVersion, modelSha256: MOBILE_KATAGO.modelSha256 };

test("a failed trainer position waits for the engine to close before the next review", async () => {
  const queue = createNativeKataGoQueue();
  let close!: () => void;
  let cancelling!: () => void;
  const closing = new Promise<void>(resolve => { close = resolve; });
  const cancellationStarted = new Promise<void>(resolve => { cancelling = resolve; });
  const client = createTrainerKataGoClient({
    getStatus: async () => available,
    analyzePosition: async () => { throw new Error("Position timed out"); },
    cancel: async () => { cancelling(); await closing; },
  }, true, queue);
  const failed = assert.rejects(client.analyze(input, { visits: 2, signal: new AbortController().signal }), /Position timed out/);
  await cancellationStarted;
  let reviewStarted = false;
  const review = queue(async () => { reviewStarted = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reviewStarted, false);
  close();
  await failed;
  await review;
  assert.equal(reviewStarted, true);
});

test("a review waits for native cancellation acknowledgement even if trainer rejects immediately", async () => {
  const queue = createNativeKataGoQueue();
  let rejectAnalysis!: (error: Error) => void;
  let finishClosing!: () => void;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const closing = new Promise<void>(resolve => { finishClosing = resolve; });
  let reviewStarted = false;
  const client = createTrainerKataGoClient({
    getStatus: async () => available,
    analyzePosition: () => { started(); return new Promise((_resolve, reject) => { rejectAnalysis = reject; }); },
    cancel: async () => { rejectAnalysis(new DOMException("Cancelled", "AbortError")); await closing; },
  }, true, queue);
  const controller = new AbortController();
  const cancelled = assert.rejects(client.analyze(input, { visits: 2, signal: controller.signal }), { name: "AbortError" });
  await ready;
  controller.abort();
  const review = queue(async () => { reviewStarted = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reviewStarted, false);
  finishClosing();
  await cancelled;
  await review;
  assert.equal(reviewStarted, true);
});

test("native position calls use an isolated id, capped budget and explicit ownership request", async () => {
  const calls: Parameters<TrainerKataGoPlugin["analyzePosition"]>[0][] = [];
  const client = createTrainerKataGoClient({
    getStatus: async () => available,
    analyzePosition: async (options) => { calls.push(options); return { turn }; },
    cancel: async () => undefined,
  });
  assert.equal((await client.status()).available, true);
  await client.analyze(input, { visits: 999, ownership: true, signal: new AbortController().signal });
  await client.analyze(input, { visits: 0, signal: new AbortController().signal });
  assert.equal(calls[0].visits, 80);
  assert.equal(calls[0].includeOwnership, true);
  assert.equal(calls[1].visits, 2);
  assert.equal(calls[1].includeOwnership, false);
  assert.notEqual(calls[0].analysisId, calls[1].analysisId);
});

test("cancelled native work cannot return a stale result or overlap a queued request", async () => {
  let complete!: () => void;
  const blocked = new Promise<void>((resolve) => { complete = resolve; });
  let started!: () => void;
  const firstStarted = new Promise<void>((resolve) => { started = resolve; });
  const events: string[] = [];
  const client = createTrainerKataGoClient({
    getStatus: async () => available,
    analyzePosition: async () => {
      events.push("start");
      if (events.length === 1) { started(); await blocked; }
      events.push("finish");
      return { turn };
    },
    cancel: async () => { events.push("cancel"); },
  });
  const controller = new AbortController();
  const first = client.analyze(input, { visits: 80, signal: controller.signal });
  const rejected = assert.rejects(first, { name: "AbortError" });
  await firstStarted;
  const second = client.analyze(input, { visits: 80, signal: new AbortController().signal });
  controller.abort();
  assert.deepEqual(events, ["start", "cancel"]);
  complete();
  await rejected;
  assert.deepEqual(await second, turn);
  assert.deepEqual(events, ["start", "cancel", "finish", "start", "finish"]);
});

test("missing native engines fail closed, without invoking another opponent", async () => {
  const plugin: TrainerKataGoPlugin = {
    getStatus: async () => { throw new Error("must not run"); },
    analyzePosition: async () => { throw new Error("must not run"); },
    cancel: async () => undefined,
  };
  const client = createTrainerKataGoClient(plugin, false);
  assert.equal((await client.status()).available, false);
  await assert.rejects(client.analyze(input, { visits: 80, signal: new AbortController().signal }), /native app/);
  const wrongModel = createTrainerKataGoClient({ ...plugin, getStatus: async () => ({ ...available, modelSha256: "bad" }) });
  await assert.rejects(wrongModel.status(), /identity/);
});

test("position estimates reject wrong turns, swapped perspective and malformed ownership", () => {
  assert.doesNotThrow(() => validateTrainerAnalysis(turn, input));
  assert.throws(() => validateTrainerAnalysis({ ...turn, turnNumber: 1 }, input), /invalid/);
  assert.throws(() => validateTrainerAnalysis({ ...turn, rootInfo: { ...turn.rootInfo, currentPlayer: "W" } }, input), /invalid/);
  assert.throws(() => validateTrainerAnalysis({ ...turn, ownership: [1] }, input), /ownership/);
  assert.throws(() => validateTrainerAnalysis({ ...turn, ownership: Array(81).fill(Number.NaN) }, input), /ownership/);
});
