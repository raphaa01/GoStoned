import assert from "node:assert/strict";
import test from "node:test";
import {
  getPreviewPlayerCount,
  MINIMUM_PREVIEW_PLAYER_COUNT,
} from "./playerCountPreview";

test("the homepage player preview never displays fewer than 67 players", () => {
  assert.equal(getPreviewPlayerCount("under_5"), MINIMUM_PREVIEW_PLAYER_COUNT);
  assert.equal(getPreviewPlayerCount(0), MINIMUM_PREVIEW_PLAYER_COUNT);
  assert.equal(getPreviewPlayerCount(66), MINIMUM_PREVIEW_PLAYER_COUNT);
  assert.equal(getPreviewPlayerCount(67), MINIMUM_PREVIEW_PLAYER_COUNT);
});

test("the homepage player preview keeps reported counts above the minimum", () => {
  assert.equal(getPreviewPlayerCount(68), 68);
  assert.equal(getPreviewPlayerCount(142), 142);
});
