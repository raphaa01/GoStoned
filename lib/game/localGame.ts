import { applyMove, boardHash, createEmptyBoard } from "./goEngine";
import { replayJapaneseNormalPlayBoardLegality, type JapanesePersistedMove } from "./japaneseKo";
import { createLocalClock, expireLocalClock, pauseLocalClock, resumeLocalClock, switchLocalClock, type LocalClock } from "./localClock";
import type { Board, BoardSize, Position, Stone, TimeControlId } from "./types";

export type LocalGame = {
  boardSize: BoardSize;
  board: Board;
  moves: JapanesePersistedMove[];
  clock: LocalClock;
  phase: "play" | "scoring" | "finished";
  result: string | null;
  error: string | null;
  consecutivePasses: number;
};

export function createLocalGame(boardSize: BoardSize, control: TimeControlId, now: number): LocalGame {
  return { boardSize, board: createEmptyBoard(boardSize), moves: [], clock: createLocalClock(control, now, true),
    phase: "play", result: null, error: null, consecutivePasses: 0 };
}

export function checkLocalGameTime(game: LocalGame, now: number): LocalGame {
  if (game.phase !== "play") return game;
  const clock = expireLocalClock(game.clock, now);
  return clock.winner ? { ...game, clock, phase: "finished", result: clock.winner === "black" ? "B+T" : "W+T", error: null } : game;
}

export function playLocalTurn(game: LocalGame, point: Position | null, now: number): LocalGame {
  const checked = checkLocalGameTime(game, now);
  if (checked.phase !== "play" || !checked.clock.running) return checked;
  if (point && checked.moves.length >= 2998) return { ...checked, error: "move_limit" };
  const color = checked.clock.turn;
  const applied = point ? applyMove(checked.board, color, point.x, point.y) : null;
  if (applied && !applied.ok) return { ...checked, error: applied.error };
  const board = applied?.ok ? applied.board : checked.board;
  const move: JapanesePersistedMove = { moveNumber: checked.moves.length + 1, color,
    x: point?.x ?? null, y: point?.y ?? null, isPass: point === null,
    createdAt: new Date(now).toISOString(), boardHash: boardHash(board) };
  const moves = [...checked.moves, move];
  try { replayJapaneseNormalPlayBoardLegality(checked.boardSize, moves); }
  catch { return { ...checked, error: "ko" }; }
  const consecutivePasses = move.isPass ? checked.consecutivePasses + 1 : 0;
  const scoring = consecutivePasses >= 2;
  const switched = switchLocalClock(checked.clock, now);
  return { ...checked, board, moves, error: null, consecutivePasses, phase: scoring ? "scoring" : "play",
    clock: scoring ? pauseLocalClock(switched, now) : switched };
}

export function resignLocalGame(game: LocalGame, now: number): LocalGame {
  const checked = checkLocalGameTime(game, now);
  if (checked.phase !== "play") return checked;
  return { ...checked, phase: "finished", clock: pauseLocalClock(checked.clock, now), error: null,
    result: checked.clock.turn === "black" ? "W+R" : "B+R" };
}

export function resumeLocalGame(game: LocalGame, now: number): LocalGame {
  if (game.phase !== "scoring") return game;
  // Keep the two passes in the record so the ko and capture audit stays intact.
  return { ...game, phase: "play", consecutivePasses: 0, clock: resumeLocalClock(game.clock, now), error: null };
}

export function localWinner(result: string | null): Stone | null {
  return result?.startsWith("B+") ? "black" : result?.startsWith("W+") ? "white" : null;
}
