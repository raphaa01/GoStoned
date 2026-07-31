import type { BoardSize, Stone } from "@/lib/game/types";

export const ANALYSIS_ENGINE_CONTRACT_VERSION = 1 as const;

export type AnalysisMove = {
  color: Stone;
  move: string;
};

export type AnalysisInput = {
  contractVersion: typeof ANALYSIS_ENGINE_CONTRACT_VERSION;
  gameId: string;
  gameVersion: number;
  boardSize: BoardSize;
  komi: number;
  rules: "chinese" | "japanese";
  initialStones?: AnalysisMove[];
  initialPlayer?: Stone;
  moves: AnalysisMove[];
};

export type KataGoMoveInfo = {
  move: string;
  order: number;
  visits: number;
  winrate: number;
  scoreLead: number;
  prior?: number;
  pv: string[];
};

export type KataGoTurnResult = {
  turnNumber: number;
  rootInfo: {
    currentPlayer: "B" | "W";
    visits: number;
    winrate: number;
    scoreLead: number;
  };
  moveInfos: KataGoMoveInfo[];
};

export type MoveClassification =
  | "brilliant"
  | "great"
  | "best"
  | "excellent"
  | "good"
  | "inaccuracy"
  | "mistake"
  | "blunder";

export type AnalysisAlternative = {
  move: string;
  winrate: number;
  scoreLead: number;
  visits: number;
  pv: string[];
};

export type MoveAnalysis = {
  moveNumber: number;
  color: Stone;
  playedMove: string;
  classification: MoveClassification;
  winrateBefore: number;
  winrateAfter: number;
  winrateLoss: number;
  scoreLeadBefore: number;
  scoreLeadAfter: number;
  scoreLoss: number;
  bestMove: string;
  alternatives: AnalysisAlternative[];
  explanation: { en: string; de: string };
};

export type GameAnalysisResult = {
  contractVersion: typeof ANALYSIS_ENGINE_CONTRACT_VERSION;
  engine: {
    name: "KataGo";
    version: string;
    model: string;
    visitsPerTurn: number;
  };
  gameId: string;
  gameVersion: number;
  boardSize: BoardSize;
  analyzedAt: string;
  moves: MoveAnalysis[];
  summary: Record<MoveClassification, number>;
};

export type AnalysisJobStatus = "queued" | "running" | "completed" | "failed";

export type AnalysisJobView = {
  id: string;
  gameId: string;
  gameVersion: number;
  status: AnalysisJobStatus;
  attempts: number;
  result: GameAnalysisResult | null;
  errorCode: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};
