import type { PuzzleCategory, PuzzleView } from "@/lib/puzzles/types";

export type PuzzleCatalogCategory =
  | "life_and_death"
  | "tesuji"
  | "capturing_race"
  | "endgame"
  | "ko";

export const PUZZLE_CATALOG_SOURCES = {
  life_and_death: ["life_and_death", "gokyo_life", "gokyo_death"],
  tesuji: ["tesuji"],
  capturing_race: ["capturing_race"],
  endgame: ["endgame"],
  ko: ["gokyo_ko"],
} as const satisfies Record<PuzzleCatalogCategory, readonly PuzzleCategory[]>;

type ProgressPuzzle = Pick<PuzzleView, "category" | "collectionOrder" | "id" | "solved">;

export function puzzlesForCatalogCategory<T extends ProgressPuzzle>(
  puzzles: readonly T[],
  category: PuzzleCatalogCategory,
) {
  const sources: readonly PuzzleCategory[] = PUZZLE_CATALOG_SOURCES[category];
  return puzzles.filter((entry) => (
    entry.category !== null && sources.includes(entry.category)
  )).sort((left, right) => {
    const leftSource = left.category ? sources.indexOf(left.category) : -1;
    const rightSource = right.category ? sources.indexOf(right.category) : -1;
    return leftSource - rightSource
      || (left.collectionOrder ?? 0) - (right.collectionOrder ?? 0)
      || left.id.localeCompare(right.id);
  });
}

export function resumePuzzleIndex<T extends ProgressPuzzle>(
  puzzles: readonly T[],
  category: PuzzleCatalogCategory,
) {
  const categoryPuzzles = puzzlesForCatalogCategory(puzzles, category);
  const firstUnsolved = categoryPuzzles.findIndex((puzzle) => !puzzle.solved);
  return firstUnsolved >= 0 ? firstUnsolved : Math.max(0, categoryPuzzles.length - 1);
}
