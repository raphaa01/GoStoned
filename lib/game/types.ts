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
  winnerKey: string | null;
  status: "active" | "finished";
  result: string | null;
  komi: number;
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

export type Score = {
  black: number;
  white: number;
  winner: Stone | null;
  margin: number;
  result: string;
};
