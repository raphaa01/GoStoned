import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { buildGameAnalysis, buildProgressiveGameAnalysis } from "@/lib/analysis/evaluate";
import { gameAnalysisInput } from "@/lib/analysis/input";
import type { AnalysisJobView, GameAnalysisResult, KataGoTurnResult } from "@/lib/analysis/types";
import type { GameState } from "@/lib/game/types";
import { MOBILE_KATAGO, type MobileKataGoProgress } from "./katagoContract";

export type NativeKataGoStatus = {
  available: boolean;
  reason?: string;
  engineVersion: string;
  modelSha256: string;
};

interface GoStoneKataGoPlugin {
  getStatus(): Promise<NativeKataGoStatus>;
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

const NativeKataGo = registerPlugin<GoStoneKataGoPlugin>("GoStoneKataGo");
const DATABASE_NAME = "gostone-mobile-analysis-v1";
const STORE_NAME = "analyses";
const PREVIEW_PERSIST_INTERVAL = 16;
const QUALITY_PERSIST_INTERVAL = 4;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
    };
    request.onerror = () => reject(request.error ?? new Error("Local analysis storage failed."));
    request.onsuccess = () => resolve(request.result);
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
  return job(game, await storedResult(game).catch(() => null));
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
): Promise<AnalysisJobView> {
  const status = await NativeKataGo.getStatus();
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
  let persistence = Promise.resolve();
  const queuePersistence = (result: GameAnalysisResult) => {
    persistence = persistence
      .then(() => storeResult(game, result))
      .catch(() => undefined);
  };
  const publish = (force: boolean) => {
    if (!latestProgress) return;
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
    const previewThreshold = Math.min(10, input.moves.length);
    if (!force && !revealElapsed && completedMoves < previewThreshold) return;
    if (!force && completedMoves === lastPublishedMoves && refinedMoves - lastPublishedRefined < 2) return;
    lastPublishedMoves = completedMoves;
    lastPublishedRefined = refinedMoves;
    onProgress?.(runningJob(game, analysisId, result, {
      phase: latestProgress.phase,
      completedMoves,
      refinedMoves,
      totalMoves: input.moves.length,
    }));
    const firstPreviewReady = lastPersistedMoves === 0 && completedMoves >= previewThreshold;
    const previewChunkReady = completedMoves - lastPersistedMoves >= PREVIEW_PERSIST_INTERVAL;
    const qualityChunkReady = refinedMoves - lastPersistedRefined >= QUALITY_PERSIST_INTERVAL;
    if (force || firstPreviewReady || previewChunkReady || qualityChunkReady) {
      lastPersistedMoves = completedMoves;
      lastPersistedRefined = refinedMoves;
      queuePersistence(result);
    }
  };
  const listener = await NativeKataGo.addListener("progress", (progress) => {
    if (progress.analysisId !== analysisId) return;
    latestProgress = progress;
    latestVisitsPerTurn = progress.visitsPerTurn;
    if (progress.turn) turns.set(progress.turn.turnNumber, progress.turn);
    publish(false);
  });
  const revealTimer = window.setTimeout(() => {
    revealElapsed = true;
    publish(true);
  }, 10_000);
  let response: Awaited<ReturnType<GoStoneKataGoPlugin["analyze"]>>;
  try {
    response = await NativeKataGo.analyze({
      analysisId,
      input,
      visitsPerTurn: MOBILE_KATAGO.defaultVisitsPerTurn,
    });
  } catch (analysisError) {
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
    await persistence.catch(() => undefined);
    await storeResult(game, partial).catch(() => undefined);
    return job(game, partial)!;
  } finally {
    window.clearTimeout(revealTimer);
    await listener.remove();
  }
  for (const turn of response.turns) turns.set(turn.turnNumber, turn);
  const ordered = [...turns.values()].sort((left, right) => left.turnNumber - right.turnNumber);
  const result = response.complete === false
    ? buildProgressiveGameAnalysis(input, ordered, {
        version: MOBILE_KATAGO.engineVersion,
        model: MOBILE_KATAGO.modelName,
        visitsPerTurn: response.visitsPerTurn,
      }, undefined, { allowRootOnly: true })
    : buildGameAnalysis(input, ordered, {
        version: MOBILE_KATAGO.engineVersion,
        model: MOBILE_KATAGO.modelName,
        visitsPerTurn: response.visitsPerTurn,
      }, undefined, { allowRootOnly: true });
  if (!result) throw new Error("KataGo did not finish enough positions for a review.");
  await persistence.catch(() => undefined);
  await storeResult(game, result).catch(() => undefined);
  return job(game, result)!;
}
