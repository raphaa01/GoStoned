import bundle from "./imported/gostone-puzzles.json";
import { fromGtpCoordinate, toGtpCoordinate } from "@/lib/analysis/coordinates";
import { applyMove, boardHash, createEmptyBoard } from "@/lib/game/goEngine";
import type { Board, Position, Stone } from "@/lib/game/types";
import { SUPPORTED_LOCALES, type LocalizedText } from "@/lib/i18n/config";
import type { PuzzlePly } from "./types";

type SourceStone = { color: "B" | "W"; point: [number, number] };
type SourcePath = {
  moves: Array<{ color: "B" | "W"; move: string; point: [number, number] | null }>;
  explanation?: string;
  terminalPosition: { stones: SourceStone[]; goalReached: boolean };
};
type SourcePuzzle = {
  id: string;
  playback: {
    kyu: number;
    initialPosition: { stones: SourceStone[]; toPlay: "B" | "W"; goalType: string; target: { color: "B" | "W"; points: [number, number][] }; region: { x: number; y: number; width: number; height: number } };
    solution: SourcePath;
    wrongPaths: SourcePath[];
  };
  nodes: Record<string, { choices: Record<string, { correct: boolean | null; line: string[]; explanation: string }> }>;
};
export type ImportedPath = { line: PuzzlePly[]; solved: boolean; explanation: LocalizedText };
export type ImportedPuzzle = {
  id: string; board: Board; toPlay: Stone; rankKyu: number; order: number;
  viewportSize: number; goal: LocalizedText; paths: ImportedPath[];
  target: Position[]; targetColor: Stone; goalType: string;
};
export const IMPORTED_CATALOG_VERSION = "gostone-import-0.1";
export const PUZZLE_EXPORT_SUMMARY = bundle.exportSummary;
export function puzzleText(en: string, de: string): LocalizedText {
  return Object.fromEntries(SUPPORTED_LOCALES.map((locale) => [locale, locale === "de" ? de : en])) as LocalizedText;
}
const color = (value: "B" | "W"): Stone => value === "B" ? "black" : "white";

export function replayPuzzleLine(base: Board, line: readonly PuzzlePly[]): Board {
  let board = base;
  let previous: string | null = null;
  for (const ply of line) {
    if (ply.move === "pass") { previous = boardHash(board); continue; }
    const applied = applyMove(board, ply.color, ply.x, ply.y);
    if (!applied.ok || boardHash(applied.board) === previous) throw new Error("Imported puzzle has an illegal move or ko recapture.");
    previous = boardHash(board);
    board = applied.board;
  }
  return board;
}

function importPuzzle(source: SourcePuzzle, index: number): ImportedPuzzle {
  const initial = source.playback.initialPosition;
  // Reflect corner positions into the existing top-left viewport. This keeps
  // the true 19x19 edges and every capture intact; it never crops the rule board.
  const point = ([x, y]: [number, number]): Position => ({ x: initial.region.x > 0 ? 18 - x : x, y: initial.region.y > 0 ? 18 - y : y });
  const boardFrom = (stones: SourceStone[]) => {
    const board = createEmptyBoard(19);
    for (const stone of stones) { const { x, y } = point(stone.point); if (board[y][x]) throw new Error("Overlapping imported stones."); board[y][x] = color(stone.color); }
    return board;
  };
  const board = boardFrom(initial.stones);
  const toPlay = color(initial.toPlay);
  const plyFrom = (move: string, player: Stone): PuzzlePly => {
    const position = fromGtpCoordinate(19, move);
    if (position.isPass) return { color: player, move: "pass", x: -1, y: -1 };
    const transformed = point([position.x!, position.y!]);
    return { ...transformed, color: player, move: toGtpCoordinate(19, { ...transformed, isPass: false }) };
  };
  const lineFrom = (moves: string[]) => moves.map((move, i) => plyFrom(move, i % 2 === 0 ? toPlay : toPlay === "black" ? "white" : "black"));
  const paths: ImportedPath[] = [];
  for (const [i, path] of [source.playback.solution, ...source.playback.wrongPaths].entries()) {
    const line = lineFrom(path.moves.map((move) => move.move));
    if (boardHash(replayPuzzleLine(board, line)) !== boardHash(boardFrom(path.terminalPosition.stones))) throw new Error(`Imported terminal position mismatch: ${source.id}`);
    paths.push({ line, solved: i === 0, explanation: puzzleText(i === 0 ? "Goal reached." : "This continuation does not reach the goal.", path.explanation ?? "Ziel erreicht.") });
  }
  for (const [prefix, node] of Object.entries(source.nodes)) {
    for (const choice of Object.values(node.choices)) {
      if (choice.correct === null || !choice.line.length) continue;
      const line = lineFrom([...prefix.split("/").filter(Boolean), ...choice.line]);
      replayPuzzleLine(board, line);
      if (!paths.some((path) => path.line.map((ply) => ply.move).join("/") === line.map((ply) => ply.move).join("/"))) paths.push({ line, solved: choice.correct, explanation: puzzleText(choice.correct ? "Goal reached." : "This continuation does not reach the goal.", choice.explanation) });
    }
  }
  return {
    id: source.id.replace(/^(........)(....)(....)(....)(............)$/, "$1-$2-$3-$4-$5"),
    board, toPlay, rankKyu: source.playback.kyu, order: index + 1,
    viewportSize: Math.max(initial.region.width, initial.region.height),
    goal: initial.goalType === "two-eyes" ? puzzleText("Make two eyes.", "Bilde zwei Augen.") : initial.goalType === "capture-or-ko" ? puzzleText("Capture or force ko.", "Fange die Gruppe oder erzwinge Ko.") : puzzleText("Capture the marked group.", "Fange die markierte Gruppe."),
    paths, target: initial.target.points.map(point), targetColor: color(initial.target.color), goalType: initial.goalType,
  };
}
export const IMPORTED_PUZZLES = (bundle.puzzles as unknown as SourcePuzzle[]).map(importPuzzle);
export function dailyImportedPuzzle(date: string): ImportedPuzzle {
  const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
  return IMPORTED_PUZZLES[((day % IMPORTED_PUZZLES.length) + IMPORTED_PUZZLES.length) % IMPORTED_PUZZLES.length];
}
export function matchingPuzzlePaths(puzzle: ImportedPuzzle, progress: readonly PuzzlePly[]): ImportedPath[] {
  return puzzle.paths.filter((path) => progress.every((ply, i) => path.line[i]?.move === ply.move && path.line[i]?.color === ply.color));
}
