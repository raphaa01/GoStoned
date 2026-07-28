import type { PoolClient, QueryResultRow } from "pg";
import { query, withTransaction } from "@/lib/db";
import {
  applyMove,
  boardHash,
  getGroup,
  replayMovesWithPrisoners,
} from "./goEngine";
import { advanceClock, restingClock, type ClockAdvance } from "./goClock";
import { MAX_PERSISTED_GAME_VERSION } from "./gamePolling";
import {
  isRepeatedPositionForbidden,
  removeDeadStones,
  resumeTurnForPolicy,
  scoreAgreementPosition,
  scoreImmediatePosition,
  scoringDeadlineExpired,
  toggleDeadGroup,
} from "./scoring";
import {
  LEGACY_IMMEDIATE_AREA_PROFILE,
  resolveRulesConfiguration,
  resolveScoringConfiguration,
  type ResolvedRulesConfiguration,
  type RulesPolicy,
  UnsupportedRulesPolicyError,
} from "./rulesPolicy";
import {
  ScoreContractError,
  tagChineseAreaScore,
  type ChineseAreaComputation,
  type ScoredOutcome,
} from "./scoreContract";
import {
  hasExactlyRegisteredParticipants,
  type RegisteredPlayerRow,
} from "./ratingPolicy";
import type {
  Board,
  BoardSize,
  ChineseAreaScore,
  GameClockState,
  GamePollHeartbeat,
  GameState,
  Position,
  Stone,
  StoredMove,
  TimeControlId,
} from "./types";

type GameRow = {
  id: string;
  board_size: BoardSize;
  black_player_key: string;
  white_player_key: string;
  black_player_name: string;
  white_player_name: string;
  winner_key: string | null;
  rated: boolean;
  status: "active" | "finished";
  phase: "play" | "scoring";
  to_move: Stone | null;
  consecutive_passes: number;
  scoring_revision: number;
  result: string | null;
  finish_reason: "score" | "resignation" | "timeout" | "legacy_score" | null;
  last_resume_claim: "dead" | "alive" | "deadline" | null;
  last_resume_by: Stone | null;
  last_resume_x: number | null;
  last_resume_y: number | null;
  komi: string | number;
  rules: unknown;
  rules_profile: unknown;
  scoring_method: unknown;
  handicap: number;
  time_control: TimeControlId;
  main_time_seconds: number;
  byo_yomi_periods: number;
  byo_yomi_seconds: number;
  black_time_remaining_ms: string | number;
  white_time_remaining_ms: string | number;
  black_periods_remaining: number;
  white_periods_remaining: number;
  turn_started_at: Date;
  version: number;
  started_at: Date;
  finished_at: Date | null;
};

type MoveRow = {
  move_number: number;
  color: Stone;
  x: number | null;
  y: number | null;
  is_pass: boolean;
  board_hash: string | null;
  created_at: Date;
};

type ScoringRow = {
  game_id: string;
  board_hash: string;
  stopped_move_number: number;
  revision: number;
  rules: unknown;
  rules_profile: unknown;
  scoring_method: unknown;
  komi: string | number;
  handicap: number;
  fallback_to_move: Stone;
  expires_at: Date;
  black_confirmed_revision: number | null;
  white_confirmed_revision: number | null;
  black_confirmed_at: Date | null;
  white_confirmed_at: Date | null;
  scored_board_hash: string | null;
  black_stones: number | null;
  white_stones: number | null;
  black_territory: number | null;
  white_territory: number | null;
  neutral_points: number | null;
  black_dead_stones: number | null;
  white_dead_stones: number | null;
  black_total: string | number | null;
  white_total: string | number | null;
  result: string | null;
  started_at: Date;
  updated_at: Date;
  finalized_at: Date | null;
};

type DeadStoneRow = Position & {
  color: Stone;
};

type LoadedGame = {
  game: GameRow;
  rules: ResolvedRulesConfiguration;
  moveRows: MoveRow[];
  board: Board;
  positionHistory: readonly string[];
  scoring: ScoringRow | null;
  deadRows: DeadStoneRow[];
};

type PollGameRow = Pick<
  GameRow,
  | "id"
  | "black_player_key"
  | "white_player_key"
  | "winner_key"
  | "status"
  | "phase"
  | "to_move"
  | "scoring_revision"
  | "result"
  | "finish_reason"
  | "rules"
  | "rules_profile"
  | "scoring_method"
  | "komi"
  | "handicap"
  | "main_time_seconds"
  | "byo_yomi_periods"
  | "byo_yomi_seconds"
  | "black_time_remaining_ms"
  | "white_time_remaining_ms"
  | "black_periods_remaining"
  | "white_periods_remaining"
  | "turn_started_at"
  | "version"
  | "finished_at"
>;

type PollScoringRow = {
  revision: number;
  expires_at: Date;
};

export class GameServiceError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
  }
}

function storedRulesConfiguration(input: {
  rules: unknown;
  rules_profile: unknown;
  scoring_method: unknown;
  komi: unknown;
  handicap: unknown;
}): ResolvedRulesConfiguration {
  try {
    return resolveRulesConfiguration({
      ruleset: input.rules,
      rulesProfile: input.rules_profile,
      scoringMethod: input.scoring_method,
      komi: input.komi,
      handicap: input.handicap,
    });
  } catch (error) {
    if (error instanceof UnsupportedRulesPolicyError) {
      throw new GameServiceError(
        "The stored rules configuration is not supported.",
        500,
        "rules_configuration_unsupported",
      );
    }
    throw error;
  }
}

function storedScoringConfiguration(
  game: ResolvedRulesConfiguration,
  input: {
    rules: unknown;
    rules_profile: unknown;
    scoring_method: unknown;
    komi: unknown;
    handicap: unknown;
  },
): ResolvedRulesConfiguration {
  try {
    return resolveScoringConfiguration(game, {
      ruleset: input.rules,
      rulesProfile: input.rules_profile,
      scoringMethod: input.scoring_method,
      komi: input.komi,
      handicap: input.handicap,
    });
  } catch (error) {
    if (error instanceof UnsupportedRulesPolicyError) {
      throw new GameServiceError(
        "The scoring snapshot does not match the game's rules configuration.",
        500,
        "rules_configuration_mismatch",
      );
    }
    throw error;
  }
}

function assertRulesLifecycle(
  game: GameRow,
  policy: RulesPolicy,
  scoring: ScoringRow | null,
): void {
  const activePlay = game.status === "active"
    && game.phase === "play"
    && game.finish_reason === null;
  const activeScoring = game.status === "active"
    && game.phase === "scoring"
    && game.finish_reason === null;
  const finishedAgreementScore = game.status === "finished"
    && game.phase === "scoring"
    && game.finish_reason === "score";
  const finishedWithoutScoring = game.status === "finished"
    && game.phase === "play"
    && (game.finish_reason === "resignation" || game.finish_reason === "timeout");
  const finishedLegacyScore = game.status === "finished"
    && game.phase === "play"
    && game.finish_reason === "legacy_score";

  const lifecycleValid = policy.scoringLifecycle === "agreement"
    ? activePlay || activeScoring || finishedAgreementScore || finishedWithoutScoring
    : activePlay || finishedWithoutScoring || finishedLegacyScore;
  const scoringPresenceValid = policy.scoringLifecycle === "agreement"
    && (activeScoring || finishedAgreementScore)
    ? scoring !== null
    : scoring === null;

  if (!lifecycleValid || !scoringPresenceValid) {
    throw new GameServiceError(
      "The stored scoring lifecycle does not match the game's rules configuration.",
      500,
      "rules_configuration_mismatch",
    );
  }
}

