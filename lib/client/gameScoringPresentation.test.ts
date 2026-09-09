import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("the game panel shows each player's captured stones without replaying on clock ticks", () => {
  const panel = source("components/game/GamePanel.tsx");
  assert.match(panel, /useMemo\([\s\S]+replayMovesWithPrisoners\(game\.boardSize, game\.moves\)/);
  assert.match(panel, /copy\.prisoners}: \{prisoners\.capturedBlackByWhite}/);
  assert.match(panel, /copy\.prisoners}: \{prisoners\.capturedWhiteByBlack}/);
});

test("scoring presentation hides implementation labels and false precision", () => {
  const room = source("components/game/GameRoom.tsx");
  const worker = source("workers/browser/gostoneBot.worker.ts");
  assert.doesNotMatch(room, /copy\.localEstimateNote/);
  assert.match(worker, /group\.status !== "dead"[\s\S]+return \{ \.\.\.group, status: "uncertain" as const \}/);
  assert.match(worker, /if \(uncertain\.size === 0\) \{[\s\S]+scoreJapaneseTerritory/);
});
