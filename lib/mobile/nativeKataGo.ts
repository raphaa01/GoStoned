import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { buildProgressiveGameAnalysis } from "@/lib/analysis/evaluate";
import { gameAnalysisInput } from "@/lib/analysis/input";
import type { AnalysisInput, AnalysisJobView, GameAnalysisResult, KataGoTurnResult } from "@/lib/analysis/types";
import type { TrainerPositionAnalysis } from "@/lib/learn/aiTrainer";
import type { GameState } from "@/lib/game/types";
import { MOBILE_KATAGO, type MobileKataGoProgress } from "./katagoContract";
import { queueNativeKataGo } from "./nativeKataGoQueue";
import { withDeadline } from "./withDeadline";

export type NativeKataGoStatus = {
  available: boolean;
  reason?: string;
  engineVersion: string;
  modelSha256: string;
};

interface GoStoneKataGoPlugin {
  getStatus(): Promise<NativeKataGoStatus>;
  analyzePosition(options: { analysisId: string; input: AnalysisInput; visits: number; includeOwnership: boolean; maxTime: number }): Promise<{ turn: TrainerPositionAnalysis }>;
  analyze(options: {
    analysisId: string;
    input: ReturnType<typeof gameAnalysisInput>;
    visitsPerTurn: number;
  }): Promise<{ turns: KataGoTurnResult[]; visitsPerTurn: number; complete?: boolean }>;
  cancel(options: { analysisId: string }): Promise<void>;
  addListener(
    eventName: "progress",
    listener: (progress: MobileKataGoProgress) => void,
  ): Promise<PluginListenerHandle>;
}

export const NativeKataGo = registerPlugin<GoStoneKataGoPlugin>("GoStoneKataGo");
const DATABASE_NAME = "gostone-mobile-analysis-v1";
const STORE_NAME = "analyses";
const PREVIEW_PERSIST_INTERVAL = 16;
const QUALITY_PERSIST_INTERVAL = 4;
const STATUS_TIMEOUT_MS = 15_000;
const REVIEW_TIMEOUT_MS = 100_000;
const BRIDGE_CLEANUP_TIMEOUT_MS = 5_000;
const CACHE_TIMEOUT_MS = 1_500;

export function readKataGoStatus(getStatus: () => Promise<NativeKataGoStatus>, signal?: AbortSignal) {
  return withDeadline(getStatus(), STATUS_TIMEOUT_MS, "KataGo did not answer its status request.", signal);
}

export function finishKataGoBridgeWork(work: Promise<void>): Promise<void> {
  return withDeadline(work, BRIDGE_CLEANUP_TIMEOUT_MS, "KataGo cleanup timed out.").catch(() => undefined);
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
    };
    request.onerror = () => reject(request.error ?? new Error("Local analysis storage failed."));
    let blocked = false;
    request.onblocked = () => {
      blocked = true;
      reject(new Error("Local analysis storage is busy."));
    };
    request.onsuccess = () => {
      if (blocked) request.result.close();
      else resolve(request.result);
    };
  });
}

function analysisKey(game: GameState) {
  return `${game.id}:${game.version}:${MOBILE_KATAGO.engineVersion}:${MOBILE_KATAGO.modelSha256}:preview-${MOBILE_KATAGO.previewVisits}`;
}

async function storedResult(game: GameState): Promise<GameAnalysisResult | null> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME).objectStore(STORE_NAME).get(analysisKey(game));
      request.onerror = () => reject(request.error ?? new Error("Local analysis storage failed."));
      request.onsuccess = () => resolve(
        (request.result as { result?: GameAnalysisResult } | undefined)?.result ?? null,
      );
    });
  } finally {
    database.close();
  }
}

async function storeResult(game: GameState, result: GameAnalysisResult): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Local analysis storage failed."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Local analysis storage was interrupted."));
      transaction.objectStore(STORE_NAME).put({ key: analysisKey(game), result });
    });
  } finally {
    database.close();
  }
}