function normalizeHistoricalRulesLifecycle(
  game: GameRow,
  policy: RulesPolicy,
  scoring: ScoringRow | null,
): { game: GameRow; scoring: ScoringRow | null } {
  const winnerMatchesResult = game.result?.startsWith("B+")
    ? game.winner_key === game.black_player_key
    : game.result?.startsWith("W+")
      ? game.winner_key === game.white_player_key
      : false;

  // The agreement-scoring release originally allowed resignation without
  // clearing its snapshot or returning the terminal game to the play phase.
  // Preserve those exact terminal rows as a canonical, read-only resignation.
  if (
    policy.scoringLifecycle === "agreement"
    && game.status === "finished"
    && game.phase === "scoring"
    && game.finish_reason === "resignation"
    && game.result !== null
    && /^[BW]\+R$/.test(game.result)
    && winnerMatchesResult
    && game.finished_at !== null
    && game.to_move === null
    && game.scoring_revision === scoring?.revision
    && scoring !== null
    && finalScoreFields(scoring).every((value) => value === null)
    && scoringConfirmationCount(scoring) <= 1
  ) {
    return {
      game: { ...game, phase: "play" },
      scoring: null,
    };
  }

  // Migration 008 deliberately retained the legacy default while older app
  // instances drained. A game they finished after the one-time backfill has
  // no finish_reason, so derive the same value the migration would have used.
  if (
    policy.scoringLifecycle === "immediate"
    && game.status === "finished"
    && game.phase === "play"
    && game.finish_reason === null
    && game.result !== null
    && /^[BW]\+(?:R|T|\d+(?:\.5)?)$/.test(game.result)
    && winnerMatchesResult
    && game.finished_at !== null
    && scoring === null
  ) {
    const finishReason = game.result.endsWith("+R")
      ? "resignation"
      : game.result.endsWith("+T")
        ? "timeout"
        : "legacy_score";
    return {
      game: { ...game, finish_reason: finishReason, to_move: null },
      scoring,
    };
  }

  return { game, scoring };
}

function gameOutcomeMismatch(): never {
  throw new GameServiceError(
    "The stored game outcome is internally inconsistent.",
    500,
    "game_outcome_mismatch",
  );
}

function resultWinnerKey(game: GameRow, result: string): string | null | undefined {
  if (result === "Draw") return null;
  if (result.startsWith("B+")) return game.black_player_key;
  if (result.startsWith("W+")) return game.white_player_key;
  return undefined;
}

function assertGameOutcome(loaded: LoadedGame): void {
  const { game, rules, moveRows, board } = loaded;
  if (game.status === "active") {
    if (
      game.result !== null
      || game.winner_key !== null
      || game.finished_at !== null
      || (game.phase === "play"
        && rules.policy.turnSource === "persisted"
        && game.to_move === null)
    ) {
      return gameOutcomeMismatch();
    }
    return;
  }

  if (game.result === null || game.finished_at === null || game.to_move !== null) {
    return gameOutcomeMismatch();
  }

  if (game.finish_reason === "resignation" || game.finish_reason === "timeout") {
    const suffix = game.finish_reason === "resignation" ? "R" : "T";
    if (
      !new RegExp(`^[BW]\\+${suffix}$`).test(game.result)
      || resultWinnerKey(game, game.result) !== game.winner_key
    ) {
      return gameOutcomeMismatch();
    }
    if (game.finish_reason === "timeout") {
      const timedOutColor = game.result.startsWith("B+") ? "white" : "black";
      const remainingTime = Number(game[`${timedOutColor}_time_remaining_ms`]);
      const remainingPeriods = game[`${timedOutColor}_periods_remaining`];
      if (remainingTime !== 0 || remainingPeriods !== 0) {
        return gameOutcomeMismatch();
      }
    }
    return;
  }

  if (game.finish_reason === "legacy_score") {
    if (
      moveRows.length < 2
      || !moveRows.at(-1)?.is_pass
      || !moveRows.at(-2)?.is_pass
    ) {
      return gameOutcomeMismatch();
    }
    const computation = scoreImmediatePosition(rules.policy, board, rules.komi);
    if (
      requireChineseAreaBreakdown(computation).result !== game.result
      || winnerKeyForScoredOutcome(game, computation.outcome) !== game.winner_key
    ) {
      return gameOutcomeMismatch();
    }
  }
}

function assertParticipant(
  game: Pick<GameRow, "black_player_key" | "white_player_key">,
  playerKey: string,
) {
  if (playerKey !== game.black_player_key && playerKey !== game.white_player_key) {
    throw new GameServiceError("You are not a participant in this game.", 403, "not_participant");
  }
}

function playerColor(game: GameRow, playerKey: string): Stone {
  return playerKey === game.black_player_key ? "black" : "white";
}

function opposite(color: Stone): Stone {
  return color === "black" ? "white" : "black";
}

function mapMoves(rows: MoveRow[]): StoredMove[] {
  return rows.map((move) => ({
    moveNumber: move.move_number,
    color: move.color,
    x: move.x,
    y: move.y,
    isPass: move.is_pass,
    createdAt: move.created_at.toISOString(),
  }));
}

function moveHistoryMismatch(): never {
  throw new GameServiceError(
    "The stored move history could not be verified.",
    500,
    "move_history_mismatch",
  );
}

function replayStoredMoveRows(
  boardSize: BoardSize,
  rows: MoveRow[],
  policy: RulesPolicy,
): Readonly<{ board: Board; positionHistory: readonly string[] }> {
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (
      row.move_number !== index + 1
      || (row.is_pass && (row.x !== null || row.y !== null))
      || (!row.is_pass && (row.x === null || row.y === null))
      || (policy.turnSource === "move-log"
        && row.color !== (index % 2 === 0 ? "black" : "white"))
    ) {
      return moveHistoryMismatch();
    }
  }
  let replay: ReturnType<typeof replayMovesWithPrisoners>;
  try {
    replay = replayMovesWithPrisoners(boardSize, mapMoves(rows));
  } catch {
    return moveHistoryMismatch();
  }

  const priorHashes = new Set<string>([replay.positionHistory[0]]);
  for (let index = 0; index < rows.length; index += 1) {
    const storedHash = rows[index].board_hash;
    const replayedHash = replay.positionHistory[index + 1];
    // Migration 002 added nullable hashes after live games already existed.
    // Migration 008 assigned those games the legacy profile. Reconstruct only
    // that known history; current-profile games must carry matching evidence.
    if (
      (storedHash === null && policy.profile !== LEGACY_IMMEDIATE_AREA_PROFILE)
      || (storedHash !== null && storedHash !== replayedHash)
      || (!rows[index].is_pass
        && isRepeatedPositionForbidden(policy, replayedHash, priorHashes))
    ) {
      return moveHistoryMismatch();
    }
    priorHashes.add(replayedHash);
  }
  return { board: replay.board, positionHistory: replay.positionHistory };
}

