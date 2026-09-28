import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { buildGameAnalysis } from "@/lib/analysis/evaluate";
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
  }): Promise<{ turns: KataGoTurnResult[]; visitsPerTurn: number }>;
  cancel(options: { analysisId: string }): Promise<void>;
  addListener(
    eventName: "progress",
    listener: (progress: MobileKataGoProgress) => void,
  ): Promise<PluginListenerHandle>;
}

const NativeKataGo = registerPlugin<GoStoneKataGoPlugin>("GoStoneKataGo");
const DATABASE_NAME = "gostone-mobile-analysis-v1";
const STORE_NAME = "analyses";

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
  return `${game.id}:${game.version}:${MOBILE_KATAGO.engineVersion}:${MOBILE_KATAGO.modelSha256}`;
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
      const request = database.transaction(STORE_NAME, "readwrite")
        .objectStore(STORE_NAME)
        .put({ key: analysisKey(game), result });
      request.onerror = () => reject(request.error ?? new Error("Local analysis storage failed."));
      request.onsuccess = () => resolve();
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
  return job(game, await storedResult(game));
}

export async function runNativeKataGoAnalysis(game: GameState): Promise<AnalysisJobView> {
  const status = await NativeKataGo.getStatus();
  assertNativeKataGoStatus(status);
  const input = gameAnalysisInput(game);
  const analysisId = crypto.randomUUID();
  const response = await NativeKataGo.analyze({
    analysisId,
    input,
    visitsPerTurn: MOBILE_KATAGO.defaultVisitsPerTurn,
  });
  const result = buildGameAnalysis(input, response.turns, {
    version: MOBILE_KATAGO.engineVersion,
    model: MOBILE_KATAGO.modelName,
    visitsPerTurn: response.visitsPerTurn,
  });
  await storeResult(game, result);
  return job(game, result)!;
}
