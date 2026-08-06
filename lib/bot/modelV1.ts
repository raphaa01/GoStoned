import type { Board, BoardSize, Position, Stone, StoredMove } from "@/lib/game/types";
import type { JapaneseTerritoryScore } from "@/lib/game/japaneseScoring";

export const GOSTONE_BOT_MODEL = Object.freeze({
  contractVersion: "gostone-browser-bot-v1" as const,
  modelName: "GoStoneJapaneseStudent" as const,
  modelVersion: "v1" as const,
  artifactUrl: "/bot-models/gostone-japanese-v1.onnx" as const,
  artifactBytes: 6_776_540,
  artifactSha256: "bacd6e1cdb783278aadce51b1b6db8ab4848512a723d00a5f69de94ecc151a08" as const,
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
  }),
  maximumBoardSize: 19 as const,
  inputPlanes: 12 as const,
  passIndex: 361 as const,
  settlement: Object.freeze({
    deadThreshold: 0.25,
    aliveThreshold: 0.75,
    neutralOwnershipThreshold: 0.35,
    authority: "proposal-only" as const,
  }),
});

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
  modelVersion: typeof GOSTONE_BOT_MODEL.modelVersion;
  modelSha256: typeof GOSTONE_BOT_MODEL.artifactSha256;
  authority: "proposal-only";
  boardSize: BoardSize;
  gameId: string;
  stoppedBoardHash: string;
  stoppedMoveNumber: number;
  scoringRevision: number;
  groups: readonly GoStoneSettlementGroup[];
  deadStones: readonly Position[];
  uncertainStones: readonly Position[];
  neutralRegionSeeds: readonly Position[];
  score: JapaneseTerritoryScore | null;
}>;

export type GoStoneSettlementPosition = Readonly<
  Omit<GoStoneBotPosition, "toMove" | "excludedMoves"> & {
    stoppedBoardHash: string;
    scoringRevision: number;
  }
>;

export type GoStoneBotWorkerRequest =
  | Readonly<{ id: string; kind: "move"; position: GoStoneBotPosition }>
  | Readonly<{
      id: string;
      kind: "settlement";
      position: GoStoneSettlementPosition;
    }>;

export type GoStoneBotWorkerResponse =
  | Readonly<{
      id: string;
      ok: true;
      kind: "move";
      move: GoStoneBotMove;
      modelVersion: typeof GOSTONE_BOT_MODEL.modelVersion;
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