async function loadGame(
  client: PoolClient | null,
  gameId: string,
  playerKey: string,
  lock = false,
): Promise<LoadedGame> {
  const execute = <T extends QueryResultRow>(text: string, values: readonly unknown[]) =>
    client ? client.query<T>(text, [...values]) : query<T>(text, values);
  const gameResult = await execute<GameRow>(
    `SELECT g.id, g.board_size, g.black_player_key, g.white_player_key, g.winner_key,
            g.status, g.phase, g.to_move, g.consecutive_passes, g.scoring_revision,
            g.result, g.finish_reason, g.last_resume_claim, g.last_resume_by,
            g.last_resume_x, g.last_resume_y, g.komi, g.rules, g.rules_profile,
            g.scoring_method, g.handicap, g.time_control, g.main_time_seconds,
            g.byo_yomi_periods, g.byo_yomi_seconds,
            g.black_time_remaining_ms, g.white_time_remaining_ms,
            g.black_periods_remaining, g.white_periods_remaining,
            g.turn_started_at, g.version, g.started_at, g.finished_at,
            COALESCE(
              NULLIF(BTRIM(black_user.display_name), ''),
              black_user.username,
              'Guest ' || UPPER(RIGHT(g.black_player_key, 6))
            ) AS black_player_name,
            COALESCE(
              NULLIF(BTRIM(white_user.display_name), ''),
              white_user.username,
              'Guest ' || UPPER(RIGHT(g.white_player_key, 6))
            ) AS white_player_name,
            CASE
              WHEN g.status = 'finished' THEN (
                SELECT COUNT(DISTINCT history.player_key) = 2
                  FROM player_rating_history history
                 WHERE history.game_id = g.id
                   AND history.player_key IN (g.black_player_key, g.white_player_key)
              )
              ELSE g.black_player_key <> g.white_player_key
                AND black_user.id IS NOT NULL AND white_user.id IS NOT NULL
            END AS rated
       FROM games g
       LEFT JOIN users black_user
         ON g.black_player_key = 'user:' || black_user.id::text
       LEFT JOIN users white_user
         ON g.white_player_key = 'user:' || white_user.id::text
      WHERE g.id = $1${lock ? " FOR UPDATE OF g" : ""}`,
    [gameId],
  );
  let game = gameResult.rows[0];
  if (!game) throw new GameServiceError("Game not found.", 404, "game_not_found");
  assertParticipant(game, playerKey);
  const rules = storedRulesConfiguration(game);

  const movesResult = await execute<MoveRow>(
    `SELECT move_number, color, x, y, is_pass, board_hash, created_at
       FROM moves
      WHERE game_id = $1
      ORDER BY move_number`,
    [gameId],
  );
  const replay = replayStoredMoveRows(game.board_size, movesResult.rows, rules.policy);

  const scoringResult = await execute<ScoringRow>(
    `SELECT * FROM game_scoring_state WHERE game_id = $1${lock ? " FOR UPDATE" : ""}`,
    [gameId],
  );
  let scoring: ScoringRow | null = scoringResult.rows[0] ?? null;
  let deadRows: DeadStoneRow[] = [];
  if (scoring) {
    storedScoringConfiguration(rules, scoring);
    const deadResult = await execute<DeadStoneRow>(
      `SELECT x, y, color
         FROM game_dead_stones
        WHERE game_id = $1
        ORDER BY y, x`,
      [gameId],
    );
    deadRows = deadResult.rows;
    validateScoringPosition(
      {
        game,
        rules,
        moveRows: movesResult.rows,
        board: replay.board,
        positionHistory: replay.positionHistory,
        scoring,
        deadRows,
      },
      replay.board,
    );
  }
  const normalized = normalizeHistoricalRulesLifecycle(game, rules.policy, scoring);
  game = normalized.game;
  scoring = normalized.scoring;
  if (!scoring) deadRows = [];
  assertRulesLifecycle(game, rules.policy, scoring);

  const loaded = {
    game,
    rules,
    moveRows: movesResult.rows,
    board: replay.board,
    positionHistory: replay.positionHistory,
    scoring,
    deadRows,
  };
  if (scoring) {
    validateScoringSnapshot(loaded, replay.board);
  }
  assertGameOutcome(loaded);
  return loaded;
}

function currentTurn(
  game: GameRow,
  moveRows: MoveRow[],
  policy: RulesPolicy,
): Stone | null {
  if (game.status !== "active" || game.phase !== "play") return null;
  // Migration 008 is a schema-first expand step. The previous application
  // does not maintain to_move, so a legacy game remains move-log-authoritative
  // even if it was active during the deployment window.
  if (policy.turnSource === "move-log") {
    return moveRows.length % 2 === 0 ? "black" : "white";
  }
  return game.to_move;
}

function effectiveConsecutivePasses(
  game: GameRow,
  moveRows: MoveRow[],
  policy: RulesPolicy,
): number {
  if (policy.turnSource !== "move-log") return game.consecutive_passes;
  return moveRows.at(-1)?.is_pass ? 1 : 0;
}

type ClockGameRow = Pick<
  GameRow,
  | "main_time_seconds"
  | "byo_yomi_periods"
  | "byo_yomi_seconds"
  | "black_time_remaining_ms"
  | "white_time_remaining_ms"
  | "black_periods_remaining"
  | "white_periods_remaining"
  | "turn_started_at"
>;

function calculateClocks(
  game: ClockGameRow,
  turn: Stone | null,
  now: Date,
): { black: ClockAdvance; white: ClockAdvance } {
  const periodTimeMs = game.byo_yomi_seconds * 1_000;
  const elapsedMs = Math.max(0, now.getTime() - game.turn_started_at.getTime());
  const blackInput = {
    mainTimeMs: Number(game.black_time_remaining_ms),
    periodsRemaining: game.black_periods_remaining,
    periodTimeMs,
  };
  const whiteInput = {
    mainTimeMs: Number(game.white_time_remaining_ms),
    periodsRemaining: game.white_periods_remaining,
    periodTimeMs,
  };
  return {
    black: turn === "black"
      ? advanceClock({ ...blackInput, elapsedMs })
      : restingClock(blackInput.mainTimeMs, blackInput.periodsRemaining, blackInput.periodTimeMs),
    white: turn === "white"
      ? advanceClock({ ...whiteInput, elapsedMs })
      : restingClock(whiteInput.mainTimeMs, whiteInput.periodsRemaining, whiteInput.periodTimeMs),
  };
}

function serializeGameClock(
  game: ClockGameRow,
  turn: Stone | null,
  now: Date,
): GameClockState {
  const clocks = calculateClocks(game, turn, now);
  return {
    serverNow: now.toISOString(),
    mainTimeSeconds: game.main_time_seconds,
    byoYomiPeriods: game.byo_yomi_periods,
    byoYomiSeconds: game.byo_yomi_seconds,
    black: {
      mainTimeMs: clocks.black.mainTimeMs,
      periodsRemaining: clocks.black.periodsRemaining,
      displayTimeMs: clocks.black.displayTimeMs,
      phase: clocks.black.phase,
    },
    white: {
      mainTimeMs: clocks.white.mainTimeMs,
      periodsRemaining: clocks.white.periodsRemaining,
      displayTimeMs: clocks.white.displayTimeMs,
      phase: clocks.white.phase,
    },
  };
}

function scoringSnapshotMismatch(): never {
  throw new GameServiceError(
    "The stored score does not match its Chinese area-scoring contract.",
    500,
    "scoring_snapshot_mismatch",
  );
}

function requireChineseAreaBreakdown(computation: ChineseAreaComputation): ChineseAreaScore {
  if (computation.scoringRule !== "chinese-area") return scoringSnapshotMismatch();
  return computation.breakdown;
}

function winnerKeyForScoredOutcome(game: GameRow, outcome: ScoredOutcome): string | null {
  if (outcome.kind === "jigo") return null;
  return outcome.winner === "black" ? game.black_player_key : game.white_player_key;
}

function sameChineseAreaScore(left: ChineseAreaScore, right: ChineseAreaScore): boolean {
  return left.black === right.black
    && left.white === right.white
    && left.blackStones === right.blackStones
    && left.whiteStones === right.whiteStones
    && left.blackTerritory === right.blackTerritory
    && left.whiteTerritory === right.whiteTerritory
    && left.neutralPoints === right.neutralPoints
    && left.winner === right.winner
    && left.margin === right.margin
    && left.result === right.result;
}

function assertScoringBoardMatches(
  loaded: LoadedGame,
  scoring: ScoringRow,
  board: Board,
): void {
  if (
    scoring.stopped_move_number !== loaded.moveRows.length
    || boardHash(board) !== scoring.board_hash
  ) {
    return scoringSnapshotMismatch();
  }
}

function validateDeadStoneRows(board: Board, deadRows: DeadStoneRow[]): Position[] {
  const positions: Position[] = [];
  const seen = new Set<string>();
  for (const { x, y, color } of deadRows) {
    const key = `${x}:${y}`;
    if (
      !Number.isInteger(x)
      || !Number.isInteger(y)
      || seen.has(key)
      || board[y]?.[x] !== color
    ) {
      return scoringSnapshotMismatch();
    }
    seen.add(key);
    positions.push({ x, y });
  }
  for (const position of positions) {
    if (getGroup(board, position).some((stone) => !seen.has(`${stone.x}:${stone.y}`))) {
      return scoringSnapshotMismatch();
    }
  }
  return positions;
}