function job(game: GameState, result: GameAnalysisResult | null): AnalysisJobView | null {
  if (!result) return null;
  return {
    id: `local:${analysisKey(game)}`,
    gameId: game.id,
    gameVersion: game.version,
    status: "completed",
    attempts: 1,
    result,
    errorCode: null,
    createdAt: result.analyzedAt,
    startedAt: result.analyzedAt,
    completedAt: result.analyzedAt,
  };
}

export function usesNativeKataGoAnalysis(): boolean {
  return Capacitor.isNativePlatform();
}

export function assertNativeKataGoStatus(status: NativeKataGoStatus): void {
  if (!status.available) {
    throw new Error(status.reason || "The local KataGo runtime is unavailable on this device.");
  }
  if (
    status.engineVersion !== MOBILE_KATAGO.engineVersion
    || status.modelSha256.toLowerCase() !== MOBILE_KATAGO.modelSha256
  ) {
    throw new Error("The local KataGo runtime identity does not match the application contract.");
  }
}

export async function readNativeKataGoAnalysis(game: GameState): Promise<AnalysisJobView | null> {
  const saved = await withDeadline(storedResult(game), CACHE_TIMEOUT_MS, "Local review cache read timed out.").catch(() => null);
  return job(game, saved);
}

function runningJob(
  game: GameState,
  analysisId: string,
  result: GameAnalysisResult,
  progress: NonNullable<AnalysisJobView["progress"]>,
): AnalysisJobView {
  return {
    id: `local:running:${analysisId}`,
    gameId: game.id,
    gameVersion: game.version,
    status: "running",
    attempts: 1,
    result,
    errorCode: null,
    createdAt: result.analyzedAt,
    startedAt: result.analyzedAt,
    completedAt: null,
    progress,
  };
}

export async function runNativeKataGoAnalysis(
  game: GameState,
  onProgress?: (value: AnalysisJobView) => void,
  signal?: AbortSignal,
): Promise<AnalysisJobView> {
  return queueNativeKataGo(() => runNativeKataGoAnalysisWork(game, onProgress, signal), signal);
}

