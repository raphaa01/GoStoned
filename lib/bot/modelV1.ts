import type { Board, BoardSize, Position, Stone, StoredMove } from "@/lib/game/types";
import type { JapaneseTerritoryScore } from "@/lib/game/japaneseScoring";

export const GOSTONE_BOT_MODEL = Object.freeze({
  contractVersion: "gostone-browser-bot-v1" as const,
  modelName: "GoStoneJapaneseStudent" as const,
  modelVersion: "v8" as const,
  artifactUrl: "/bot-models/gostone-japanese-v8.onnx" as const,
  artifactBytes: 14_825_412,
  artifactSha256: "47f0f57d51fd7e00becd5d85b1b5bcab62446538e376aa043b5a1a918917fb95" as const,
  runtimeBaseUrl: "/bot-runtime/ort-1.27.0/" as const,
  rules: "japanese" as const,
  komi: 6.5 as const,
  inputName: "features" as const,
  outputs: Object.freeze({
    policy: "policy_logits" as const,
    value: "value" as const,
    score: "score" as const,
    ownership: "ownership" as const,
    survival: "survival_logits" as const,
    scoreStdev: "score_stdev" as const,
    territory: "territory_logits" as const,
    status: "status_logits" as const,
    scoreDistribution: "score_logits" as const,
  }),
  maximumBoardSize: 19 as const,
  inputPlanes: 23 as const,
  passIndex: 361 as const,
  strengthProfiles: Object.freeze([
    Object.freeze({ nominalElo: 600, value: 0 }),
    Object.freeze({ nominalElo: 900, value: 0.2 }),
    Object.freeze({ nominalElo: 1_200, value: 0.4 }),
    Object.freeze({ nominalElo: 1_500, value: 0.6 }),
    Object.freeze({ nominalElo: 1_800, value: 0.8 }),
    Object.freeze({ nominalElo: 2_100, value: 1 }),
  ]),
  settlement: Object.freeze({
    deadThreshold: 0.38,
    aliveThreshold: 0.72,
    modelSurvivalWeight: 0.35,
    ownershipSurvivalWeight: 0.65,
    tacticalLibertyLimit: 2,
    tacticalOwnershipSurvivalThreshold: 0.35,
    tacticalModelSurvivalCeiling: 0.65,
    neutralOwnershipThreshold: 0.35,
    authority: "proposal-only" as const,
    requiresPlayerAgreement: true as const,
    automaticSekiClassificationAllowed: false as const,
  }),
});

const GOSTONE_BOT_MODEL_V4 = Object.freeze({
  contractVersion: "gostone-browser-bot-v1" as const,
  modelVersion: "v4" as const,
  artifactUrl: "/bot-models/gostone-japanese-v4.onnx" as const,
  artifactBytes: 6_776_540,
  artifactSha256: "24252f2845699aeb1b2a42e461bab1197d13f322e68e964ea0ebd9b974ccef61" as const,
  inputName: "features" as const,
  inputPlanes: 12 as const,
  outputs: Object.freeze({
    policy: "policy_logits" as const,
    ownership: "ownership" as const,
    survival: "survival_logits" as const,
    status: null,
  }),
});

export type GoStoneBotRuntimeModel = typeof GOSTONE_BOT_MODEL | typeof GOSTONE_BOT_MODEL_V4;

export function goStoneBotModelForIdentity(
  modelVersion?: string | null,
  modelSha256?: string | null,
): GoStoneBotRuntimeModel {
  if (modelVersion === undefined && modelSha256 === undefined) return GOSTONE_BOT_MODEL;
  for (const model of [GOSTONE_BOT_MODEL, GOSTONE_BOT_MODEL_V4] as const) {
    if (model.modelVersion === modelVersion && model.artifactSha256 === modelSha256) return model;
  }
  throw new RangeError("The browser bot model identity is unsupported.");
}

export type GoStoneBotMove =
  | Readonly<{ kind: "play"; x: number; y: number }>
  | Readonly<{ kind: "pass" }>;

export type GoStoneBotPosition = Readonly<{
  gameId: string;
  boardSize: BoardSize;
  board: Board;
  moves: readonly StoredMove[];
  toMove: Stone;
  komi: number;
  targetRating: number;
  gameVersion: number;
  modelVersion?: string;
  modelSha256?: string;
  excludedMoves?: readonly Position[];
}>;

export type GoStoneSettlementGroup = Readonly<{
  color: Stone;
  stones: readonly Position[];
  status: "alive" | "dead" | "uncertain";
  survival: number;
}>;

export type GoStoneJapaneseSettlementProposal = Readonly<{
  contractVersion: "gostone-japanese-settlement-v1";
  modelVersion: string;
  modelSha256: string;
  authority: "proposal-only";
  boardSize: BoardSize;
  stoppedMoveNumber: number;
  groups: readonly GoStoneSettlementGroup[];
  deadStones: readonly Position[];
  uncertainStones: readonly Position[];
  neutralRegionSeeds: readonly Position[];
  score: JapaneseTerritoryScore | null;
}>;

export type GoStoneBotWorkerRequest =
  | Readonly<{ id: string; kind: "move"; position: GoStoneBotPosition }>
  | Readonly<{
      id: string;
      kind: "settlement";
      position: Omit<GoStoneBotPosition, "toMove" | "excludedMoves">;
    }>;

export type GoStoneBotWorkerResponse =
  | Readonly<{
      id: string;
      ok: true;
      kind: "move";
      move: GoStoneBotMove;
      modelVersion: string;
    }>
  | Readonly<{
      id: string;
      ok: true;
      kind: "settlement";
      proposal: GoStoneJapaneseSettlementProposal;
    }>
  | Readonly<{ id: string; ok: false; error: string }>;

export function botStrengthForRating(rating: number): number {
  const bounded = Math.max(600, Math.min(2_100, Number.isFinite(rating) ? rating : 1_200));
  return (bounded - 600) / 1_500;
}