function validateScoringPosition(loaded: LoadedGame, board: Board): Position[] {
  if (!loaded.scoring) return scoringSnapshotMismatch();
  assertScoringBoardMatches(loaded, loaded.scoring, board);
  return validateDeadStoneRows(board, loaded.deadRows);
}

function finalScoreFields(scoring: ScoringRow): unknown[] {
  return [
    scoring.scored_board_hash,
    scoring.black_stones,
    scoring.white_stones,
    scoring.black_territory,
    scoring.white_territory,
    scoring.neutral_points,
    scoring.black_dead_stones,
    scoring.white_dead_stones,
    scoring.black_total,
    scoring.white_total,
    scoring.result,
    scoring.finalized_at,
  ];
}

function scoringConfirmationCount(scoring: ScoringRow): number {
  const confirmations = [
    [scoring.black_confirmed_revision, scoring.black_confirmed_at],
    [scoring.white_confirmed_revision, scoring.white_confirmed_at],
  ] as const;
  for (const [revision, confirmedAt] of confirmations) {
    if (
      (revision === null) !== (confirmedAt === null)
      || (revision !== null && revision !== scoring.revision)
    ) {
      return scoringSnapshotMismatch();
    }
  }
  return confirmations.filter(([revision]) => revision !== null).length;
}

function storedFinalScore(scoring: ScoringRow, komi: number): ChineseAreaComputation | null {
  const finalFields = finalScoreFields(scoring);
  if (finalFields.every((value) => value === null)) {
    return null;
  }
  if (finalFields.some((value) => value === null)) return scoringSnapshotMismatch();

  const black = Number(scoring.black_total);
  const white = Number(scoring.white_total);
  const score: ChineseAreaScore = {
    black,
    white,
    blackStones: scoring.black_stones!,
    whiteStones: scoring.white_stones!,
    blackTerritory: scoring.black_territory!,
    whiteTerritory: scoring.white_territory!,
    neutralPoints: scoring.neutral_points!,
    winner: black === white ? null : black > white ? "black" : "white",
    margin: Math.abs(black - white),
    result: scoring.result!,
  };
  try {
    return tagChineseAreaScore(score, komi);
  } catch (error) {
    if (error instanceof ScoreContractError) return scoringSnapshotMismatch();
    throw error;
  }
}

type ValidatedScoringSnapshot = Readonly<{
  deadStones: Position[];
  expectedComputation: ChineseAreaComputation;
  storedComputation: ChineseAreaComputation | null;
}>;

function validateScoringSnapshot(
  loaded: LoadedGame,
  board: Board,
): ValidatedScoringSnapshot {
  const { game, rules, scoring, deadRows } = loaded;
  if (!scoring) return scoringSnapshotMismatch();
  if (game.scoring_revision !== scoring.revision) return scoringSnapshotMismatch();
  const deadStones = validateScoringPosition(loaded, board);
  const expectedComputation = scoreAgreementPosition(
    rules.policy,
    board,
    deadStones,
    rules.komi,
  );
  const storedComputation = storedFinalScore(scoring, rules.komi);
  const isFinalScore = game.status === "finished" && game.finish_reason === "score";
  if ((storedComputation !== null) !== isFinalScore) return scoringSnapshotMismatch();
  const confirmationCount = scoringConfirmationCount(scoring);

  if (isFinalScore) {
    const storedDeadCounts = deadRows.reduce(
      (counts, stone) => ({ ...counts, [stone.color]: counts[stone.color] + 1 }),
      { black: 0, white: 0 },
    );
    if (
      !storedComputation
      || confirmationCount !== 2
      || game.finished_at === null
      || game.to_move !== null
      || storedComputation.breakdown.result !== game.result
      || winnerKeyForScoredOutcome(game, storedComputation.outcome) !== game.winner_key
      || !sameChineseAreaScore(storedComputation.breakdown, expectedComputation.breakdown)
      || scoring.scored_board_hash !== boardHash(removeDeadStones(board, deadStones))
      || scoring.black_dead_stones !== storedDeadCounts.black
      || scoring.white_dead_stones !== storedDeadCounts.white
    ) {
      return scoringSnapshotMismatch();
    }
  } else if (
    game.status !== "active"
    || confirmationCount > 1
    || game.result !== null
    || game.winner_key !== null
    || game.finished_at !== null
    || game.to_move !== null
  ) {
    return scoringSnapshotMismatch();
  }

  return { deadStones, expectedComputation, storedComputation };
}

function serializeGame(loaded: LoadedGame, now = new Date()): GameState {
  const { game, rules, moveRows, board, scoring } = loaded;
  const moves = mapMoves(moveRows);
  const turn = currentTurn(game, moveRows, rules.policy);
  const validatedScoring = scoring ? validateScoringSnapshot(loaded, board) : null;
  const deadStones = validatedScoring?.deadStones ?? [];
  const preview = scoring
    ? validatedScoring?.storedComputation?.breakdown
      ?? requireChineseAreaBreakdown(validatedScoring!.expectedComputation)
    : null;
  return {
    id: game.id,
    boardSize: game.board_size,
    blackPlayerKey: game.black_player_key,
    whitePlayerKey: game.white_player_key,
    blackPlayerName: game.black_player_name,
    whitePlayerName: game.white_player_name,
    winnerKey: game.winner_key,
    rated: game.rated,
    status: game.status,
    phase: game.phase,
    result: game.result,
    finishReason: game.finish_reason,
    komi: rules.komi,
    ruleset: rules.ruleset,
    rulesProfile: rules.rulesProfile,
    scoringMethod: rules.scoringMethod,
    handicap: rules.handicap,
    consecutivePasses: effectiveConsecutivePasses(game, moveRows, rules.policy),
    scoringRevision: game.scoring_revision,
    lastResume: game.last_resume_claim ? {
      claim: game.last_resume_claim,
      requestedBy: game.last_resume_by,
      disputedStone: game.last_resume_x === null || game.last_resume_y === null
        ? null
        : { x: game.last_resume_x, y: game.last_resume_y },
    } : null,
    scoring: scoring ? {
      revision: scoring.revision,
      boardHash: scoring.board_hash,
      stoppedMoveNumber: scoring.stopped_move_number,
      deadStones,
      blackConfirmed: scoring.black_confirmed_revision === scoring.revision,
      whiteConfirmed: scoring.white_confirmed_revision === scoring.revision,
      preview: preview!,
      finalizedAt: scoring.finalized_at?.toISOString() ?? null,
      expiresAt: scoring.expires_at.toISOString(),
    } : null,
    version: game.version,
    startedAt: game.started_at.toISOString(),
    finishedAt: game.finished_at?.toISOString() ?? null,
    timeControl: game.time_control,
    clock: serializeGameClock(game, turn, now),
    turn,
    moveCount: moves.length,
    board,
    moves,
  };
}

function withUpdatedGame(loaded: LoadedGame, row: GameRow): LoadedGame {
  return {
    ...loaded,
    game: {
      ...row,
      black_player_name: loaded.game.black_player_name,
      white_player_name: loaded.game.white_player_name,
      rated: loaded.game.rated,
    },
  };
}

