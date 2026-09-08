import assert from "node:assert/strict";
import { toGtpCoordinate } from "../lib/analysis/coordinates";
import { ANALYSIS_ENGINE_CONTRACT_VERSION, type AnalysisMove } from "../lib/analysis/types";
import {
  DAILY_PUZZLE_CYCLE_LENGTH,
  dailyPuzzleAt,
} from "../lib/puzzles/dailyCatalog";
import { KataGoEngine } from "../workers/katago/engine";

const binary = process.env.KATAGO_BINARY;
const model = process.env.KATAGO_MODEL;
const config = process.env.KATAGO_CONFIG;
if (!binary || !model || !config) {
  throw new Error("KATAGO_BINARY, KATAGO_MODEL, and KATAGO_CONFIG are required.");
}

const visits = Math.max(8, Number(process.env.KATAGO_PUZZLE_MAX_VISITS) || 80);
const engine = new KataGoEngine({ binary, model, config });

async function run() {
  const start = Math.max(1, Number(process.env.DAILY_PUZZLE_VALIDATION_START) || 1);
  const end = Math.min(
    DAILY_PUZZLE_CYCLE_LENGTH,
    Number(process.env.DAILY_PUZZLE_VALIDATION_END) || DAILY_PUZZLE_CYCLE_LENGTH,
  );
  for (let order = start; order <= end; order += 1) {
    const puzzle = dailyPuzzleAt(order);
    const initialStones: AnalysisMove[] = [];
    for (let y = 0; y < puzzle.board.length; y += 1) {
      for (let x = 0; x < puzzle.board.length; x += 1) {
        const color = puzzle.board[y]?.[x];
        if (!color) continue;
        initialStones.push({ color, move: toGtpCoordinate(13, { x, y, isPass: false }) });
      }
    }
    const localMoves = puzzle.localRegion
      .filter((point) => puzzle.board[point.y]?.[point.x] === null)
      .map((point) => toGtpCoordinate(13, { ...point, isPass: false }));
    const expected = new Set(puzzle.candidateMoves.map(
      (point) => toGtpCoordinate(13, { ...point, isPass: false }).toLowerCase(),
    ));
    const result = await engine.analyzeCurrent(
      `daily-catalog-validation:${order}`,
      {
        contractVersion: ANALYSIS_ENGINE_CONTRACT_VERSION,
        gameId: puzzle.sourceId,
        gameVersion: 0,
        boardSize: 13,
        komi: 7.5,
        rules: "chinese",
        initialStones,
        initialPlayer: "black",
        moves: [],
        allowMoves: [
          { player: "black", moves: localMoves, untilDepth: 3 },
          { player: "white", moves: localMoves, untilDepth: 3 },
        ],
      },
      visits,
      { priority: -10, timeoutMs: 600_000 },
    );
    const best = [...result.moveInfos]
      .filter((candidate) => candidate.move.toLowerCase() !== "pass")
      .sort((left, right) => left.order - right.order || right.visits - left.visits)[0];
    assert.ok(best, `Puzzle ${order} returned no board move.`);
    assert.ok(
      expected.has(best.move.toLowerCase()),
      `Puzzle ${order}: expected ${[...expected].join("/")}, KataGo chose ${best.move}.`,
    );
    console.log(`daily ${order}/${DAILY_PUZZLE_CYCLE_LENGTH}: ${best.move} confirmed`);
  }
  console.log(start === 1 && end === DAILY_PUZZLE_CYCLE_LENGTH
    ? `KataGo confirmed all ${DAILY_PUZZLE_CYCLE_LENGTH} daily puzzle answers.`
    : `KataGo confirmed daily puzzles ${start}-${end}.`);
}

run()
  .finally(() => engine.close())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
