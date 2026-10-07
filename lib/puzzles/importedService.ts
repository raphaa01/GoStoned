import { query, withTransaction } from "@/lib/db";
import { applyMove } from "@/lib/game/goEngine";
import { GameServiceError } from "@/lib/game/gameService";
import { toGtpCoordinate } from "@/lib/analysis/coordinates";
import { deriveGoRank } from "@/lib/rating/rankPolicy";
import { IMPORTED_PUZZLES, IMPORTED_CATALOG_VERSION, dailyImportedPuzzle, matchingPuzzlePaths, puzzleText, replayPuzzleLine, type ImportedPuzzle } from "./importedCatalog";
import { orderPuzzleQueue } from "./queue";
import { PUZZLE_CATEGORIES, type PuzzleAttemptInput, type PuzzleAttemptResult, type PuzzleHint, type PuzzleHub, type PuzzleKind, type PuzzlePly, type PuzzleSolution, type PuzzleView } from "./types";

type AttemptRow = { id: string; attempt_count: number | null; solved: boolean | null; first_attempt_correct: boolean | null; variation_progress: PuzzlePly[] | null; variation_revision: number | null };
const catalogIds = IMPORTED_PUZZLES.map((puzzle) => puzzle.id);
function puzzleSolution(puzzle: ImportedPuzzle, line = puzzle.paths[0].line): PuzzleSolution {
  return { ...line[0], explanation: puzzle.paths.find((path) => path.solved && path.line.map((ply) => ply.move).join("/") === line.map((ply) => ply.move).join("/"))?.explanation ?? puzzle.paths[0].explanation, line };
}
function puzzleView(puzzle: ImportedPuzzle, row: AttemptRow | undefined, mode: PuzzleKind, date: string): PuzzleView {
  const progress = row?.variation_progress ?? [];
  return { id: puzzle.id, kind: mode, category: null, rankKyu: puzzle.rankKyu, collectionOrder: puzzle.order, dailyDate: mode === "daily" ? date : null, boardSize: 19, toPlay: puzzle.toPlay, board: puzzle.board, difficulty: puzzle.rankKyu >= 21 ? "beginner" : puzzle.rankKyu >= 10 ? "intermediate" : "advanced", publishedAt: "2026-10-07T00:00:00.000Z", attemptCount: row?.attempt_count ?? 0, solved: row?.solved ?? false, firstAttemptCorrect: row?.first_attempt_correct ?? null, variationProgress: progress, variationRevision: row?.variation_revision ?? 0, solution: row?.solved ? puzzleSolution(puzzle, progress) : null, viewportSize: puzzle.viewportSize, goal: puzzle.goal, targetStones: puzzle.target };
}
async function ensureImportedCatalog() {
  // Existing catalog rows and their attempts remain untouched as an archive.
  // The new UUID list is the only public catalog; solutions stay server-side.
  await query(`INSERT INTO puzzles (id, kind, board_size, to_play, position_moves, board, solution_move, solution_x, solution_y, alternatives, difficulty, explanation, engine_version, model_name, visits)
    SELECT id, 'practice', 19, to_play, '[]'::jsonb, board, solution_move, solution_x, solution_y, '[]'::jsonb, difficulty, explanation, $2, $2, 0
      FROM jsonb_to_recordset($1::jsonb) AS source(id uuid, to_play text, board jsonb, solution_move text, solution_x int, solution_y int, difficulty text, explanation jsonb)
    ON CONFLICT (id) DO NOTHING`, [JSON.stringify(IMPORTED_PUZZLES.map((puzzle) => ({ id: puzzle.id, to_play: puzzle.toPlay, board: puzzle.board, solution_move: puzzle.paths[0].line[0].move, solution_x: puzzle.paths[0].line[0].x, solution_y: puzzle.paths[0].line[0].y, difficulty: puzzle.rankKyu >= 21 ? "beginner" : puzzle.rankKyu >= 10 ? "intermediate" : "advanced", explanation: puzzle.paths[0].explanation }))), IMPORTED_CATALOG_VERSION]);
}
export async function readImportedPuzzleHub(playerKey: string, mode: PuzzleKind): Promise<PuzzleHub> {
  await ensureImportedCatalog();
  const result = await query<AttemptRow & { today: string; rating: number | null }>(`SELECT puzzle.id, CURRENT_DATE::text AS today, attempt.attempt_count, attempt.solved, attempt.first_attempt_correct, attempt.variation_progress, attempt.variation_revision, rating.rating::double precision AS rating
    FROM puzzles puzzle LEFT JOIN puzzle_attempts attempt ON attempt.puzzle_id = puzzle.id AND attempt.player_key = $1
    LEFT JOIN player_glicko2_ratings rating ON rating.player_key = $1 WHERE puzzle.id = ANY($2::uuid[])`, [playerKey, catalogIds]);
  const date = result.rows[0]?.today;
  if (!date) throw new Error("Imported puzzle catalog is unavailable.");
  const rank = deriveGoRank(result.rows[0]?.rating ?? 500);
  const daily = dailyImportedPuzzle(date);
  const puzzles = (mode === "daily" ? [daily] : IMPORTED_PUZZLES).map((puzzle) => puzzleView(puzzle, result.rows.find((row) => row.id === puzzle.id), mode, date));
  return { status: "ready", mode, puzzles: orderPuzzleQueue(puzzles, rank.kind === "kyu" ? rank.value : 1), expectedPerCategory: 0, categoryCounts: Object.fromEntries(PUZZLE_CATEGORIES.map((category) => [category, 0])) as PuzzleHub["categoryCounts"], dailyCycleLength: IMPORTED_PUZZLES.length };
}
function findPuzzle(id: string): ImportedPuzzle {
  const puzzle = IMPORTED_PUZZLES.find((candidate) => candidate.id === id);
  if (!puzzle) throw new GameServiceError("Puzzle not found.", 404, "puzzle_not_found");
  return puzzle;
}
async function assertAccess(puzzle: ImportedPuzzle, accountAccess: boolean) {
  if (accountAccess) return;
  const date = await query<{ today: string }>("SELECT CURRENT_DATE::text AS today");
  if (dailyImportedPuzzle(date.rows[0].today).id !== puzzle.id) throw new GameServiceError("Please log in first.", 401, "authentication_required");
}
export async function attemptImportedPuzzle(id: string, playerKey: string, selected: PuzzleAttemptInput, accountAccess: boolean): Promise<PuzzleAttemptResult> {
  const puzzle = findPuzzle(id);
  await assertAccess(puzzle, accountAccess);
  return withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`puzzle:${id}:${playerKey}`]);
    const stored = await client.query<AttemptRow>("SELECT puzzle_id AS id, attempt_count, solved, first_attempt_correct, variation_progress, variation_revision FROM puzzle_attempts WHERE puzzle_id = $1 AND player_key = $2 FOR UPDATE", [id, playerKey]);
    const row = stored.rows[0];
    const progress = row?.variation_progress ?? [];
    if (selected.revision !== (row?.variation_revision ?? 0)) throw new GameServiceError("The puzzle changed. Reload its current variation.", 409, "puzzle_revision_conflict");
    if (row?.solved) return { puzzleId: id, correct: true, outcome: "solved", solved: true, attemptCount: row.attempt_count ?? 0, firstAttemptCorrect: row.first_attempt_correct, variationProgress: progress, variationRevision: row.variation_revision ?? 0, displayLine: [], solution: puzzleSolution(puzzle, progress), feedback: null };
    if ((row?.variation_revision ?? 0) >= 1000) throw new GameServiceError("The puzzle attempt limit has been reached.", 429, "rate_limit_exceeded");
    let nextProgress = progress;
    let displayLine: PuzzlePly[] = [];
    let outcome: PuzzleAttemptResult["outcome"] = "continue";
    let failed = false;
    let feedback: PuzzleAttemptResult["feedback"] = null;
    const undo = selected.action === "undo";
    const restart = selected.action === "restart";
    if (undo || restart) {
      let lastPlayer = progress.length - 1;
      while (lastPlayer >= 0 && progress[lastPlayer].color !== puzzle.toPlay) lastPlayer--;
      nextProgress = restart ? [] : progress.slice(0, Math.max(0, lastPlayer));
    } else {
      const board = replayPuzzleLine(puzzle.board, progress);
      const pass = selected.action === "pass";
      if (!pass && !applyMove(board, puzzle.toPlay, selected.x, selected.y).ok) throw new GameServiceError("That intersection is not available.", 409, "puzzle_move_unavailable");
      const played: PuzzlePly = pass ? { color: puzzle.toPlay, x: -1, y: -1, move: "pass" } : { color: puzzle.toPlay, x: selected.x, y: selected.y, move: toGtpCoordinate(19, { ...selected, isPass: false }) };
      const candidates = matchingPuzzlePaths(puzzle, [...progress, played]);
      const chosen = candidates.find((path) => path.solved) ?? candidates[0];
      if (!chosen) {
        outcome = "unknown";
        feedback = puzzleText("This move has no verified continuation. Try another move.", "Für diesen Zug gibt es keine geprüfte Fortsetzung. Versuche einen anderen Zug.");
      } else {
        nextProgress = [...progress, played];
        const reply = chosen.line[nextProgress.length];
        if (reply && reply.color !== puzzle.toPlay) nextProgress.push(reply);
        replayPuzzleLine(puzzle.board, nextProgress);
        displayLine = nextProgress;
        if (nextProgress.length === chosen.line.length) {
          outcome = chosen.solved ? "solved" : "retry";
          feedback = chosen.explanation;
          if (!chosen.solved) {
            failed = true;
            // Keep the position before the first losing decision. Undo/retry
            // can immediately continue here, even after a long refutation.
            let safe = 0;
            while (safe < nextProgress.length && matchingPuzzlePaths(puzzle, nextProgress.slice(0, safe + 1)).some((path) => path.solved)) safe++;
            if (safe % 2 !== 0) safe--;
            nextProgress = nextProgress.slice(0, safe);
          }
        }
      }
    }
    if (outcome === "unknown") return { puzzleId: id, correct: false, outcome, solved: false, attemptCount: row?.attempt_count ?? 0, firstAttemptCorrect: row?.first_attempt_correct ?? null, variationProgress: progress, variationRevision: row?.variation_revision ?? 0, displayLine: [], solution: null, feedback };
    const saved = await client.query<AttemptRow>(`INSERT INTO puzzle_attempts (puzzle_id, player_key, attempt_count, solved, first_attempt_correct, selected_x, selected_y, variation_progress, variation_revision, solved_at)
      VALUES ($1, $2, 1, $3, $4, $5, $6, $7::jsonb, 1, CASE WHEN $3 THEN NOW() END)
      ON CONFLICT (puzzle_id, player_key) DO UPDATE SET attempt_count = LEAST(puzzle_attempts.attempt_count + 1, 1000), solved = EXCLUDED.solved,
      first_attempt_correct = COALESCE(puzzle_attempts.first_attempt_correct, EXCLUDED.first_attempt_correct), selected_x = EXCLUDED.selected_x, selected_y = EXCLUDED.selected_y,
      variation_progress = EXCLUDED.variation_progress, variation_revision = puzzle_attempts.variation_revision + 1, last_attempt_at = NOW(), solved_at = EXCLUDED.solved_at
      RETURNING puzzle_id AS id, attempt_count, solved, first_attempt_correct, variation_progress, variation_revision`, [id, playerKey, outcome === "solved", failed ? false : outcome === "solved" ? true : null, Math.max(0, selected.x), Math.max(0, selected.y), JSON.stringify(nextProgress)]);
    const state = saved.rows[0];
    return { puzzleId: id, correct: !failed, outcome, solved: outcome === "solved", attemptCount: state.attempt_count ?? 0, firstAttemptCorrect: state.first_attempt_correct, variationProgress: nextProgress, variationRevision: state.variation_revision ?? 0, displayLine, displayLineIsComplete: true, feedback, solution: outcome === "solved" ? puzzleSolution(puzzle, nextProgress) : null };
  });
}
export async function readImportedPuzzleHint(id: string, playerKey: string, accountAccess: boolean): Promise<PuzzleHint> {
  const puzzle = findPuzzle(id);
  await assertAccess(puzzle, accountAccess);
  const stored = await query<AttemptRow>("SELECT variation_progress FROM puzzle_attempts WHERE puzzle_id = $1 AND player_key = $2", [id, playerKey]);
  const progress = stored.rows[0]?.variation_progress ?? [];
  const hint = matchingPuzzlePaths(puzzle, progress).find((path) => path.solved)?.line[progress.length];
  if (!hint) throw new GameServiceError("Undo a move to return to the solution.", 409, "puzzle_move_unavailable");
  return { x: hint.x, y: hint.y };
}