async function recordFinishedStats(
  client: PoolClient,
  game: GameRow,
  winnerKey: string | null,
) {
  const existingHistory = await client.query<{ player_key: string }>(
    `SELECT player_key
       FROM player_rating_history
      WHERE game_id = $1
      FOR UPDATE`,
    [game.id],
  );
  if (existingHistory.rowCount !== 0) {
    throw new GameServiceError(
      "The rating history already contains evidence before this game finalization.",
      500,
      "rating_history_conflict",
    );
  }

  const registered = await client.query<RegisteredPlayerRow>(
    `SELECT 'user:' || id::text AS player_key
       FROM users
      WHERE 'user:' || id::text IN ($1::text, $2::text)`,
    [game.black_player_key, game.white_player_key],
  );
  if (!hasExactlyRegisteredParticipants(
    [game.black_player_key, game.white_player_key],
    registered.rows,
  )) return false;

  for (const playerKey of [game.black_player_key, game.white_player_key].sort()) {
    const won = winnerKey === playerKey;
    const draw = winnerKey === null;
    const ratingDelta = draw ? 0 : won ? 16 : -16;
    await client.query(
      `INSERT INTO player_stats (player_key, board_size)
       VALUES ($1, $2)
       ON CONFLICT (player_key, board_size) DO NOTHING`,
      [playerKey, game.board_size],
    );
    const current = await client.query<{ rating: number }>(
      `SELECT rating
         FROM player_stats
        WHERE player_key = $1 AND board_size = $2
        FOR UPDATE`,
      [playerKey, game.board_size],
    );
    const ratingBefore = current.rows[0].rating;
    const ratingAfter = Math.max(100, ratingBefore + ratingDelta);
    const ledger = await client.query<{ id: string }>(
      `INSERT INTO player_rating_history
         (player_key, game_id, board_size, rating_before, rating_after,
          rating_change, result, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, NOW()))
       ON CONFLICT (player_key, game_id) DO NOTHING
       RETURNING id`,
      [
        playerKey,
        game.id,
        game.board_size,
        ratingBefore,
        ratingAfter,
        ratingAfter - ratingBefore,
        draw ? "draw" : won ? "win" : "loss",
        game.finished_at,
      ],
    );
    if (ledger.rowCount !== 1) {
      throw new GameServiceError(
        "The rating history could not be recorded exactly once.",
        500,
        "rating_history_conflict",
      );
    }
    await client.query(
      `UPDATE player_stats
          SET games = games + 1,
              wins = wins + $3,
              losses = losses + $4,
              draws = draws + $5,
              rating = $6,
              highest_rating = GREATEST(highest_rating, $6),
              updated_at = NOW()
        WHERE player_key = $1 AND board_size = $2`,
      [
        playerKey,
        game.board_size,
        won ? 1 : 0,
        !won && !draw ? 1 : 0,
        draw ? 1 : 0,
        ratingAfter,
      ],
    );
  }
  return true;
}

async function finishOnTime(
  client: PoolClient,
  loaded: LoadedGame,
  timedOutColor: Stone,
  now: Date,
): Promise<GameState> {
  const { game } = loaded;
  const winnerKey = timedOutColor === "black" ? game.white_player_key : game.black_player_key;
  const winnerColor = timedOutColor === "black" ? "W" : "B";
  const updated = await client.query<GameRow>(
    `UPDATE games
        SET status = 'finished', phase = 'play', to_move = NULL,
            finish_reason = 'timeout', result = $2, winner_key = $3,
            black_time_remaining_ms = CASE WHEN $4 = 'black' THEN 0 ELSE black_time_remaining_ms END,
            white_time_remaining_ms = CASE WHEN $4 = 'white' THEN 0 ELSE white_time_remaining_ms END,
            black_periods_remaining = CASE WHEN $4 = 'black' THEN 0 ELSE black_periods_remaining END,
            white_periods_remaining = CASE WHEN $4 = 'white' THEN 0 ELSE white_periods_remaining END,
            finished_at = $5, updated_at = $5, version = version + 1
      WHERE id = $1
      RETURNING *`,
    [game.id, `${winnerColor}+T`, winnerKey, timedOutColor, now],
  );
  const nextLoaded = withUpdatedGame(loaded, updated.rows[0]);
  const rated = await recordFinishedStats(client, nextLoaded.game, winnerKey);
  return serializeGame({
    ...nextLoaded,
    game: { ...nextLoaded.game, rated },
  }, now);
}

function assertScoringPhase(loaded: LoadedGame, expectedRevision: number): ScoringRow {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    throw new GameServiceError("A valid scoring revision is required.", 400, "invalid_scoring_revision");
  }
  if (loaded.game.status !== "active" || loaded.game.phase !== "scoring" || !loaded.scoring) {
    throw new GameServiceError("This game is not in scoring.", 409, "not_scoring");
  }
  if (
    loaded.game.scoring_revision !== expectedRevision
    || loaded.scoring.revision !== expectedRevision
  ) {
    throw new GameServiceError(
      "The scoring proposal changed. Review the latest position.",
      409,
      "scoring_revision_conflict",
    );
  }
  return loaded.scoring;
}

async function appendScoringResumeEvidence(
  client: PoolClient,
  loaded: LoadedGame & { scoring: ScoringRow },
  event: Readonly<{
    claim: "dead" | "alive" | "deadline";
    requestedBy: Stone | null;
    disputedStone: Position | null;
    resumedToMove: Stone;
    resumedAt: Date;
  }>,
): Promise<void> {
  const { scoring, rules } = loaded;
  await client.query(
    `INSERT INTO game_scoring_resume_events
       (game_id, scoring_revision, board_hash, stopped_move_number,
        rules, rules_profile, scoring_method, komi, handicap,
        fallback_to_move, scoring_expires_at, resume_claim,
        requested_by_color, disputed_x, disputed_y, resumed_to_move, resumed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
             $10, $11, $12, $13, $14, $15, $16, $17)`,
    [
      loaded.game.id,
      scoring.revision,
      scoring.board_hash,
      scoring.stopped_move_number,
      rules.ruleset,
      rules.rulesProfile,
      rules.scoringMethod,
      rules.komi,
      rules.handicap,
      scoring.fallback_to_move,
      scoring.expires_at,
      event.claim,
      event.requestedBy,
      event.disputedStone?.x ?? null,
      event.disputedStone?.y ?? null,
      event.resumedToMove,
      event.resumedAt,
    ],
  );
}

async function resumeExpiredScoring(
  client: PoolClient,
  loaded: LoadedGame,
  now: Date,
): Promise<LoadedGame | null> {
  if (
    loaded.game.status !== "active"
    || loaded.game.phase !== "scoring"
    || !loaded.scoring
    || !scoringDeadlineExpired(loaded.scoring.expires_at, now)
  ) {
    return null;
  }
  const scoring = loaded.scoring;
  await appendScoringResumeEvidence(
    client,
    { ...loaded, scoring },
    {
      claim: "deadline",
      requestedBy: null,
      disputedStone: null,
      resumedToMove: scoring.fallback_to_move,
      resumedAt: now,
    },
  );
  await client.query("DELETE FROM game_scoring_state WHERE game_id = $1", [loaded.game.id]);
  const updated = await client.query<GameRow>(
    `UPDATE games
        SET phase = 'play', to_move = $2, consecutive_passes = 0,
            scoring_revision = scoring_revision + 1,
            last_resume_claim = 'deadline', last_resume_by = NULL,
            last_resume_x = NULL, last_resume_y = NULL,
            turn_started_at = $3, updated_at = $3, version = version + 1
      WHERE id = $1
      RETURNING *`,
    [loaded.game.id, scoring.fallback_to_move, now],
  );
  return {
    ...withUpdatedGame(loaded, updated.rows[0]),
    scoring: null,
    deadRows: [],
  };
}

function stoppedBoard(loaded: LoadedGame, scoring: ScoringRow): Board {
  assertScoringBoardMatches(loaded, scoring, loaded.board);
  return loaded.board;
}

