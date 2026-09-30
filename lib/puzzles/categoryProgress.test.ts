import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { puzzlesForCatalogCategory, resumePuzzleIndex } from "./categoryProgress";

type TestPuzzle = {
  id: string;
  category: "life_and_death" | "gokyo_life" | "gokyo_death";
  collectionOrder: number;
  solved: boolean;
};

const puzzle = (
  id: string,
  category: TestPuzzle["category"],
  collectionOrder: number,
  solved: boolean,
): TestPuzzle => ({ id, category, collectionOrder, solved });

describe("puzzle category progress", () => {
  it("opens the first unsolved puzzle in the displayed category order", () => {
    const puzzles = [
      puzzle("death-2", "gokyo_death", 2, false),
      puzzle("curated-2", "life_and_death", 2, false),
      puzzle("life-1", "gokyo_life", 1, true),
      puzzle("curated-1", "life_and_death", 1, true),
    ];

    assert.deepEqual(puzzlesForCatalogCategory(puzzles, "life_and_death").map(({ id }) => id), [
      "curated-1",
      "curated-2",
      "life-1",
      "death-2",
    ]);
    assert.equal(resumePuzzleIndex(puzzles, "life_and_death"), 1);
  });

  it("opens the last puzzle when the category is complete", () => {
    const puzzles = [
      puzzle("curated-1", "life_and_death", 1, true),
      puzzle("life-1", "gokyo_life", 1, true),
    ];

    assert.equal(resumePuzzleIndex(puzzles, "life_and_death"), 1);
  });

  it("uses index zero for an empty category", () => {
    assert.equal(resumePuzzleIndex([], "life_and_death"), 0);
  });
});
