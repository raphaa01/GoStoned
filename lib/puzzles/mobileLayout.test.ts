import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workspace = readFileSync(
  new URL("../../components/puzzles/PuzzleWorkspace.tsx", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("../../components/puzzles/puzzles.module.css", import.meta.url),
  "utf8",
);

test("mobile puzzles stack the task below a viewport-bound board", () => {
  assert.match(
    styles,
    /@media \(max-width: 900px\)[\s\S]*?\.workspace \{ grid-template-columns: minmax\(0, 1fr\); \}/,
  );
  assert.match(
    styles,
    /\.boardColumn :global\(\.go-board\[data-size="13"\]\)[\s\S]*?width: 100%;/,
  );
});

test("all puzzle categories share one catalog without provenance callouts", () => {
  assert.match(workspace, /\{categories\.map\(categoryButton\)\}/);
  assert.doesNotMatch(workspace, /historicalHeader|historicalSource|historicalCollectionDescription/);
});
