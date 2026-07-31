export const KATAGO_SCORING_CONTRACT_VERSION = "gostone-katago-scoring-v1" as const;
export const KATAGO_CONFIDENCE_POLICY_VERSION = "gostone-dead-groups-v1" as const;
export const KATAGO_DEAD_CONFIDENCE_THRESHOLD = 0.85;
export const KATAGO_OPPONENT_OWNERSHIP_THRESHOLD = 0.8;

export type KataGoBoardSize = 9 | 13 | 19;
export type KataGoColor = "black" | "white";
export type KataGoIntersection = KataGoColor | null;
export type KataGoPosition = Readonly<{ x: number; y: number }>;
export type KataGoBoard = readonly (readonly KataGoIntersection[])[];

export type KataGoCanonicalMove = Readonly<{
  moveNumber: number;
  color: KataGoColor;
  x: number | null;
  y: number | null;
  isPass: boolean;
  boardHash: string;
}>;

export type KataGoRulesIdentity = Readonly<{
  ruleset: string;
  rulesProfile: string;
  rulesVersion: string;
  scoringMethod: string;
  komi: number;
  handicap: number;
}>;

export type KataGoEngineIdentity = Readonly<{
  engineVersion: string;
  modelVersion: string;
  configVersion: string;
}>;

export type KataGoScoringRequest = Readonly<{
  contractVersion: typeof KATAGO_SCORING_CONTRACT_VERSION;
  analysisPurpose: "initial-suggestion" | "deadline-adjudication";
  gameId: string;
  stoppedBoardHash: string;
  stoppedMoveNumber: number;
  scoringRevision: number;
  boardSize: KataGoBoardSize;
  board: KataGoBoard;
  moves: readonly KataGoCanonicalMove[];
  rules: KataGoRulesIdentity;
  playerToMove: KataGoColor;
  engine: KataGoEngineIdentity;
  maxVisits: number;
  confidencePolicyVersion: typeof KATAGO_CONFIDENCE_POLICY_VERSION;
}>;

export type CanonicalKataGoScoringRequest = KataGoScoringRequest & Readonly<{
  requestIdentity: string;
}>;

export type KataGoStoneStatus = "dead" | "alive" | "seki" | "unknown";

export type KataGoStoneAssessment = Readonly<{
  x: number;
  y: number;
  status: KataGoStoneStatus;
  confidence: number;
}>;

/**
 * Provider response wire contract. `ownership` is signed from Black's point of
 * view (-1 White, +1 Black). Every occupied intersection must have exactly one
 * stone assessment. Providers may not return a pre-trimmed dead-stone list.
 */
export type KataGoScoringResponse = Readonly<{
  contractVersion: typeof KATAGO_SCORING_CONTRACT_VERSION;
  analysisPurpose: KataGoScoringRequest["analysisPurpose"];
  requestIdentity: string;
  gameId: string;
  stoppedBoardHash: string;
  stoppedMoveNumber: number;
  scoringRevision: number;
  boardSize: KataGoBoardSize;
  rules: KataGoRulesIdentity;
  playerToMove: KataGoColor;
  engine: KataGoEngineIdentity & Readonly<{ name: "KataGo"; visits: number }>;
  ownership: readonly (readonly number[])[];
  stones: readonly KataGoStoneAssessment[];
}>;

export type KataGoGroupDecisionReason =
  | "suggested-dead"
  | "seki"
  | "status-not-dead"
  | "inconsistent-status"
  | "low-confidence"
  | "ownership-not-opponent";

export type KataGoGroupProposal = Readonly<{
  color: KataGoColor;
  stones: readonly KataGoPosition[];
  suggestedDead: boolean;
  confidence: number;
  opponentOwnership: number;
  reason: KataGoGroupDecisionReason;
}>;

export type KataGoScoringProposal = Readonly<{
  contractVersion: typeof KATAGO_SCORING_CONTRACT_VERSION;
  confidencePolicyVersion: typeof KATAGO_CONFIDENCE_POLICY_VERSION;
  requestIdentity: string;
  providerKind: KataGoProviderKind;
  analysisPurpose: KataGoScoringRequest["analysisPurpose"];
  gameId: string;
  stoppedBoardHash: string;
  stoppedMoveNumber: number;
  scoringRevision: number;
  engine: KataGoScoringResponse["engine"];
  deadStones: readonly KataGoPosition[];
  neutralRegionSeeds: readonly KataGoPosition[];
  groups: readonly KataGoGroupProposal[];
}>;

export type KataGoProviderKind = "hosted-http" | "local-http" | "deterministic";

export interface KataGoScoringProvider {
  readonly kind: KataGoProviderKind;
  analyze(
    request: CanonicalKataGoScoringRequest,
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<unknown>;
}
