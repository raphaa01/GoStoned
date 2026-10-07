import type { PuzzleView } from "./types";

export function orderPuzzleQueue(puzzles: readonly PuzzleView[], rankKyu: number): PuzzleView[] {
  return [...puzzles].sort((a, b) => Math.abs((a.rankKyu ?? 30) - rankKyu) - Math.abs((b.rankKyu ?? 30) - rankKyu) || (a.collectionOrder ?? 0) - (b.collectionOrder ?? 0) || a.id.localeCompare(b.id));
}

export function nextUnsolvedPuzzle(puzzles: readonly PuzzleView[], currentId?: string): PuzzleView | null {
  return puzzles.find((puzzle) => !puzzle.solved && puzzle.id !== currentId) ?? puzzles.find((puzzle) => puzzle.id !== currentId) ?? puzzles[0] ?? null;
}
