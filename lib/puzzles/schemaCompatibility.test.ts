import assert from "node:assert/strict";
import test from "node:test";
import { supportsGokyoShumyoCatalogSchema } from "./puzzleService";

test("historical puzzle seeding requires the Gokyo Shumyo schema boundary", () => {
  assert.equal(supportsGokyoShumyoCatalogSchema(null), false);
  assert.equal(supportsGokyoShumyoCatalogSchema(
    "CHECK (board_size = 13 AND category IN ('life_and_death', 'tesuji'))",
  ), false);
  assert.equal(supportsGokyoShumyoCatalogSchema(
    "CHECK (board_size = 19 AND category IN ('gokyo_life', 'gokyo_death', 'gokyo_ko'))",
  ), true);
});
