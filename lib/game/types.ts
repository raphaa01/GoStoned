import type { Ruleset, RulesProfile, ScoringMethod } from "./rulesPolicy";

export type BoardSize = 9 | 13 | 19;
export type TimeControlId = "blitz" | "rapid" | "classic";
export type Stone = "black" | "white";
export type Intersection = Stone | null;
export type Board = Intersection[][];

export type Position = {
  x: number;
  y: number;
};

export type MoveError = "out_of_bounds" | "occupied" | "suicide";

export type MoveResult =
  | {
      ok: true;
      board: Board;
      captured: Position[];
    }
  | {
      ok: false;
      board: Board;
      error: MoveError;
    };

export type StoredMove = {
  moveNumber: number;
  color: Stone;
  x: number | null;
  y: number | null;
  isPass: boolean;
  createdAt: string;
};

export type GameState = {
  id: string;
  boardSize: BoardSize;
  blackPlayerKey: string;
  whitePlayerKey: string;
  blackPlayerName: string;
  whitePlayerName: string;
  blackPlayerIsBot?: boolean;
  whitePlayerIsBot?: boolean;
  winnerKey: string | null;
  rated: boolean;
  status: "active" | "finished";
  phase: "play" | "scoring";
  result: string | null;
  finishReason:
    | "score"
    | "japanese_adjudication"
    | "japanese_abandonment"
    | "japanese_no_result"
    | "japanese_repetition"
    | "resignation"
    | "timeout"
    | "legacy_score"
    | null;
  komi: number;
  ruleset: Ruleset;
  rulesProfile: RulesProfile;
  scoringMethod: ScoringMethod;
  handicap: number;
  consecutivePasses: number;
  scoringRevision: number;
  scoring: GameScoringState | null;
  lastResume: {
    claim: "dead" | "alive" | "deadline" | "resume";
    requestedBy: Stone | null;
    disputedStone: Position | null;
  } | null;
  repetition?: {
    eligible: boolean;
    repeatedFromMoveNumber: number | null;
    blackClaimed: boolean;
    whiteClaimed: boolean;
  } | null;
  version: number;
  startedAt: string;
  finishedAt: string | null;
  timeControl: TimeControlId;
  clock: GameClockState;
  turn: Stone | null;
  moveCount: number;
  board: Board;
  moves: StoredMove[];
};

export type GameScoringState = {
  revision: number;
  boardHash: string;
  stoppedMoveNumber: number;
  deadStones: Position[];
  blackConfirmed: boolean;
  whiteConfirmed: boolean;
  preview: ScorePreview;
  finalizedAt: string | null;
  expiresAt: string;
  proposalHash?: string;
  neutralRegionSeeds?: Position[];
  resumptionsUsed?: number;
  resumptionsRemaining?: number;
  finalResolution?: boolean;
  blackParticipated?: boolean;
  whiteParticipated?: boolean;
  canUndo?: boolean;
  canResetToSuggestion?: boolean;
  suggestion?: {
    status: "pending" | "ready" | "unavailable" | "invalid" | "low_confidence";
    transparentRole: "suggestion";
    providerKind: "hosted-http" | "local-http" | "deterministic" | null;
    engineVersion: string | null;
    modelVersion: string | null;
    configVersion: string | null;
    confidencePolicyVersion: string | null;
  };
};

export type PlayerClockState = {
  mainTimeMs: number;
  periodsRemaining: number;
  displayTimeMs: number;
  phase: "main" | "byo-yomi";
};

export type GameClockState = {
  serverNow: string;
  clientReceivedAt?: number;
  mainTimeSeconds: number;
  byoYomiPeriods: number;
  byoYomiSeconds: number;
  black: PlayerClockState;
  white: PlayerClockState;
};

export type GamePollHeartbeat = {
  unchanged: true;
  gameId: string;
  version: number;
  clock: GameClockState;
};

export type GamePollResponse =
  | GamePollHeartbeat
  | {
      unchanged?: false;
      game: GameState;
    };

export type ChineseAreaScore = {
  black: number;
  white: number;
  blackStones: number;
  whiteStones: number;
  blackTerritory: number;
  whiteTerritory: number;
  neutralPoints: number;
  winner: Stone | null;
  margin: number;
  result: string;
};

export type JapaneseTerritoryPreview = {
  black: number;
  white: number;
  blackStones: number;
  whiteStones: number;
  blackTerritory: number;
  whiteTerritory: number;
  neutralPoints: number;
  territoryExcludedByAgreement: number;
  blackPrisoners: number;
  whitePrisoners: number;
  winner: Stone | null;
  margin: number;
  result: string;
};

export type ScorePreview = ChineseAreaScore | JapaneseTerritoryPreview;

/** @deprecated Use the scoring-rule-specific ChineseAreaScore name. */
export type Score = ChineseAreaScore;