async function resolveGameState(
  client: PoolClient,
  gameId: string,
  playerKey: string,
): Promise<GameState> {
  const loaded = await loadGame(client, gameId, playerKey, true);
  const now = new Date();
  const resumed = await resumeExpiredScoring(client, loaded, now);
  if (resumed) return serializeGame(resumed, now);
  const turn = currentTurn(loaded.game, loaded.moveRows, loaded.rules.policy);
  if (turn) {
    const clocks = calculateClocks(loaded.game, turn, now);
    if (clocks[turn].timedOut) return finishOnTime(client, loaded, turn, now);
  }
  return serializeGame(loaded, now);
}

async function pollHeader(gameId: string): Promise<PollGameRow> {
  const result = await query<PollGameRow>(
    `SELECT g.id, g.black_player_key, g.white_player_key, g.winner_key,
            g.status, g.phase, g.to_move, g.scoring_revision, g.result,
            g.finish_reason, g.rules,
            g.rules_profile, g.scoring_method, g.komi, g.handicap,
            g.main_time_seconds, g.byo_yomi_periods, g.byo_yomi_seconds,
            g.black_time_remaining_ms, g.white_time_remaining_ms,
            g.black_periods_remaining, g.white_periods_remaining,
            g.turn_started_at, g.version, g.finished_at
       FROM games g
      WHERE g.id = $1`,
    [gameId],
  );
  const game = result.rows[0];
  if (!game) throw new GameServiceError("Game not found.", 404, "game_not_found");
  return game;
}

function heartbeat(game: PollGameRow, turn: Stone | null, now: Date): GamePollHeartbeat {
  return {
    unchanged: true,
    gameId: game.id,
    version: game.version,
    clock: serializeGameClock(game, turn, now),
  };
}

export async function pollGameState(
  gameId: string,
  playerKey: string,
  knownVersion: number | null,
): Promise<{ unchanged: false; game: GameState } | GamePollHeartbeat> {
  if (knownVersion === null) {
    return { unchanged: false, game: await getGameState(gameId, playerKey) };
  }

  const game = await pollHeader(gameId);
  assertParticipant(game, playerKey);
  if (game.version !== knownVersion) {
    return { unchanged: false, game: await getGameState(gameId, playerKey) };
  }

  const rules = storedRulesConfiguration(game);
  const now = new Date();

  if (
    game.status === "active"
    && game.phase === "play"
    && game.finish_reason === null
    && game.result === null
    && game.winner_key === null
    && game.finished_at === null
    && rules.policy.turnSource !== "move-log"
    && game.to_move !== null
  ) {
    const clocks = calculateClocks(game, game.to_move, now);
    if (!clocks[game.to_move].timedOut) return heartbeat(game, game.to_move, now);
  }

  if (
    game.status === "active"
    && game.phase === "scoring"
    && game.finish_reason === null
    && game.result === null
    && game.winner_key === null
    && game.finished_at === null
    && game.to_move === null
    && rules.policy.scoringLifecycle === "agreement"
  ) {
    const scoring = await query<PollScoringRow>(
      `SELECT scoring.revision, scoring.expires_at
         FROM game_scoring_state scoring
         JOIN games g ON g.id = scoring.game_id
        WHERE scoring.game_id = $1
          AND g.version = $2
          AND ($3 = g.black_player_key OR $3 = g.white_player_key)`,
      [gameId, knownVersion, playerKey],
    );
    const snapshot = scoring.rows[0];
    if (
      snapshot
      && snapshot.revision === game.scoring_revision
      && !scoringDeadlineExpired(snapshot.expires_at, now)
    ) {
      return heartbeat(game, null, now);
    }
  }

  return { unchanged: false, game: await getGameState(gameId, playerKey) };
}

export async function getGameState(gameId: string, playerKey: string): Promise<GameState> {
  return withTransaction((client) => resolveGameState(client, gameId, playerKey));
}

