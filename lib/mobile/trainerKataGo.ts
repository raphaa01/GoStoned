import { Capacitor } from "@capacitor/core";
import type { AnalysisInput } from "@/lib/analysis/types";
import type { TrainerPositionAnalysis } from "@/lib/learn/aiTrainer";
import { MOBILE_KATAGO } from "./katagoContract";
import { NativeKataGo, assertNativeKataGoStatus, type NativeKataGoStatus } from "./nativeKataGo";

export interface TrainerKataGoPlugin {
  getStatus(): Promise<NativeKataGoStatus>;
  analyzePosition(options: { analysisId: string; input: AnalysisInput; visits: number; includeOwnership: boolean; maxTime: number }): Promise<{ turn: TrainerPositionAnalysis }>;
  cancel(options: { analysisId: string }): Promise<void>;
}

function aborted(): Error {
  return new DOMException("Local training analysis was cancelled.", "AbortError");
}

export function validateTrainerAnalysis(turn: TrainerPositionAnalysis, input: AnalysisInput): void {
  const expectedPlayer = input.moves.at(-1)?.color === "black" ? "W" : "B";
  if (!turn || turn.turnNumber !== input.moves.length || turn.rootInfo?.currentPlayer !== expectedPlayer
    || !Number.isFinite(turn.rootInfo.scoreLead) || !Number.isFinite(turn.rootInfo.winrate)
    || turn.rootInfo.winrate < 0 || turn.rootInfo.winrate > 1
    || !Number.isFinite(turn.rootInfo.visits) || turn.rootInfo.visits < 1 || !Array.isArray(turn.moveInfos)
    || turn.moveInfos.some((move) => !Number.isFinite(move.scoreLead) || !Number.isFinite(move.order) || !Number.isFinite(move.visits))) {
    throw new Error("KataGo returned an invalid training position.");
  }
  if (turn.ownership && (turn.ownership.length !== input.boardSize ** 2
    || turn.ownership.some((value) => !Number.isFinite(value) || value < -1 || value > 1))) {
    throw new Error("KataGo returned an invalid ownership estimate.");
  }
}

// Serialize calls, including the completion of cancelled native work. Undo may
// revisit the same move count, so every request has a fresh id and UI revision.
export function createTrainerKataGoClient(plugin: TrainerKataGoPlugin, nativeAvailable = true) {
  let queue: Promise<unknown> = Promise.resolve();
  return {
    async status(): Promise<NativeKataGoStatus> {
      if (!nativeAvailable) return { available: false, engineVersion: MOBILE_KATAGO.engineVersion, modelSha256: MOBILE_KATAGO.modelSha256 };
      const status = await plugin.getStatus();
      if (status.available) assertNativeKataGoStatus(status);
      return status;
    },
    analyze(input: AnalysisInput, options: { visits: number; ownership?: boolean; maxTime?: number; signal: AbortSignal }): Promise<TrainerPositionAnalysis> {
      const execute = async () => {
        if (!nativeAvailable) throw new Error("Local KataGo training requires the native app.");
        if (options.signal.aborted) throw aborted();
        const analysisId = `trainer:${input.gameId}:${input.gameVersion}:${crypto.randomUUID()}`;
        const onAbort = () => { void plugin.cancel({ analysisId }).catch(() => undefined); };
        options.signal.addEventListener("abort", onAbort, { once: true });
        try {
          const response = await plugin.analyzePosition({
            analysisId, input,
            visits: Math.max(2, Math.min(MOBILE_KATAGO.maximumVisitsPerTurn, Math.round(options.visits))),
            includeOwnership: options.ownership ?? false,
            maxTime: Number.isFinite(options.maxTime) ? Math.max(.1, Math.min(8, options.maxTime!)) : 5,
          });
          if (options.signal.aborted) throw aborted();
          validateTrainerAnalysis(response.turn, input);
          return response.turn;
        } finally {
          options.signal.removeEventListener("abort", onAbort);
        }
      };
      const work = queue.then(execute, execute);
      queue = work.catch(() => undefined);
      return work;
    },
  };
}

export const trainerKataGo = createTrainerKataGoClient(NativeKataGo, Capacitor.isNativePlatform());
