import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { registerPlugin } from "@capacitor/core";
import type { AnalysisJobView, KataGoTurnResult } from "@/lib/analysis/types";
import type { GameState } from "@/lib/game/types";
import { MOBILE_KATAGO, type MobileKataGoProgress } from "./katagoContract";

let progressListener: ((progress: MobileKataGoProgress) => void) | undefined;
let analyze: (options: { analysisId: string }) => Promise<{
  turns: KataGoTurnResult[];
  visitsPerTurn: number;
  complete: boolean;
}>;
let removals = 0;

// Exercise the actual shared iOS/Android client through Capacitor's public JS
// implementation boundary, including native events, fallback and persistence.
registerPlugin("GoStoneKataGo", {
  web: {
    getStatus: async () => ({
      available: true,
      engineVersion: MOBILE_KATAGO.engineVersion,
      modelSha256: MOBILE_KATAGO.modelSha256,
    }),
    analyze: (options: { analysisId: string }) => analyze(options),
    addListener: async (_name: string, listener: typeof progressListener) => {
      progressListener = listener;
      return { remove: async () => { removals += 1; progressListener = undefined; } };
    },
  },
});
const nativeClient = import("./nativeKataGo");

const game = {
  id: "native-preview",
  version: 31,
  boardSize: 9,
  komi: 6.5,
  ruleset: "japanese",
  moves: Array.from({ length: 30 }, (_, i) => ({
    color: i % 2 === 0 ? "black" : "white",
    x: i % 9,
    y: Math.floor(i / 9),
    isPass: false,
  })),
} as unknown as GameState;

function turn(turnNumber: number): KataGoTurnResult {
  return {
    turnNumber,
    rootInfo: { currentPlayer: turnNumber % 2 ? "W" : "B", visits: 1, winrate: 0.5, scoreLead: 0 },
    moveInfos: [],
  };
}

function emit(analysisId: string, value: KataGoTurnResult, completedTurns: number) {
  progressListener?.({
    analysisId,
    phase: "preview",
    completedTurns,
    totalTurns: 31,
    visitsPerTurn: value.rootInfo.visits,
    thermalState: "nominal",
    turn: value,
  });
}

function installBrowser(context: TestContext) {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      setTimeout: (callback: () => void, delay: number) => globalThis.setTimeout(callback, delay),
      clearTimeout: (timer: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(timer),
    },
  });
  // A device with a full/unavailable cache must still display computed results.
  let saves = 0;
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: { open: () => { saves += 1; throw new Error("Local cache unavailable"); } },
  });
  context.after(() => {
    Reflect.deleteProperty(globalThis, "window");
    Reflect.deleteProperty(globalThis, "indexedDB");
  });
  return () => saves;
}

test("native root-only stream opens ten moves, keeps later chunks and survives optional cache failure", async (context) => {
  const { runNativeKataGoAnalysis } = await nativeClient;
  const saveCount = installBrowser(context);
  const updates: AnalysisJobView[] = [];
  let finish!: (response: { turns: KataGoTurnResult[]; visitsPerTurn: number; complete: boolean }) => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  analyze = async ({ analysisId }) => {
    for (let i = 0; i <= 10; i++) emit(analysisId, turn(i), i + 1);
    started();
    return new Promise((resolve) => { finish = resolve; });
  };
  const pending = runNativeKataGoAnalysis(game, (update) => updates.push(update));
  await ready;
  assert.equal(updates.length, 1);
  assert.equal(updates[0].status, "running");
  assert.equal(updates[0].result?.moves.length, 10);
  assert.equal(updates[0].result?.moves[0].bestMove, null);
  const analysisId = updates[0].id.replace("local:running:", "");
  for (let i = 11; i <= 30; i++) emit(analysisId, turn(i), i + 1);
  finish({ turns: Array.from({ length: 31 }, (_, i) => turn(i)), visitsPerTurn: 1, complete: true });
  const final = await pending;
  assert.equal(final.status, "completed");
  assert.equal(final.result?.moves.length, 30);
  assert.equal(updates.at(-1)?.result?.moves.length, 30);
  assert.ok(saveCount() >= 3, "First preview, next chunk and final result should attempt persistence");
  assert.equal(progressListener, undefined);
});

test("native preview becomes usable at ten seconds even when fewer than ten moves are ready", async (context) => {
  const { runNativeKataGoAnalysis } = await nativeClient;
  installBrowser(context);
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const updates: AnalysisJobView[] = [];
  let rejectAnalysis!: (error: Error) => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  analyze = async ({ analysisId }) => {
    emit(analysisId, turn(1), 1);
    emit(analysisId, turn(0), 2);
    emit(analysisId, turn(2), 3);
    started();
    return new Promise((_resolve, reject) => { rejectAnalysis = reject; });
  };
  const pending = runNativeKataGoAnalysis(game, (update) => updates.push(update));
  await ready;
  assert.equal(updates.length, 0);
  context.mock.timers.tick(10_000);
  assert.equal(updates[0].result?.moves.length, 2);
  rejectAnalysis(new Error("Local engine reached its safety limit"));
  const partial = await pending;
  assert.equal(partial.result?.moves.length, 2);
  assert.equal(partial.status, "completed");
  assert.equal(progressListener, undefined);
  assert.equal(removals, 2);
});

test("results arriving after a slow cold start do not wait for the ten-move threshold", async (context) => {
  const { runNativeKataGoAnalysis, readNativeKataGoAnalysis } = await nativeClient;
  installBrowser(context);
  assert.equal(await readNativeKataGoAnalysis(game), null, "Optional cache failure must allow a fresh analysis");
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const updates: AnalysisJobView[] = [];
  let analysisId!: string;
  let started!: () => void;
  let finish!: (response: { turns: KataGoTurnResult[]; visitsPerTurn: number; complete: boolean }) => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  analyze = async (options) => {
    analysisId = options.analysisId;
    started();
    return new Promise((resolve) => { finish = resolve; });
  };
  const pending = runNativeKataGoAnalysis(game, (update) => updates.push(update));
  await ready;
  context.mock.timers.tick(10_000);
  assert.equal(updates.length, 0);
  emit(analysisId, turn(0), 1);
  emit(analysisId, turn(1), 2);
  assert.equal(updates[0].result?.moves.length, 1);
  finish({ turns: [turn(0), turn(1)], visitsPerTurn: 1, complete: false });
  assert.equal((await pending).result?.moves.length, 1);
});

test("two-visit native preview already includes the best move and a provisional classification", async (context) => {
  const { runNativeKataGoAnalysis } = await nativeClient;
  installBrowser(context);
  const updates: AnalysisJobView[] = [];
  const candidateTurn = (index: number): KataGoTurnResult => ({
    ...turn(index),
    rootInfo: { ...turn(index).rootInfo, visits: 2 },
    moveInfos: [{ move: "C3", order: 0, visits: 1, winrate: 0.5, scoreLead: 0, pv: ["C3"] }],
  });
  analyze = async ({ analysisId }) => {
    for (let i = 0; i <= 10; i++) emit(analysisId, candidateTurn(i), i + 1);
    assert.equal(updates[0].result?.moves[0].bestMove, "C3");
    assert.equal(updates[0].result?.moves[0].classification, "great");
    assert.equal(updates[0].result?.moves[0].provisional, true);
    return { turns: Array.from({ length: 31 }, (_, i) => candidateTurn(i)), visitsPerTurn: 2, complete: true };
  };
  assert.equal((await runNativeKataGoAnalysis(game, (update) => updates.push(update))).result?.moves.length, 30);
});