export async function submitMove(
  gameId: string,
  playerKey: string,
  move: { x?: number; y?: number; isPass?: boolean; expectedVersion: number },
): Promise<GameState> {
  return withTransaction(async (client) => {
    const loaded = await loadGame(client, gameId, playerKey, true);
    if (
      !Number.isSafeInteger(move.expectedVersion)
      || move.expectedVersion < 0
      || move.expectedVersion > MAX_PERSISTED_GAME_VERSION
    ) {
      throw new GameServiceError(
        "A valid expected game version is required.",
        400,
        "invalid_game_mutation_request",
      );
    }
    if (loaded.game.version !== move.expectedVersion) {
      throw new GameServiceError(
        "The game changed. Review the latest position before moving.",
        409,
        "game_version_conflict",
      );
    }
    const resumed = await resumeExpiredScoring(client, loaded, new Date());
    if (resumed) return serializeGame(resumed);
    const { game, moveRows, rules, positionHistory } = loaded;
    if (game.status !== "active") {
      throw new GameServiceError("This game is already finished.", 409, "game_finished");
    }
    const color = currentTurn(game, moveRows, rules.policy);
    if (game.phase !== "play" || !color) {
      throw new GameServiceError("Agree on the score or resume play first.", 409, "game_in_scoring");
    }
    const expectedPlayer = color === "black" ? game.black_player_key : game.white_player_key;
    if (playerKey !== expectedPlayer) {
      throw new GameServiceError("It is not your turn.", 409, "not_your_turn");
    }

    const now = new Date();
    const clocks = calculateClocks(game, color, now);
    const playerClock = clocks[color];
    if (playerClock.timedOut) return finishOnTime(client, loaded, color, now);

    const currentBoard = loaded.board;
    const isPass = move.isPass === true;
    let nextBoard = currentBoard;
    let nextHash = boardHash(currentBoard);
    if (!isPass) {
      if (!Number.isInteger(move.x) || !Number.isInteger(move.y)) {
        throw new GameServiceError("A move needs integer x and y coordinates.", 400, "invalid_move");
      }
      const result = applyMove(currentBoard, color, move.x!, move.y!);
      if (!result.ok) {
        throw new GameServiceError(`Illegal move: ${result.error}.`, 409, result.error);
      }
      nextBoard = result.board;
      nextHash = boardHash(result.board);
      const previousHashes = new Set(positionHistory);
      if (isRepeatedPositionForbidden(rules.policy, nextHash, previousHashes)) {
        throw new GameServiceError(
          "Illegal move: this position repeats an earlier board.",
          409,
          "ko",
        );
      }
    }

    const nextMoveNumber = moveRows.length + 1;
    const inserted = await client.query<MoveRow>(
      `INSERT INTO moves (game_id, move_number, color, x, y, is_pass, board_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING move_number, color, x, y, is_pass, board_hash, created_at`,
      [game.id, nextMoveNumber, color, isPass ? null : move.x, isPass ? null : move.y, isPass, nextHash],
    );
    moveRows.push(inserted.rows[0]);
    loaded.board = nextBoard;
    loaded.positionHistory = Object.freeze([...positionHistory, nextHash]);
    const previousPasses = effectiveConsecutivePasses(
      game,
      moveRows.slice(0, -1),
      rules.policy,
    );
    const consecutivePasses = isPass ? previousPasses + 1 : 0;

    if (consecutivePasses >= 2) {
      if (rules.policy.scoringLifecycle === "immediate") {
        const computation = scoreImmediatePosition(rules.policy, currentBoard, rules.komi);
        const score = requireChineseAreaBreakdown(computation);
        const winnerKey = winnerKeyForScoredOutcome(game, computation.outcome);
        const updated = await client.query<GameRow>(
          `UPDATE games
              SET status = 'finished', phase = 'play', to_move = NULL,
                  consecutive_passes = 2, finish_reason = 'legacy_score',
                  result = $2, winner_key = $3,
                  black_time_remaining_ms = $4, white_time_remaining_ms = $5,
                  black_periods_remaining = $6, white_periods_remaining = $7,
                  finished_at = $8, updated_at = $8, version = version + 1
            WHERE id = $1
            RETURNING *`,
          [
            game.id,
            score.result,
            winnerKey,
            color === "black" ? playerClock.mainTimeMs : Number(game.black_time_remaining_ms),
            color === "white" ? playerClock.mainTimeMs : Number(game.white_time_remaining_ms),
            color === "black" ? playerClock.periodsRemaining : game.black_periods_remaining,
            color === "white" ? playerClock.periodsRemaining : game.white_periods_remaining,
            now,
          ],
        );
        const legacyLoaded = withUpdatedGame(loaded, updated.rows[0]);
        const rated = await recordFinishedStats(client, legacyLoaded.game, winnerKey);
        return serializeGame({
          ...legacyLoaded,
          game: { ...legacyLoaded.game, rated },
        }, now);
      }
      const responseWindowMs = rules.policy.scoringResponseWindowMs;
      if (responseWindowMs === null) {
        throw new GameServiceError(
          "The rules profile does not support agreement scoring.",
          500,
          "rules_configuration_unsupported",
        );
      }
      const revision = game.scoring_revision + 1;
      await client.query(
        `INSERT INTO game_scoring_state (
           game_id, board_hash, stopped_move_number, revision, rules,
           rules_profile, scoring_method, komi, handicap,
           fallback_to_move, expires_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          game.id,
          nextHash,
          nextMoveNumber,
          revision,
          rules.ruleset,
          rules.rulesProfile,
          rules.scoringMethod,
          rules.komi,
          rules.handicap,
          opposite(color),
          new Date(now.getTime() + responseWindowMs),
        ],
      );
      const updated = await client.query<GameRow>(
        `UPDATE games
            SET phase = 'scoring', to_move = NULL, consecutive_passes = 2,
                scoring_revision = $2,
                black_time_remaining_ms = $3, white_time_remaining_ms = $4,
                black_periods_remaining = $5, white_periods_remaining = $6,
                updated_at = $7, version = version + 1
          WHERE id = $1
          RETURNING *`,
        [
          game.id,
          revision,
          color === "black" ? playerClock.mainTimeMs : Number(game.black_time_remaining_ms),
          color === "white" ? playerClock.mainTimeMs : Number(game.white_time_remaining_ms),
          color === "black" ? playerClock.periodsRemaining : game.black_periods_remaining,
          color === "white" ? playerClock.periodsRemaining : game.white_periods_remaining,
          now,
        ],
      );
      const scoring: ScoringRow = {
        game_id: game.id,
        board_hash: nextHash,
        stopped_move_number: nextMoveNumber,
        revision,
        rules: rules.ruleset,
        rules_profile: rules.rulesProfile,
        scoring_method: rules.scoringMethod,
        komi: rules.komi,
        handicap: rules.handicap,
        fallback_to_move: opposite(color),
        expires_at: new Date(now.getTime() + responseWindowMs),
        black_confirmed_revision: null,
        white_confirmed_revision: null,
        black_confirmed_at: null,
        white_confirmed_at: null,
        scored_board_hash: null,
        black_stones: null,
        white_stones: null,
        black_territory: null,
        white_territory: null,
        neutral_points: null,
        black_dead_stones: null,
        white_dead_stones: null,
        black_total: null,
        white_total: null,
        result: null,
        started_at: now,
        updated_at: now,
        finalized_at: null,
      };
      return serializeGame({ ...withUpdatedGame(loaded, updated.rows[0]), scoring }, now);
    }

    const updated = await client.query<GameRow>(
      `UPDATE games
          SET to_move = $2, consecutive_passes = $3,
              black_time_remaining_ms = $4, white_time_remaining_ms = $5,
              black_periods_remaining = $6, white_periods_remaining = $7,
              turn_started_at = $8, updated_at = $8, version = version + 1
        WHERE id = $1
        RETURNING *`,
      [
        game.id,
        opposite(color),
        consecutivePasses,
        color === "black" ? playerClock.mainTimeMs : Number(game.black_time_remaining_ms),
        color === "white" ? playerClock.mainTimeMs : Number(game.white_time_remaining_ms),
        color === "black" ? playerClock.periodsRemaining : game.black_periods_remaining,
        color === "white" ? playerClock.periodsRemaining : game.white_periods_remaining,
        now,
      ],
    );
    return serializeGame(withUpdatedGame(loaded, updated.rows[0]), now);
  });
}

export async function setDeadGroup(
  gameId: string,
  playerKey: string,
  proposal: { x: number; y: number; dead: boolean; expectedRevision: number },
): Promise<GameState> {
  return withTransaction(async (client) => {
    const loaded = await loadGame(client, gameId, playerKey, true);
    const resumed = await resumeExpiredScoring(client, loaded, new Date());
    if (resumed) return serializeGame(resumed);
    const scoring = assertScoringPhase(loaded, proposal.expectedRevision);
    if (typeof proposal.dead !== "boolean") {
      throw new GameServiceError("The dead-stone state is required.", 400, "invalid_dead_state");
    }
    const board = stoppedBoard(loaded, scoring);
    let toggled: ReturnType<typeof toggleDeadGroup>;
    try {
      toggled = toggleDeadGroup(
        board,
        loaded.deadRows.map(({ x, y }) => ({ x, y })),
        { x: proposal.x, y: proposal.y },
        proposal.dead,
      );
    } catch (error) {
      throw new GameServiceError(
        error instanceof Error ? error.message : "Invalid dead-stone proposal.",
        400,
        "invalid_dead_stone",
      );
    }
    if (!toggled.changed) return serializeGame(loaded);

    const revision = scoring.revision + 1;
    const now = new Date();
    await client.query("DELETE FROM game_dead_stones WHERE game_id = $1", [loaded.game.id]);
    if (toggled.deadStones.length > 0) {
      const xs = toggled.deadStones.map(({ x }) => x);
      const ys = toggled.deadStones.map(({ y }) => y);
      const colors = toggled.deadStones.map(({ x, y }) => board[y][x]);
      await client.query(
        `INSERT INTO game_dead_stones (game_id, x, y, color)
         SELECT $1, proposal.x, proposal.y, proposal.color
           FROM UNNEST($2::int[], $3::int[], $4::text[])
             AS proposal(x, y, color)`,
        [loaded.game.id, xs, ys, colors],
      );
    }
    const scoringResult = await client.query<ScoringRow>(
      `UPDATE game_scoring_state
          SET revision = $2,
              black_confirmed_revision = NULL, white_confirmed_revision = NULL,
              black_confirmed_at = NULL, white_confirmed_at = NULL,
              updated_at = $3
        WHERE game_id = $1
        RETURNING *`,
      [loaded.game.id, revision, now],
    );
    const gameResult = await client.query<GameRow>(
      `UPDATE games
          SET scoring_revision = $2, updated_at = $3, version = version + 1
        WHERE id = $1
        RETURNING *`,
      [loaded.game.id, revision, now],
    );
    const deadRows: DeadStoneRow[] = toggled.deadStones.map(({ x, y }) => ({
      x,
      y,
      color: board[y][x]!,
    }));
    return serializeGame({
      ...withUpdatedGame(loaded, gameResult.rows[0]),
      scoring: scoringResult.rows[0],
      deadRows,
    }, now);
  });
}

export async function confirmScore(
  gameId: string,
  playerKey: string,
  expectedRevision: number,
): Promise<GameState> {
  return withTransaction(async (client) => {
    const loaded = await loadGame(client, gameId, playerKey, true);
    const resumed = await resumeExpiredScoring(client, loaded, new Date());
    if (resumed) return serializeGame(resumed);
    const color = playerColor(loaded.game, playerKey);
    if (loaded.game.status === "finished") {
      if (
        loaded.game.finish_reason === "score"
        && loaded.scoring?.revision === expectedRevision
        && loaded.scoring[`${color}_confirmed_revision`] === expectedRevision
      ) {
        return serializeGame(loaded);
      }
      throw new GameServiceError("This game is already finished.", 409, "game_finished");
    }
    const scoring = assertScoringPhase(loaded, expectedRevision);
    const confirmationKey = `${color}_confirmed_revision` as const;
    if (scoring[confirmationKey] === expectedRevision) return serializeGame(loaded);

    const now = new Date();
    const revisionColumn = color === "black" ? "black_confirmed_revision" : "white_confirmed_revision";
    const timeColumn = color === "black" ? "black_confirmed_at" : "white_confirmed_at";
    const scoringResult = await client.query<ScoringRow>(
      `UPDATE game_scoring_state
          SET ${revisionColumn} = $2, ${timeColumn} = $3, updated_at = $3
        WHERE game_id = $1
        RETURNING *`,
      [loaded.game.id, expectedRevision, now],
    );
    const gameResult = await client.query<GameRow>(
      `UPDATE games SET updated_at = $2, version = version + 1 WHERE id = $1 RETURNING *`,
      [loaded.game.id, now],
    );
    const nextLoaded = {
      ...withUpdatedGame(loaded, gameResult.rows[0]),
      scoring: scoringResult.rows[0],
    };
    const bothConfirmed =
      nextLoaded.scoring.black_confirmed_revision === expectedRevision
      && nextLoaded.scoring.white_confirmed_revision === expectedRevision;
    if (!bothConfirmed) return serializeGame(nextLoaded, now);

    const board = stoppedBoard(nextLoaded, nextLoaded.scoring);
    const deadStones = nextLoaded.deadRows.map(({ x, y }) => ({ x, y }));
    const computation = scoreAgreementPosition(
      nextLoaded.rules.policy,
      board,
      deadStones,
      nextLoaded.rules.komi,
    );
    const score = requireChineseAreaBreakdown(computation);
    const winnerKey = winnerKeyForScoredOutcome(loaded.game, computation.outcome);
    const deadCounts = nextLoaded.deadRows.reduce(
      (counts, stone) => ({ ...counts, [stone.color]: counts[stone.color] + 1 }),
      { black: 0, white: 0 },
    );
    const scoredBoard = board.map((row) => [...row]);
    for (const { x, y } of deadStones) scoredBoard[y][x] = null;
    const finalScoring = await client.query<ScoringRow>(
      `UPDATE game_scoring_state
          SET scored_board_hash = $2,
              black_stones = $3, white_stones = $4,
              black_territory = $5, white_territory = $6,
              neutral_points = $7, black_dead_stones = $8, white_dead_stones = $9,
              black_total = $10, white_total = $11, result = $12,
              finalized_at = $13, updated_at = $13
        WHERE game_id = $1
        RETURNING *`,
      [
        loaded.game.id,
        boardHash(scoredBoard),
        score.blackStones,
        score.whiteStones,
        score.blackTerritory,
        score.whiteTerritory,
        score.neutralPoints,
        deadCounts.black,
        deadCounts.white,
        score.black,
        score.white,
        score.result,
        now,
      ],
    );
    const finished = await client.query<GameRow>(
      `UPDATE games
          SET status = 'finished', phase = 'scoring', to_move = NULL,
              finish_reason = 'score', result = $2, winner_key = $3,
              finished_at = $4, updated_at = $4, version = version + 1
        WHERE id = $1
        RETURNING *`,
      [loaded.game.id, score.result, winnerKey, now],
    );
    const finalLoaded = {
      ...withUpdatedGame(nextLoaded, finished.rows[0]),
      scoring: finalScoring.rows[0],
    };
    const rated = await recordFinishedStats(client, finalLoaded.game, winnerKey);
    return serializeGame({
      ...finalLoaded,
      game: { ...finalLoaded.game, rated },
    }, now);
  });
}

export async function resumePlay(
  gameId: string,
  playerKey: string,
  expectedRevision: number,
  claim: "dead" | "alive",
  disputedStone: Position,
): Promise<GameState> {
  return withTransaction(async (client) => {
    const loaded = await loadGame(client, gameId, playerKey, true);
    const decisionAt = new Date();
    const expired = await resumeExpiredScoring(client, loaded, decisionAt);
    if (expired) return serializeGame(expired);
    const scoring = assertScoringPhase(loaded, expectedRevision);
    if (claim !== "dead" && claim !== "alive") {
      throw new GameServiceError("A valid dispute claim is required.", 400, "invalid_dispute_claim");
    }
    if (!Number.isInteger(disputedStone.x) || !Number.isInteger(disputedStone.y)) {
      throw new GameServiceError(
        "A disputed stone coordinate is required.",
        400,
        "invalid_disputed_stone",
      );
    }
    const board = stoppedBoard(loaded, scoring);
    const disputedGroup = getGroup(board, disputedStone);
    const deadKeys = new Set(loaded.deadRows.map(({ x, y }) => `${x}:${y}`));
    if (
      disputedGroup.length === 0
      || !disputedGroup.every(({ x, y }) => deadKeys.has(`${x}:${y}`))
    ) {
      throw new GameServiceError(
        "Resume play must identify a currently marked dead group.",
        409,
        "disputed_group_not_marked_dead",
      );
    }
    const requestedBy = playerColor(loaded.game, playerKey);
    const resumedToMove = resumeTurnForPolicy(loaded.rules.policy, requestedBy, claim);
    await appendScoringResumeEvidence(
      client,
      { ...loaded, scoring },
      {
        claim,
        requestedBy,
        disputedStone,
        resumedToMove,
        resumedAt: decisionAt,
      },
    );
    await client.query("DELETE FROM game_scoring_state WHERE game_id = $1", [loaded.game.id]);
    const updated = await client.query<GameRow>(
      `UPDATE games
          SET phase = 'play', to_move = $2, consecutive_passes = 0,
              scoring_revision = scoring_revision + 1,
              last_resume_claim = $3, last_resume_by = $4,
              last_resume_x = $5, last_resume_y = $6,
              turn_started_at = $7, updated_at = $7, version = version + 1
        WHERE id = $1
        RETURNING *`,
      [
        loaded.game.id,
        resumedToMove,
        claim,
        requestedBy,
        disputedStone.x,
        disputedStone.y,
        decisionAt,
      ],
    );
    return serializeGame({
      ...withUpdatedGame(loaded, updated.rows[0]),
      scoring: null,
      deadRows: [],
    }, decisionAt);
  });
}

export async function resignGame(gameId: string, playerKey: string): Promise<GameState> {
  return withTransaction(async (client) => {
    let loaded = await loadGame(client, gameId, playerKey, true);
    loaded = await resumeExpiredScoring(client, loaded, new Date()) ?? loaded;
    const { game } = loaded;
    if (game.status !== "active") {
      throw new GameServiceError("This game is already finished.", 409, "game_finished");
    }

    const now = new Date();
    const turn = currentTurn(game, loaded.moveRows, loaded.rules.policy);
    if (turn) {
      const clocks = calculateClocks(game, turn, now);
      if (clocks[turn].timedOut) return finishOnTime(client, loaded, turn, now);
    }

    const winnerKey = playerKey === game.black_player_key
      ? game.white_player_key
      : game.black_player_key;
    const winnerColor = winnerKey === game.black_player_key ? "B" : "W";
    if (loaded.scoring) {
      await client.query("DELETE FROM game_scoring_state WHERE game_id = $1", [game.id]);
    }
    const updated = await client.query<GameRow>(
      `UPDATE games
          SET status = 'finished', phase = 'play', to_move = NULL,
              finish_reason = 'resignation',
              result = $2, winner_key = $3,
              finished_at = $4, updated_at = $4, version = version + 1
        WHERE id = $1
        RETURNING *`,
      [game.id, `${winnerColor}+R`, winnerKey, now],
    );
    const nextLoaded = {
      ...withUpdatedGame(loaded, updated.rows[0]),
      scoring: null,
      deadRows: [],
    };
    const rated = await recordFinishedStats(client, nextLoaded.game, winnerKey);
    return serializeGame({
      ...nextLoaded,
      game: { ...nextLoaded.game, rated },
    }, now);
  });
}