async function runNativeKataGoAnalysisWork(
  game: GameState,
  onProgress?: (value: AnalysisJobView) => void,
  signal?: AbortSignal,
): Promise<AnalysisJobView> {
  signal?.throwIfAborted();
  const status = await readKataGoStatus(() => NativeKataGo.getStatus(), signal);
  signal?.throwIfAborted();
  assertNativeKataGoStatus(status);
  const input = gameAnalysisInput(game);
  const analysisId = crypto.randomUUID();
  const turns = new Map<number, KataGoTurnResult>();
  let latestProgress: MobileKataGoProgress | null = null;
  let latestVisitsPerTurn = 1;
  let revealElapsed = false;
  let lastPublishedMoves = 0;
  let lastPublishedRefined = 0;
  let lastPersistedMoves = 0;
  let lastPersistedRefined = 0;
  const persist = (result: GameAnalysisResult) =>
    withDeadline(storeResult(game, result), CACHE_TIMEOUT_MS, "Local review cache write timed out.").catch(() => undefined);
  let persistence: Promise<void> | null = null;
  let latestCacheResult: GameAnalysisResult | undefined;
  const queuePersistence = (result: GameAnalysisResult) => {
    latestCacheResult = result;
    if (persistence) return;
    persistence = (async () => {
      while (latestCacheResult) {
        const next = latestCacheResult;
        latestCacheResult = undefined;
        await persist(next);
      }
      persistence = null;
    })();
  };
  const publish = (force: boolean) => {
    if (!latestProgress || signal?.aborted) return;
    const ordered = [...turns.values()].sort((left, right) => left.turnNumber - right.turnNumber);
    const result = buildProgressiveGameAnalysis(input, ordered, {
      version: MOBILE_KATAGO.engineVersion,
      model: MOBILE_KATAGO.modelName,
      visitsPerTurn: latestProgress.visitsPerTurn,
    }, undefined, { allowRootOnly: true });
    if (!result) return;
    const completedMoves = result.moves.length;
    const refinedMoves = latestProgress.phase === "quality"
      ? Math.min(input.moves.length, Math.max(0, latestProgress.completedTurns))
      : 0;
    const firstMoveReady = latestProgress.phase === "preview" && latestProgress.completedTurns === 2 && completedMoves === 1;
    const initialBatchSize = Math.min(10, input.moves.length);
    if (!force && !revealElapsed && !firstMoveReady && completedMoves < initialBatchSize) return;
    if (!force && completedMoves === lastPublishedMoves && refinedMoves - lastPublishedRefined < 2) return;
    lastPublishedMoves = completedMoves;
    lastPublishedRefined = refinedMoves;
    onProgress?.(runningJob(game, analysisId, result, {
      phase: latestProgress.phase,
      completedMoves,
      refinedMoves,
      totalMoves: input.moves.length,
    }));
    const firstPreviewReady = lastPersistedMoves === 0;
    const initialBatchReady = lastPersistedMoves < initialBatchSize && completedMoves >= initialBatchSize;
    const previewChunkReady = completedMoves - lastPersistedMoves >= PREVIEW_PERSIST_INTERVAL;
    const qualityChunkReady = refinedMoves - lastPersistedRefined >= QUALITY_PERSIST_INTERVAL;
    if (force || firstPreviewReady || initialBatchReady || previewChunkReady || qualityChunkReady) {
      lastPersistedMoves = completedMoves;
      lastPersistedRefined = refinedMoves;
      queuePersistence(result);
    }
  };
  let acceptingProgress = true;
  const subscription = NativeKataGo.addListener("progress", (progress) => {
    if (!acceptingProgress || progress.analysisId !== analysisId) return;
    latestProgress = progress;
    latestVisitsPerTurn = progress.visitsPerTurn;
    if (progress.turn) turns.set(progress.turn.turnNumber, progress.turn);
    publish(false);
  });
  const listener = await withDeadline(subscription, BRIDGE_CLEANUP_TIMEOUT_MS, "KataGo progress subscription timed out.", signal).catch(() => {
    acceptingProgress = false;
    // Reviews can still use the final result if the progress bridge is absent.
    void subscription.then(handle => finishKataGoBridgeWork(handle.remove())).catch(() => undefined);
    signal?.throwIfAborted();
    return null;
  });
  const revealTimer = window.setTimeout(() => {
    revealElapsed = true;
    publish(true);
  }, 10_000);
  let response: Awaited<ReturnType<GoStoneKataGoPlugin["analyze"]>>;
  let cancellation: Promise<void> | undefined;
  const cancel = () => finishKataGoBridgeWork(NativeKataGo.cancel({ analysisId }));
  try {
    signal?.throwIfAborted();
    response = await withDeadline(NativeKataGo.analyze({
      analysisId,
      input,
      visitsPerTurn: MOBILE_KATAGO.defaultVisitsPerTurn,
    }), REVIEW_TIMEOUT_MS, "KataGo did not finish the review in time.", signal);
    if (response.complete === false) {
      cancellation = cancel();
    }
    signal?.throwIfAborted();
  } catch (analysisError) {
    cancellation ??= cancel();
    signal?.throwIfAborted();
    const partial = buildProgressiveGameAnalysis(
      input,
      [...turns.values()].sort((left, right) => left.turnNumber - right.turnNumber),
      {
        version: MOBILE_KATAGO.engineVersion,
        model: MOBILE_KATAGO.modelName,
        visitsPerTurn: latestVisitsPerTurn,
      },
      undefined,
      { allowRootOnly: true },
    );
    if (!partial) throw analysisError;
    acceptingProgress = false;
    queuePersistence(partial);
    return job(game, partial)!;
  } finally {
    acceptingProgress = false;
    window.clearTimeout(revealTimer);
    await Promise.all([
      listener && finishKataGoBridgeWork(listener.remove()),
      cancellation,
    ]);
  }
  for (const turn of response.turns) turns.set(turn.turnNumber, turn);
  const ordered = [...turns.values()].sort((left, right) => left.turnNumber - right.turnNumber);
  const result = buildProgressiveGameAnalysis(input, ordered, {
    version: MOBILE_KATAGO.engineVersion,
    model: MOBILE_KATAGO.modelName,
    visitsPerTurn: response.visitsPerTurn,
  }, undefined, { allowRootOnly: true });
  if (!result) throw new Error("KataGo did not finish enough positions for a review.");
  queuePersistence(result);
  return job(game, result)!;
}
