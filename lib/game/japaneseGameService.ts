import type { PoolClient, QueryResultRow } from "pg";
import { query, withReadOnlyTransaction, withTransaction } from "@/lib/db";
import { boardHash, type PrisonerLedger } from "./goEngine";
import { advanceClock, restingClock } from "./goClock";
import { GameServiceError } from "./gameServiceError";
import { MAX_PERSISTED_GAME_VERSION } from "./gamePolling";
import { toJapaneseTerritoryPreview } from "./japaneseGameScoring";
import {
  replayJapanesePhaseAuthority,
  type JapanesePhaseAuthorityResult,
} from "./japanesePhaseAuthority";
import { applyJapaneseSimpleKoMove } from "./japaneseKo";
import { currentJapaneseWholeBoardRepetition } from "./japaneseRepetition";
import {
  JAPANESE_1989_CONTRACT_ID,
  JAPANESE_1989_RULES_PROFILE,
} from "./japanesePolicyContract";
import { scoreJapaneseTerritory, type JapaneseTerritoryScore } from "./japaneseScoring";
import {
  decideJapaneseScoringDeadline,
  isJapaneseFinalResolutionPhase,
  japaneseScoringDecisionWindowSeconds,
  japaneseScoringResumptionsRemaining,
} from "./japaneseScoringLifecycle";
import {
  hashJapaneseSettlementProposalV1,
  type JapaneseSettlementDeadStone,
} from "./japaneseSettlementProposal";
import { sortPositions, toggleDeadGroup } from "./scoring";
import type {
  Board,
  BoardSize,
  GamePollHeartbeat,
  GameState,
  Position,
  Stone,
  StoredMove,
  TimeControlId,
} from "./types";
import {
  canonicalizeKataGoScoringRequest,
  configuredKataGoScoringRuntime,
  KataGoScoringError,
  type KataGoErrorCode,
  type KataGoProviderKind,
  type KataGoScoringProposal,
  type KataGoScoringRuntime,
} from "@/lib/katago";
import { finalizeGameRatings } from "@/lib/rating/ratingFinalizer";

type JapaneseGameRow = {
  id: string;
  board_size: BoardSize;
  black_player_key: string;
  white_player_key: string;
  black_player_name: string;
  white_player_name: string;
  black_player_is_bot: boolean;
  white_player_is_bot: boolean;
  black_rating: string | number | null;
  black_rating_deviation: string | number | null;
  white_rating: string | number | null;
  white_rating_deviation: string | number | null;
  viewer_rating_change: string | number | null;
  rating_display_preference: "rank-primary" | "rating-primary" | "both" | null;
  winner_key: string | null;
  rated: boolean;
  status: "active" | "finished";
  phase: "play" | "scoring";
  to_move: Stone | null;
  consecutive_passes: number;
  scoring_revision: number;
  result: string | null;
  finish_reason:
    | "score"
    | "japanese_adjudication"
    | "japanese_abandonment"
    | "japanese_no_result"
    | "resignation"
    | "timeout"
    | null;
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

type JapaneseMoveRow = {
  move_number: number;
  color: Stone;
  x: number | null;
  y: number | null;
  is_pass: boolean;
  board_hash: string;
  created_at: Date;
};

type JapaneseResumeRow = {
  resumption_number: number;
  scoring_revision: number;
  stopped_move_number: number;
  stopped_board_hash: string;
  requested_by_color: Stone;
  authorized_at: Date;
};

type SuggestionStatus = "pending" | "ready" | "unavailable" | "invalid" | "low_confidence";

type JapaneseScoringRow = {
  game_id: string;
  board_hash: string;
  stopped_move_number: number;
  revision: number;
  proposal_hash: string;
  rules: "japanese";
  rules_profile: typeof JAPANESE_1989_RULES_PROFILE;
  scoring_method: "territory";
  komi: string | number;
  handicap: 0;
  captured_white_by_black_at_stop: number;
  captured_black_by_white_at_stop: number;
  expires_at: Date;
  black_participated_at: Date | null;
  white_participated_at: Date | null;
  suggestion_status: SuggestionStatus;
  suggestion_request_identity: string | null;
  suggestion_provider_kind: "hosted-http" | "local-http" | "deterministic" | null;
  suggestion_engine_version: string | null;
  suggestion_model_version: string | null;
  suggestion_config_version: string | null;
  suggestion_confidence_policy_version: string | null;
  suggestion_latency_ms: number | null;
  suggestion_error_class: KataGoErrorCode | null;
  black_confirmed_revision: number | null;
  white_confirmed_revision: number | null;
  black_confirmed_proposal_hash: string | null;
  white_confirmed_proposal_hash: string | null;
  black_confirmed_at: Date | null;
  white_confirmed_at: Date | null;
  scored_board_hash: string | null;
  scored_proposal_hash: string | null;
  living_black_stones: number | null;
  living_white_stones: number | null;
  black_territory: number | null;
  white_territory: number | null;
  dame_points: number | null;
  territory_excluded_by_agreement: number | null;
  dead_black_stones: number | null;
  dead_white_stones: number | null;
  black_prisoners_final: number | null;
  white_prisoners_final: number | null;
  black_total: string | number | null;
  white_total: string | number | null;
  outcome_kind: "points" | "jigo" | null;
  winner: Stone | null;
  margin: string | number | null;
  started_at: Date;
  updated_at: Date;
  finalized_at: Date | null;
};

type JapaneseDeadRow = Position & { color: Stone };
type JapaneseNeutralRow = Position;

type JapaneseProposalRow = {
  scoring_revision: number;
  parent_scoring_revision: number | null;
  source: "katago_initial" | "player_edit" | "undo" | "reset";
  actor_color: Stone | null;
  proposal_hash: string;
  dead_stones: unknown;
  neutral_region_seeds: unknown;
  created_at: Date;
};

type JapaneseRepetitionClaimRow = {
  move_number: number;
  claimant_color: Stone;
  repeated_from_move_number: number;
  board_hash: string;
  claimed_at: Date;
};

type LoadedJapaneseGame = {
  game: JapaneseGameRow;
  moves: JapaneseMoveRow[];
  resumes: JapaneseResumeRow[];
  authority: JapanesePhaseAuthorityResult;
  scoring: JapaneseScoringRow | null;
  deadRows: JapaneseDeadRow[];
  neutralRows: JapaneseNeutralRow[];
  currentProposal: JapaneseProposalRow | null;
  repetitionClaims: JapaneseRepetitionClaimRow[];
};

type AnalysisBoundary = Readonly<{
  gameId: string;
  scoringRevision: number;
  stoppedMoveNumber: number;
  stoppedBoardHash: string;
  boardSize: BoardSize;
  board: Board;
  moves: JapaneseMoveRow[];
  playerToMove: Stone;
}>;

type SubmitResult = Readonly<{ game: GameState; boundary: AnalysisBoundary | null }>;

function opposite(color: Stone): Stone {
  return color === "black" ? "white" : "black";
}

function numeric(value: string | number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw corruption("invalid numeric evidence");
  return parsed;
}

function corruption(detail: string): GameServiceError {
  return new GameServiceError(
    `The stored Japanese game could not be verified (${detail}).`,
    500,
    "japanese_game_evidence_mismatch",
  );
}

function assertParticipant(game: JapaneseGameRow, playerKey: string): void {
  if (playerKey !== game.black_player_key && playerKey !== game.white_player_key) {
    throw new GameServiceError("You are not a participant in this game.", 403, "not_participant");
  }
}

function playerColor(game: JapaneseGameRow, playerKey: string): Stone {
  return playerKey === game.black_player_key ? "black" : "white";
}

function proposalDeadStones(rows: JapaneseDeadRow[]): JapaneseSettlementDeadStone[] {
  return sortPositions(rows).map(({ x, y }) => {
    const row = rows.find((candidate) => candidate.x === x && candidate.y === y);
    if (!row) throw corruption("missing dead-stone color");
    return { x, y, color: row.color };
  });
}

function proposalHash(
  loaded: Pick<LoadedJapaneseGame, "game" | "authority">,
  revision: number,
  stoppedMoveNumber: number,
  stoppedBoardHash: string,
  prisoners: PrisonerLedger,
  deadRows: JapaneseDeadRow[],
  neutralRows: JapaneseNeutralRow[],
): string {
  return hashJapaneseSettlementProposalV1({
    gameId: loaded.game.id,
    stoppedBoardHash,
    stoppedMoveNumber,
    revision,
    rulesIdentity: {
      rules: "japanese",
      rulesProfile: JAPANESE_1989_RULES_PROFILE,
      scoringMethod: "territory",
      komi: 6.5,
      handicap: 0,
    },
    prisoners,
    deadStones: proposalDeadStones(deadRows),
    neutralRegionSeeds: sortPositions(neutralRows),
  });
}

function parseProposalPositions(value: unknown, name: string): Position[] {
  if (!Array.isArray(value)) throw corruption(`${name} is not an array`);
  const positions = value.map((entry) => {
    if (
      typeof entry !== "object" || entry === null || Array.isArray(entry)
      || !Number.isInteger((entry as Position).x) || !Number.isInteger((entry as Position).y)
    ) throw corruption(`${name} contains an invalid coordinate`);
    return { x: (entry as Position).x, y: (entry as Position).y };
  });
  return sortPositions(positions);
}

function mapMoves(rows: JapaneseMoveRow[]): StoredMove[] {
  return rows.map((move) => ({
    moveNumber: move.move_number,
    color: move.color,
    x: move.x,
    y: move.y,
    isPass: move.is_pass,
    createdAt: move.created_at.toISOString(),
  }));
}

function replay(game: JapaneseGameRow, moves: JapaneseMoveRow[], resumes: JapaneseResumeRow[]) {
  try {
    return replayJapanesePhaseAuthority(
      game.board_size,
      moves.map((move) => ({
        moveNumber: move.move_number,
        color: move.color,
        x: move.x,
        y: move.y,
        isPass: move.is_pass,
        createdAt: move.created_at.toISOString(),
        boardHash: move.board_hash,
      })),
      resumes.map((resume) => ({
        stoppedMoveNumber: resume.stopped_move_number,
        stoppedBoardHash: resume.stopped_board_hash,
        requestedBy: resume.requested_by_color,
      })),
    );
  } catch {
    throw corruption("move/resume replay failed");
  }
}

async function loadJapaneseGame(
  client: PoolClient | null,
  gameId: string,
  playerKey: string,
  lock = false,
): Promise<LoadedJapaneseGame> {
  const execute = <T extends QueryResultRow>(text: string, values: readonly unknown[]) =>
    client ? client.query<T>(text, [...values]) : query<T>(text, values);
  const gameResult = await execute<JapaneseGameRow>(
    `SELECT g.*, COALESCE(
              CASE WHEN g.black_player_key = game_bot.bot_player_key THEN game_bot.display_name END,
              NULLIF(BTRIM(black_user.display_name), ''), black_user.username,
              'Guest ' || UPPER(RIGHT(g.black_player_key, 6))) AS black_player_name,
            COALESCE(
              CASE WHEN g.white_player_key = game_bot.bot_player_key THEN game_bot.display_name END,
              NULLIF(BTRIM(white_user.display_name), ''), white_user.username,
              'Guest ' || UPPER(RIGHT(g.white_player_key, 6))) AS white_player_name,
            g.black_player_key = game_bot.bot_player_key AS black_player_is_bot,
            g.white_player_key = game_bot.bot_player_key AS white_player_is_bot,
            CASE WHEN g.black_player_key = game_bot.bot_player_key
              THEN calibrated_binding.opponent_rating ELSE black_rating.rating END AS black_rating,
            CASE WHEN g.black_player_key = game_bot.bot_player_key
              THEN calibrated_binding.opponent_rating_deviation
              ELSE black_rating.rating_deviation END AS black_rating_deviation,
            CASE WHEN g.white_player_key = game_bot.bot_player_key
              THEN calibrated_binding.opponent_rating ELSE white_rating.rating END AS white_rating,
            CASE WHEN g.white_player_key = game_bot.bot_player_key
              THEN calibrated_binding.opponent_rating_deviation
              ELSE white_rating.rating_deviation END AS white_rating_deviation,
            (viewer_event.rating_after - viewer_event.rating_before) AS viewer_rating_change,
            viewer_preference.display_preference AS rating_display_preference,
            CASE WHEN g.status = 'finished' THEN (
              SELECT COALESCE(
                (COUNT(*) = 2 AND BOOL_AND(event.opponent_kind = 'registered_human'))
                OR (COUNT(*) = 1 AND BOOL_AND(event.opponent_kind = 'calibrated_bot')),
                FALSE
              ) FROM game_glicko2_rating_events event WHERE event.game_id = g.id
            ) ELSE (black_user.id IS NOT NULL AND white_user.id IS NOT NULL)
              OR (game_bot.rating_mode = 'calibrated-v1'
                  AND EXISTS (SELECT 1 FROM game_calibrated_bot_bindings binding
                               WHERE binding.game_id = g.id)) END AS rated
       FROM games g
       LEFT JOIN users black_user ON g.black_player_key = 'user:' || black_user.id::text
       LEFT JOIN users white_user ON g.white_player_key = 'user:' || white_user.id::text
       LEFT JOIN game_bots game_bot ON game_bot.game_id = g.id
       LEFT JOIN game_calibrated_bot_bindings calibrated_binding ON calibrated_binding.game_id = g.id
       LEFT JOIN player_glicko2_ratings black_rating ON black_rating.player_key = g.black_player_key
       LEFT JOIN player_glicko2_ratings white_rating ON white_rating.player_key = g.white_player_key
       LEFT JOIN game_glicko2_rating_events viewer_event
         ON viewer_event.game_id = g.id AND viewer_event.player_key = $2
       LEFT JOIN player_rating_preferences viewer_preference
         ON viewer_preference.player_key = $2
      WHERE g.id = $1${lock ? " FOR UPDATE OF g" : ""}`,
    [gameId, playerKey],
  );
  const game = gameResult.rows[0];
  if (!game) throw new GameServiceError("Game not found.", 404, "game_not_found");
  assertParticipant(game, playerKey);
  if (
    game.rules !== "japanese" || game.rules_profile !== JAPANESE_1989_RULES_PROFILE
    || game.scoring_method !== "territory" || numeric(game.komi) !== 6.5 || game.handicap !== 0
  ) throw corruption("rules tuple mismatch");

  const moves = (await execute<JapaneseMoveRow>(
    `SELECT move_number, color, x, y, is_pass, board_hash, created_at
       FROM moves WHERE game_id = $1 ORDER BY move_number`,
    [gameId],
  )).rows;
  const resumes = (await execute<JapaneseResumeRow>(
    `SELECT resumption_number, scoring_revision, stopped_move_number,
            stopped_board_hash, requested_by_color, authorized_at
       FROM game_japanese_resume_authorizations
      WHERE game_id = $1 ORDER BY resumption_number`,
    [gameId],
  )).rows;
  const authority = replay(game, moves, resumes);
  const repetitionEvidence = currentJapaneseWholeBoardRepetition(moves.map((move) => ({
    moveNumber: move.move_number,
    color: move.color,
    isPass: move.is_pass,
    boardHash: move.board_hash,
  })));
  const repetitionClaims = !repetitionEvidence ? [] : (await execute<JapaneseRepetitionClaimRow>(
    `SELECT move_number, claimant_color, repeated_from_move_number, board_hash, claimed_at
       FROM game_japanese_repetition_claims
      WHERE game_id = $1 AND move_number = $2
      ORDER BY claimant_color`,
    [gameId, repetitionEvidence.moveNumber],
  )).rows;
  const scoring = (await execute<JapaneseScoringRow>(
    `SELECT * FROM game_japanese_scoring_state
      WHERE game_id = $1${lock ? " FOR UPDATE" : ""}`,
    [gameId],
  )).rows[0] ?? null;
  let deadRows: JapaneseDeadRow[] = [];
  let neutralRows: JapaneseNeutralRow[] = [];
  let currentProposal: JapaneseProposalRow | null = null;
  if (scoring) {
    deadRows = (await execute<JapaneseDeadRow>(
      `SELECT x, y, color FROM game_japanese_dead_stones
        WHERE game_id = $1 ORDER BY y, x`, [gameId],
    )).rows;
    neutralRows = (await execute<JapaneseNeutralRow>(
      `SELECT x, y FROM game_japanese_neutral_region_seeds
        WHERE game_id = $1 ORDER BY y, x`, [gameId],
    )).rows;
    currentProposal = (await execute<JapaneseProposalRow>(
      `SELECT scoring_revision, parent_scoring_revision, source, actor_color,
              proposal_hash, dead_stones, neutral_region_seeds, created_at
         FROM game_japanese_scoring_proposals
        WHERE game_id = $1 AND scoring_revision = $2`,
      [gameId, scoring.revision],
    )).rows[0] ?? null;
    if (
      authority.state.phase !== "stopped"
      || authority.state.stoppedAt.moveNumber !== scoring.stopped_move_number
      || authority.state.stoppedAt.boardHash !== scoring.board_hash
      || scoring.revision !== game.scoring_revision
      || scoring.rules !== "japanese"
      || scoring.rules_profile !== JAPANESE_1989_RULES_PROFILE
      || scoring.scoring_method !== "territory"
      || numeric(scoring.komi) !== 6.5
      || scoring.handicap !== 0
      || (currentProposal !== null && currentProposal.proposal_hash !== scoring.proposal_hash)
      || (scoring.suggestion_status === "ready" && currentProposal === null)
      || proposalHash(
        { game, authority }, scoring.revision, scoring.stopped_move_number,
        scoring.board_hash, authority.normalPlay.prisoners, deadRows, neutralRows,
      ) !== scoring.proposal_hash
    ) throw corruption("scoring proposal mismatch");
  }
  if (game.status === "active") {
    if (
      (game.phase === "play" && (authority.state.phase !== "play" || scoring !== null))
      || (game.phase === "scoring" && (authority.state.phase !== "stopped" || scoring === null))
      || game.to_move !== (game.phase === "play" ? authority.state.toMove : null)
      || game.consecutive_passes !== authority.state.consecutivePasses
    ) throw corruption("phase cache mismatch");
  }
  const loaded = {
    game, moves, resumes, authority, scoring, deadRows, neutralRows,
    currentProposal, repetitionClaims,
  };
  validateJapaneseLifecycle(loaded);
  return loaded;
}

function scoreCurrent(loaded: LoadedJapaneseGame): JapaneseTerritoryScore | null {
  if (!loaded.scoring) return null;
  try {
    return scoreJapaneseTerritory({
      board: loaded.authority.normalPlay.board.map((row) => [...row]),
      prisoners: loaded.authority.normalPlay.prisoners,
      deadStones: loaded.deadRows.map(({ x, y }) => ({ x, y })),
      agreedNeutralRegionSeeds: loaded.neutralRows,
      komi: 6.5,
    });
  } catch {
    throw corruption("proposal is not a valid Japanese settlement");
  }
}

function validateJapaneseLifecycle(loaded: LoadedJapaneseGame): void {
  const { game, scoring } = loaded;
  if (!scoring) {
    if (game.status === "active" && game.phase === "scoring") throw corruption("active scoring state missing");
    if (game.status === "finished" && game.finish_reason === "score") throw corruption("agreed score state missing");
    return;
  }
  const blackConfirmed = scoring.black_confirmed_revision === scoring.revision
    && scoring.black_confirmed_proposal_hash === scoring.proposal_hash;
  const whiteConfirmed = scoring.white_confirmed_revision === scoring.revision
    && scoring.white_confirmed_proposal_hash === scoring.proposal_hash;
  const finalValues = [
    scoring.scored_board_hash, scoring.scored_proposal_hash,
    scoring.living_black_stones, scoring.living_white_stones,
    scoring.black_territory, scoring.white_territory, scoring.dame_points,
    scoring.territory_excluded_by_agreement, scoring.dead_black_stones,
    scoring.dead_white_stones, scoring.black_prisoners_final,
    scoring.white_prisoners_final, scoring.black_total, scoring.white_total,
    scoring.outcome_kind, scoring.margin, scoring.finalized_at,
  ];
  if (game.status === "active") {
    if (game.phase !== "scoring" || (blackConfirmed && whiteConfirmed) || finalValues.some((value) => value !== null)) {
      throw corruption("active scoring lifecycle mismatch");
    }
    return;
  }
  if (game.finish_reason !== "score" || game.phase !== "scoring" || !blackConfirmed || !whiteConfirmed) {
    throw corruption("terminal scoring lifecycle mismatch");
  }
  if (finalValues.some((value) => value === null)) throw corruption("final score evidence incomplete");
  const score = scoreCurrent(loaded)!;
  const preview = toJapaneseTerritoryPreview(score);
  const scoredBoard = loaded.authority.normalPlay.board.map((row) => [...row]);
  for (const { x, y } of loaded.deadRows) scoredBoard[y][x] = null;
  const finalDeadBlack = loaded.deadRows.filter(({ color }) => color === "black").length;
  const finalDeadWhite = loaded.deadRows.length - finalDeadBlack;
  const expectedWinnerKey = preview.winner === "black" ? game.black_player_key
    : preview.winner === "white" ? game.white_player_key : null;
  if (
    scoring.scored_proposal_hash !== scoring.proposal_hash
    || scoring.scored_board_hash !== boardHash(scoredBoard)
    || scoring.living_black_stones !== score.livingBlackStones
    || scoring.living_white_stones !== score.livingWhiteStones
    || numeric(scoring.black_total!) !== score.blackTotal
    || numeric(scoring.white_total!) !== score.whiteTotal
    || scoring.black_territory !== score.blackTerritory
    || scoring.white_territory !== score.whiteTerritory
    || scoring.dame_points !== score.damePoints
    || scoring.territory_excluded_by_agreement !== score.territoryExcludedByAgreement
    || scoring.dead_black_stones !== finalDeadBlack
    || scoring.dead_white_stones !== finalDeadWhite
    || scoring.black_prisoners_final !== score.blackPrisonersFinal
    || scoring.white_prisoners_final !== score.whitePrisonersFinal
    || scoring.outcome_kind !== score.outcome.kind
    || numeric(scoring.margin!) !== preview.margin
    || scoring.winner !== preview.winner
    || game.result !== preview.result
    || game.winner_key !== expectedWinnerKey
  ) throw corruption("final score evidence mismatch");
}

function gameClock(loaded: LoadedJapaneseGame, now: Date): GameState["clock"] {
  const { game } = loaded;
  const turn = game.status === "active" && game.phase === "play" ? game.to_move : null;
  const periodTimeMs = game.byo_yomi_seconds * 1_000;
  const elapsedMs = Math.max(0, now.getTime() - game.turn_started_at.getTime());
  const clockFor = (color: Stone) => turn === color
    ? advanceClock({
        mainTimeMs: numeric(game[`${color}_time_remaining_ms`]),
        periodsRemaining: game[`${color}_periods_remaining`],
        periodTimeMs,
        elapsedMs,
      })
    : restingClock(
        numeric(game[`${color}_time_remaining_ms`]),
        game[`${color}_periods_remaining`],
        periodTimeMs,
      );
  const black = clockFor("black");
  const white = clockFor("white");
  return {
    serverNow: now.toISOString(),
    mainTimeSeconds: game.main_time_seconds,
    byoYomiPeriods: game.byo_yomi_periods,
    byoYomiSeconds: game.byo_yomi_seconds,
    black: {
      mainTimeMs: black.mainTimeMs, periodsRemaining: black.periodsRemaining,
      displayTimeMs: black.displayTimeMs, phase: black.phase,
    },
    white: {
      mainTimeMs: white.mainTimeMs, periodsRemaining: white.periodsRemaining,
      displayTimeMs: white.displayTimeMs, phase: white.phase,
    },
  };
}

function serializeJapaneseGame(loaded: LoadedJapaneseGame, now = new Date()): GameState {
  const { game, moves, scoring, resumes } = loaded;
  const score = scoreCurrent(loaded);
  const latestResume = resumes.at(-1);
  const resumptionsRemaining = japaneseScoringResumptionsRemaining(resumes.length);
  const repetitionEvidence = currentJapaneseWholeBoardRepetition(moves.map((move) => ({
    moveNumber: move.move_number,
    color: move.color,
    isPass: move.is_pass,
    boardHash: move.board_hash,
  })));
  return {
    id: game.id,
    boardSize: game.board_size,
    blackPlayerKey: game.black_player_key,
    whitePlayerKey: game.white_player_key,
    blackPlayerName: game.black_player_name,
    whitePlayerName: game.white_player_name,
    blackPlayerIsBot: game.black_player_is_bot,
    whitePlayerIsBot: game.white_player_is_bot,
    blackRating: game.black_rating === null ? null : Number(game.black_rating),
    blackRatingDeviation: game.black_rating_deviation === null ? null : Number(game.black_rating_deviation),
    whiteRating: game.white_rating === null ? null : Number(game.white_rating),
    whiteRatingDeviation: game.white_rating_deviation === null ? null : Number(game.white_rating_deviation),
    viewerRatingChange: game.viewer_rating_change === null ? null : Number(game.viewer_rating_change),
    ratingDisplayPreference: game.rating_display_preference ?? "both",
    winnerKey: game.winner_key,
    rated: game.rated,
    status: game.status,
    phase: game.phase,
    result: game.result,
    finishReason: game.finish_reason,
    komi: 6.5,
    ruleset: "japanese",
    rulesProfile: JAPANESE_1989_RULES_PROFILE,
    scoringMethod: "territory",
    handicap: 0,
    consecutivePasses: loaded.authority.state.consecutivePasses,
    scoringRevision: game.scoring_revision,
    scoring: scoring && score ? {
      revision: scoring.revision,
      boardHash: scoring.board_hash,
      stoppedMoveNumber: scoring.stopped_move_number,
      deadStones: loaded.deadRows.map(({ x, y }) => ({ x, y })),
      neutralRegionSeeds: loaded.neutralRows,
      blackConfirmed: scoring.black_confirmed_revision === scoring.revision
        && scoring.black_confirmed_proposal_hash === scoring.proposal_hash,
      whiteConfirmed: scoring.white_confirmed_revision === scoring.revision
        && scoring.white_confirmed_proposal_hash === scoring.proposal_hash,
      preview: toJapaneseTerritoryPreview(score),
      finalizedAt: scoring.finalized_at?.toISOString() ?? null,
      expiresAt: scoring.expires_at.toISOString(),
      proposalHash: scoring.proposal_hash,
      resumptionsUsed: resumes.length,
      resumptionsRemaining,
      finalResolution: isJapaneseFinalResolutionPhase(resumes.length),
      blackParticipated: scoring.black_participated_at !== null,
      whiteParticipated: scoring.white_participated_at !== null,
      canUndo: loaded.currentProposal !== null
        && loaded.currentProposal.parent_scoring_revision !== null,
      canResetToSuggestion: loaded.currentProposal !== null
        && scoring.suggestion_status === "ready"
        && loaded.currentProposal.source !== "katago_initial",
      suggestion: {
        status: scoring.suggestion_status,
        transparentRole: "suggestion",
        providerKind: scoring.suggestion_provider_kind,
        engineVersion: scoring.suggestion_engine_version,
        modelVersion: scoring.suggestion_model_version,
        configVersion: scoring.suggestion_config_version,
        confidencePolicyVersion: scoring.suggestion_confidence_policy_version,
      },
    } : null,
    lastResume: latestResume ? {
      claim: "resume",
      requestedBy: latestResume.requested_by_color,
      disputedStone: null,
    } : null,
    repetition: repetitionEvidence ? {
      eligible: game.status === "active" && game.phase === "play",
      repeatedFromMoveNumber: repetitionEvidence.repeatedFromMoveNumber,
      blackClaimed: loaded.repetitionClaims.some((claim) => claim.claimant_color === "black"),
      whiteClaimed: loaded.repetitionClaims.some((claim) => claim.claimant_color === "white"),
    } : null,
    version: game.version,
    startedAt: game.started_at.toISOString(),
    finishedAt: game.finished_at?.toISOString() ?? null,
    timeControl: game.time_control,
    clock: gameClock(loaded, now),
    turn: game.status === "active" && game.phase === "play" ? game.to_move : null,
    moveCount: loaded.moves.length,
    board: loaded.authority.normalPlay.board.map((row) => [...row]),
    moves: mapMoves(loaded.moves),
  };
}

function assertExpectedVersion(game: JapaneseGameRow, expectedVersion: number): void {
  if (
    !Number.isSafeInteger(expectedVersion) || expectedVersion < 0
    || expectedVersion > MAX_PERSISTED_GAME_VERSION
  ) throw new GameServiceError("A valid expected game version is required.", 400, "invalid_game_mutation_request");
  if (game.version !== expectedVersion) {
    throw new GameServiceError("The game changed. Review the latest position.", 409, "game_version_conflict");
  }
}

function assertScoring(
  loaded: LoadedJapaneseGame,
  expectedRevision: number,
  options: Readonly<{ allowExpired?: boolean; allowPending?: boolean }> = {},
): JapaneseScoringRow {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    throw new GameServiceError("A valid scoring revision is required.", 400, "invalid_scoring_revision");
  }
  if (loaded.game.status !== "active" || loaded.game.phase !== "scoring" || !loaded.scoring) {
    throw new GameServiceError("This game is not in scoring.", 409, "not_scoring");
  }
  if (loaded.scoring.revision !== expectedRevision || loaded.game.scoring_revision !== expectedRevision) {
    throw new GameServiceError("The scoring proposal changed.", 409, "scoring_revision_conflict");
  }
  if (!options.allowExpired && loaded.scoring.expires_at.getTime() <= Date.now()) {
    throw new GameServiceError(
      "The scoring decision window has ended.",
      409,
      "scoring_deadline_expired",
    );
  }
  if (!options.allowPending && loaded.scoring.suggestion_status === "pending") {
    throw new GameServiceError(
      "The initial scoring suggestion is still being prepared.",
      409,
      "scoring_suggestion_pending",
    );
  }
  return loaded.scoring;
}

type KataGoRequestDiagnostics = Readonly<{
  requestIdentity: string;
  providerKind: KataGoProviderKind;
  engineVersion: string;
  modelVersion: string;
  configVersion: string;
  confidencePolicyVersion: string;
}>;

function kataGoRequestDiagnostics(
  requestIdentity: string,
  runtime: KataGoScoringRuntime,
): KataGoRequestDiagnostics {
  return {
    requestIdentity,
    providerKind: runtime.providerKind,
    engineVersion: runtime.engine.engineVersion,
    modelVersion: runtime.engine.modelVersion,
    configVersion: runtime.engine.configVersion,
    confidencePolicyVersion: runtime.confidencePolicyVersion,
  };
}

function kataGoErrorClass(error: unknown): KataGoErrorCode {
  return error instanceof KataGoScoringError ? error.code : "provider_unavailable";
}

function analysisBoundary(loaded: LoadedJapaneseGame): AnalysisBoundary {
  if (!loaded.scoring || loaded.authority.state.phase !== "stopped") throw corruption("missing analysis boundary");
  return {
    gameId: loaded.game.id,
    scoringRevision: loaded.scoring.revision,
    stoppedMoveNumber: loaded.scoring.stopped_move_number,
    stoppedBoardHash: loaded.scoring.board_hash,
    boardSize: loaded.game.board_size,
    board: loaded.authority.normalPlay.board.map((row) => [...row]),
    moves: [...loaded.moves],
    playerToMove: opposite(loaded.moves.at(-1)?.color ?? "white"),
  };
}

function kataGoRequest(
  boundary: AnalysisBoundary,
  runtime: KataGoScoringRuntime,
  purpose: "initial-suggestion" | "deadline-adjudication",
) {
  return {
    contractVersion: runtime.contractVersion,
    analysisPurpose: purpose,
    gameId: boundary.gameId,
    stoppedBoardHash: boundary.stoppedBoardHash,
    stoppedMoveNumber: boundary.stoppedMoveNumber,
    scoringRevision: boundary.scoringRevision,
    boardSize: boundary.boardSize,
    board: boundary.board,
    moves: boundary.moves.map((move) => ({
      moveNumber: move.move_number,
      color: move.color,
      x: move.x,
      y: move.y,
      isPass: move.is_pass,
      boardHash: move.board_hash,
    })),
    rules: {
      ruleset: "japanese",
      rulesProfile: JAPANESE_1989_RULES_PROFILE,
      rulesVersion: JAPANESE_1989_CONTRACT_ID,
      scoringMethod: "territory",
      komi: 6.5,
      handicap: 0,
    },
    playerToMove: boundary.playerToMove,
    engine: runtime.engine,
    maxVisits: runtime.maxVisits,
    confidencePolicyVersion: runtime.confidencePolicyVersion,
  } as const;
}

async function replaceProposal(
  client: PoolClient,
  loaded: LoadedJapaneseGame,
  input: Readonly<{
    deadStones: Position[];
    neutralRegionSeeds: Position[];
    source: JapaneseProposalRow["source"];
    actor: Stone | null;
    suggestion?: KataGoScoringProposal;
    latencyMs?: number;
  }>,
): Promise<LoadedJapaneseGame> {
  const scoring = loaded.scoring!;
  const board = loaded.authority.normalPlay.board;
  const deadRows: JapaneseDeadRow[] = sortPositions(input.deadStones).map(({ x, y }) => {
    const color = board[y]?.[x];
    if (!color) throw new GameServiceError("Only occupied groups may be marked dead.", 400, "invalid_dead_stone");
    return { x, y, color };
  });
  try {
    scoreJapaneseTerritory({
      board: board.map((row) => [...row]),
      prisoners: loaded.authority.normalPlay.prisoners,
      deadStones: input.deadStones,
      agreedNeutralRegionSeeds: input.neutralRegionSeeds,
      komi: 6.5,
    });
  } catch (error) {
    throw new GameServiceError(
      error instanceof Error ? error.message : "Invalid Japanese settlement proposal.",
      400,
      "invalid_japanese_proposal",
    );
  }
  const revision = scoring.revision + 1;
  const hash = proposalHash(
    loaded, revision, scoring.stopped_move_number, scoring.board_hash,
    loaded.authority.normalPlay.prisoners, deadRows,
    input.neutralRegionSeeds,
  );
  const now = new Date();
  const gameResult = await client.query<JapaneseGameRow>(
    `UPDATE games SET scoring_revision = $2, updated_at = $3, version = version + 1
      WHERE id = $1 RETURNING *`, [loaded.game.id, revision, now],
  );
  await client.query("DELETE FROM game_japanese_dead_stones WHERE game_id = $1", [loaded.game.id]);
  await client.query("DELETE FROM game_japanese_neutral_region_seeds WHERE game_id = $1", [loaded.game.id]);
  const participantColumn = input.actor === "black"
    ? "black_participated_at" : input.actor === "white" ? "white_participated_at" : null;
  const stateResult = await client.query<JapaneseScoringRow>(
    `UPDATE game_japanese_scoring_state
        SET revision = $2, proposal_hash = $3,
            black_confirmed_revision = NULL, white_confirmed_revision = NULL,
            black_confirmed_proposal_hash = NULL, white_confirmed_proposal_hash = NULL,
            black_confirmed_at = NULL, white_confirmed_at = NULL,
            ${participantColumn ? `${participantColumn} = COALESCE(${participantColumn}, $4),` : ""}
            suggestion_status = COALESCE($5, suggestion_status),
            suggestion_request_identity = COALESCE($6, suggestion_request_identity),
            suggestion_provider_kind = COALESCE($7, suggestion_provider_kind),
            suggestion_engine_version = COALESCE($8, suggestion_engine_version),
            suggestion_model_version = COALESCE($9, suggestion_model_version),
            suggestion_config_version = COALESCE($10, suggestion_config_version),
            suggestion_confidence_policy_version = COALESCE($11, suggestion_confidence_policy_version),
            suggestion_latency_ms = COALESCE($12, suggestion_latency_ms),
            updated_at = $4
      WHERE game_id = $1 AND revision = $13
      RETURNING *`,
    [
      loaded.game.id, revision, hash, now,
      input.suggestion ? "ready" : null,
      input.suggestion?.requestIdentity ?? null,
      input.suggestion?.providerKind ?? null,
      input.suggestion?.engine.engineVersion ?? null,
      input.suggestion?.engine.modelVersion ?? null,
      input.suggestion?.engine.configVersion ?? null,
      input.suggestion?.confidencePolicyVersion ?? null,
      input.latencyMs ?? null,
      scoring.revision,
    ],
  );
  if (deadRows.length > 0) {
    await client.query(
      `INSERT INTO game_japanese_dead_stones
         (game_id, revision, proposal_hash, x, y, color)
       SELECT $1, $2, $3, point.x, point.y, point.color
         FROM UNNEST($4::int[], $5::int[], $6::text[]) AS point(x, y, color)`,
      [loaded.game.id, revision, hash, deadRows.map(({ x }) => x), deadRows.map(({ y }) => y), deadRows.map(({ color }) => color)],
    );
  }
  if (input.neutralRegionSeeds.length > 0) {
    await client.query(
      `INSERT INTO game_japanese_neutral_region_seeds
         (game_id, revision, proposal_hash, x, y)
       SELECT $1, $2, $3, point.x, point.y
         FROM UNNEST($4::int[], $5::int[]) AS point(x, y)`,
      [loaded.game.id, revision, hash, input.neutralRegionSeeds.map(({ x }) => x), input.neutralRegionSeeds.map(({ y }) => y)],
    );
  }
  await client.query(
    `INSERT INTO game_japanese_scoring_proposals
       (game_id, scoring_revision, parent_scoring_revision, stopped_move_number,
        stopped_board_hash, proposal_hash, source, actor_color, dead_stones,
        neutral_region_seeds, rules, rules_profile, scoring_method, komi, handicap)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,
             'japanese',$11,'territory',6.5,0)`,
    [
      loaded.game.id, revision, loaded.currentProposal ? scoring.revision : null, scoring.stopped_move_number,
      scoring.board_hash, hash, input.source, input.actor,
      JSON.stringify(deadRows.map(({ x, y, color }) => ({ x, y, color }))),
      JSON.stringify(sortPositions(input.neutralRegionSeeds)),
      JAPANESE_1989_RULES_PROFILE,
    ],
  );
  return {
    ...loaded,
    game: { ...gameResult.rows[0], black_player_name: loaded.game.black_player_name, white_player_name: loaded.game.white_player_name, rated: loaded.game.rated },
    scoring: stateResult.rows[0],
    deadRows,
    neutralRows: sortPositions(input.neutralRegionSeeds),
    currentProposal: {
      scoring_revision: revision,
      parent_scoring_revision: loaded.currentProposal ? scoring.revision : null,
      source: input.source,
      actor_color: input.actor,
      proposal_hash: hash,
      dead_stones: deadRows,
      neutral_region_seeds: input.neutralRegionSeeds,
      created_at: now,
    },
  };
}

async function applyInitialSuggestion(
  client: PoolClient,
  loaded: LoadedJapaneseGame,
  proposal: KataGoScoringProposal,
  latencyMs: number,
): Promise<LoadedJapaneseGame> {
  const scoring = loaded.scoring!;
  if (scoring.suggestion_status !== "pending" || loaded.currentProposal !== null) {
    throw corruption("initial suggestion is not pending");
  }
  const board = loaded.authority.normalPlay.board;
  const deadRows: JapaneseDeadRow[] = sortPositions([...proposal.deadStones]).map(({ x, y }) => {
    const color = board[y]?.[x];
    if (!color) throw new GameServiceError("KataGo identified an empty point as dead.", 400, "invalid_japanese_proposal");
    return { x, y, color };
  });
  try {
    scoreJapaneseTerritory({
      board: board.map((row) => [...row]),
      prisoners: loaded.authority.normalPlay.prisoners,
      deadStones: [...proposal.deadStones],
      agreedNeutralRegionSeeds: [...proposal.neutralRegionSeeds],
      komi: 6.5,
    });
  } catch (error) {
    throw new GameServiceError(
      error instanceof Error ? error.message : "Invalid KataGo settlement suggestion.",
      400,
      "invalid_japanese_proposal",
    );
  }
  const hash = proposalHash(
    loaded,
    scoring.revision,
    scoring.stopped_move_number,
    scoring.board_hash,
    loaded.authority.normalPlay.prisoners,
    deadRows,
    [...proposal.neutralRegionSeeds],
  );
  const now = new Date();
  await client.query("DELETE FROM game_japanese_dead_stones WHERE game_id=$1", [loaded.game.id]);
  await client.query("DELETE FROM game_japanese_neutral_region_seeds WHERE game_id=$1", [loaded.game.id]);
  const state = await client.query<JapaneseScoringRow>(
    `UPDATE game_japanese_scoring_state SET proposal_hash=$2,
        suggestion_status='ready',suggestion_request_identity=$3,
        suggestion_provider_kind=$4,suggestion_engine_version=$5,
        suggestion_model_version=$6,suggestion_config_version=$7,
        suggestion_confidence_policy_version=$8,suggestion_latency_ms=$9,
        updated_at=$10 WHERE game_id=$1 AND revision=$11 RETURNING *`,
    [
      loaded.game.id, hash, proposal.requestIdentity, proposal.providerKind,
      proposal.engine.engineVersion, proposal.engine.modelVersion,
      proposal.engine.configVersion, proposal.confidencePolicyVersion,
      latencyMs, now, scoring.revision,
    ],
  );
  if (deadRows.length > 0) {
    await client.query(
      `INSERT INTO game_japanese_dead_stones
         (game_id,revision,proposal_hash,x,y,color)
       SELECT $1,$2,$3,point.x,point.y,point.color
         FROM UNNEST($4::int[],$5::int[],$6::text[]) AS point(x,y,color)`,
      [loaded.game.id, scoring.revision, hash, deadRows.map(({ x }) => x), deadRows.map(({ y }) => y), deadRows.map(({ color }) => color)],
    );
  }
  if (proposal.neutralRegionSeeds.length > 0) {
    await client.query(
      `INSERT INTO game_japanese_neutral_region_seeds
         (game_id,revision,proposal_hash,x,y)
       SELECT $1,$2,$3,point.x,point.y
         FROM UNNEST($4::int[],$5::int[]) AS point(x,y)`,
      [loaded.game.id, scoring.revision, hash, proposal.neutralRegionSeeds.map(({ x }) => x), proposal.neutralRegionSeeds.map(({ y }) => y)],
    );
  }
  await client.query(
    `INSERT INTO game_japanese_scoring_proposals
       (game_id,scoring_revision,parent_scoring_revision,stopped_move_number,
        stopped_board_hash,proposal_hash,source,actor_color,dead_stones,
        neutral_region_seeds,rules,rules_profile,scoring_method,komi,handicap,
        suggestion_request_identity,suggestion_provider_kind,suggestion_engine_version,
        suggestion_model_version,suggestion_config_version,
        suggestion_confidence_policy_version,suggestion_latency_ms)
     VALUES ($1,$2,NULL,$3,$4,$5,'katago_initial',NULL,$6::jsonb,$7::jsonb,
             'japanese',$8,'territory',6.5,0,$9,$10,$11,$12,$13,$14,$15)`,
    [
      loaded.game.id, scoring.revision, scoring.stopped_move_number, scoring.board_hash,
      hash, JSON.stringify(deadRows), JSON.stringify(proposal.neutralRegionSeeds),
      JAPANESE_1989_RULES_PROFILE, proposal.requestIdentity, proposal.providerKind,
      proposal.engine.engineVersion, proposal.engine.modelVersion,
      proposal.engine.configVersion, proposal.confidencePolicyVersion, latencyMs,
    ],
  );
  const game = await client.query<JapaneseGameRow>(
    "UPDATE games SET version=version+1,updated_at=$2 WHERE id=$1 RETURNING *",
    [loaded.game.id, now],
  );
  return {
    ...loaded,
    game: { ...game.rows[0], black_player_name: loaded.game.black_player_name, white_player_name: loaded.game.white_player_name, rated: loaded.game.rated },
    scoring: state.rows[0],
    deadRows,
    neutralRows: sortPositions([...proposal.neutralRegionSeeds]),
    currentProposal: {
      scoring_revision: scoring.revision,
      parent_scoring_revision: null,
      source: "katago_initial",
      actor_color: null,
      proposal_hash: hash,
      dead_stones: deadRows,
      neutral_region_seeds: proposal.neutralRegionSeeds,
      created_at: now,
    },
  };
}

async function recordSuggestionFailure(
  gameId: string,
  playerKey: string,
  boundary: AnalysisBoundary,
  status: "unavailable" | "invalid",
  diagnostics: KataGoRequestDiagnostics | null,
  errorClass: KataGoErrorCode,
  latencyMs: number,
): Promise<GameState> {
  return withTransaction(async (client) => {
    const loaded = await loadJapaneseGame(client, gameId, playerKey, true);
    if (
      !loaded.scoring || loaded.scoring.revision !== boundary.scoringRevision
      || loaded.scoring.board_hash !== boundary.stoppedBoardHash
      || loaded.scoring.suggestion_status !== "pending"
    ) return serializeJapaneseGame(loaded);
    const state = await client.query<JapaneseScoringRow>(
      `UPDATE game_japanese_scoring_state
          SET suggestion_status = $2, suggestion_request_identity = $3,
              suggestion_provider_kind = $4, suggestion_engine_version = $5,
              suggestion_model_version = $6, suggestion_config_version = $7,
              suggestion_confidence_policy_version = $8,
              suggestion_latency_ms = $9, suggestion_error_class = $10,
              updated_at = NOW()
        WHERE game_id = $1 RETURNING *`,
      [
        gameId, status, diagnostics?.requestIdentity ?? null,
        diagnostics?.providerKind ?? null, diagnostics?.engineVersion ?? null,
        diagnostics?.modelVersion ?? null, diagnostics?.configVersion ?? null,
        diagnostics?.confidencePolicyVersion ?? null, latencyMs, errorClass,
      ],
    );
    const game = await client.query<JapaneseGameRow>(
      "UPDATE games SET version = version + 1, updated_at = NOW() WHERE id = $1 RETURNING *",
      [gameId],
    );
    return serializeJapaneseGame({
      ...loaded,
      scoring: state.rows[0],
      game: { ...game.rows[0], black_player_name: loaded.game.black_player_name, white_player_name: loaded.game.white_player_name, rated: loaded.game.rated },
    });
  });
}

async function analyzeInitialSuggestion(
  gameId: string,
  playerKey: string,
  boundary: AnalysisBoundary,
): Promise<GameState> {
  const started = Date.now();
  let runtime: KataGoScoringRuntime;
  let diagnostics: KataGoRequestDiagnostics | null = null;
  try {
    runtime = configuredKataGoScoringRuntime();
    const request = kataGoRequest(boundary, runtime, "initial-suggestion");
    const canonicalRequest = canonicalizeKataGoScoringRequest(request);
    diagnostics = kataGoRequestDiagnostics(canonicalRequest.requestIdentity, runtime);
    const proposal = await runtime.client.analyze(request);
    return withTransaction(async (client) => {
      const loaded = await loadJapaneseGame(client, gameId, playerKey, true);
      if (
        !loaded.scoring || loaded.scoring.revision !== boundary.scoringRevision
        || loaded.scoring.board_hash !== boundary.stoppedBoardHash
        || loaded.scoring.suggestion_status !== "pending"
      ) return serializeJapaneseGame(loaded);
      try {
        const revised = await applyInitialSuggestion(
          client,
          loaded,
          proposal,
          Date.now() - started,
        );
        return serializeJapaneseGame(revised);
      } catch (error) {
        if (!(error instanceof GameServiceError) || error.code !== "invalid_japanese_proposal") throw error;
        const state = await client.query<JapaneseScoringRow>(
          `UPDATE game_japanese_scoring_state
              SET suggestion_status = 'invalid', suggestion_request_identity = $2,
                  suggestion_provider_kind = $3, suggestion_engine_version = $4,
                  suggestion_model_version = $5, suggestion_config_version = $6,
                  suggestion_confidence_policy_version = $7,
                  suggestion_latency_ms = $8, suggestion_error_class = 'invalid_response',
                  updated_at = NOW()
            WHERE game_id = $1 RETURNING *`,
          [
            gameId, proposal.requestIdentity, proposal.providerKind,
            proposal.engine.engineVersion, proposal.engine.modelVersion,
            proposal.engine.configVersion, proposal.confidencePolicyVersion,
            Date.now() - started,
          ],
        );
        return serializeJapaneseGame({ ...loaded, scoring: state.rows[0] });
      }
    });
  } catch (error) {
    const status = error instanceof KataGoScoringError
      && (error.code === "invalid_response" || error.code === "stale_response" || error.code === "model_mismatch")
      ? "invalid" : "unavailable";
    return recordSuggestionFailure(
      gameId, playerKey, boundary, status, diagnostics,
      kataGoErrorClass(error), Date.now() - started,
    );
  }
}

/**
 * Explicit operational repair for the narrow crash window after a stopped
 * position commits but before its durable KataGo job is dispatched. Normal
 * polling remains read-only; workers and bounded smoke commands call this.
 */
export async function repairPendingJapaneseSuggestion(
  gameId: string,
  playerKey: string,
): Promise<GameState> {
  const pending = await withReadOnlyTransaction(async (client) => {
    const loaded = await loadJapaneseGame(client, gameId, playerKey);
    return loaded.scoring?.suggestion_status === "pending"
      ? analysisBoundary(loaded)
      : null;
  });
  if (!pending) return getJapaneseGameState(gameId, playerKey);
  return analyzeInitialSuggestion(gameId, playerKey, pending);
}

export async function getJapaneseGameState(gameId: string, playerKey: string): Promise<GameState> {
  return withReadOnlyTransaction(async (client) =>
    serializeJapaneseGame(await loadJapaneseGame(client, gameId, playerKey)));
}

export async function pollJapaneseGameState(
  gameId: string,
  playerKey: string,
  knownVersion: number | null,
): Promise<{ unchanged: false; game: GameState } | GamePollHeartbeat> {
  const loaded = await withReadOnlyTransaction((client) => loadJapaneseGame(client, gameId, playerKey));
  if (knownVersion !== null && loaded.game.version === knownVersion) {
    return {
      unchanged: true,
      gameId,
      version: loaded.game.version,
      clock: gameClock(loaded, new Date()),
    };
  }
  return { unchanged: false, game: serializeJapaneseGame(loaded) };
}

export async function submitJapaneseMove(
  gameId: string,
  playerKey: string,
  move: { x?: number; y?: number; isPass?: boolean; expectedVersion: number },
): Promise<GameState> {
  const result = await withTransaction<SubmitResult>(async (client) => {
    const loaded = await loadJapaneseGame(client, gameId, playerKey, true);
    assertExpectedVersion(loaded.game, move.expectedVersion);
    const { game } = loaded;
    if (game.status !== "active") throw new GameServiceError("This game is already finished.", 409, "game_finished");
    if (game.phase !== "play" || loaded.authority.state.phase !== "play") {
      throw new GameServiceError("Agree on the score or resume play first.", 409, "game_in_scoring");
    }
    const color = loaded.authority.state.toMove;
    const expectedPlayer = color === "black" ? game.black_player_key : game.white_player_key;
    if (playerKey !== expectedPlayer) throw new GameServiceError("It is not your turn.", 409, "not_your_turn");
    const now = new Date();
    const periodTimeMs = game.byo_yomi_seconds * 1_000;
    const clock = advanceClock({
      mainTimeMs: numeric(game[`${color}_time_remaining_ms`]),
      periodsRemaining: game[`${color}_periods_remaining`],
      periodTimeMs,
      elapsedMs: Math.max(0, now.getTime() - game.turn_started_at.getTime()),
    });
    if (clock.timedOut) {
      const winner = opposite(color);
      const winnerKey = winner === "black" ? game.black_player_key : game.white_player_key;
      const updated = await client.query<JapaneseGameRow>(
        `UPDATE games SET status='finished', phase='play', to_move=NULL,
            finish_reason='timeout', result=$2, winner_key=$3,
            ${color}_time_remaining_ms=0, ${color}_periods_remaining=0,
            finished_at=$4, updated_at=$4, version=version+1
          WHERE id=$1 RETURNING *`,
        [gameId, `${winner === "black" ? "B" : "W"}+T`, winnerKey, now],
      );
      const { rated } = await finalizeGameRatings(client, gameId);
      return { game: serializeJapaneseGame({ ...loaded, game: { ...updated.rows[0], black_player_name: game.black_player_name, white_player_name: game.white_player_name, rated } }, now), boundary: null };
    }
    const isPass = move.isPass === true;
    let nextBoard = loaded.authority.normalPlay.board.map((row) => [...row]);
    if (!isPass) {
      if (!Number.isInteger(move.x) || !Number.isInteger(move.y)) {
        throw new GameServiceError("A move needs integer coordinates.", 400, "invalid_move");
      }
      const applied = applyJapaneseSimpleKoMove(
        nextBoard,
        color,
        move.x!,
        move.y!,
        loaded.authority.normalPlay.koRestrictions,
        loaded.moves.length + 1,
      );
      if (!applied.ok) throw new GameServiceError(`Illegal move: ${applied.error}.`, 409, applied.error);
      nextBoard = applied.board;
    }
    const nextMove: JapaneseMoveRow = {
      move_number: loaded.moves.length + 1,
      color,
      x: isPass ? null : move.x!,
      y: isPass ? null : move.y!,
      is_pass: isPass,
      board_hash: boardHash(nextBoard),
      created_at: now,
    };
    const nextMoves = [...loaded.moves, nextMove];
    const nextAuthority = replay(game, nextMoves, loaded.resumes);
    await client.query(
      `INSERT INTO moves (game_id, move_number, color, x, y, is_pass, board_hash, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [gameId, nextMove.move_number, color, nextMove.x, nextMove.y, isPass, nextMove.board_hash, now],
    );
    const clockAssignments = color === "black"
      ? [clock.mainTimeMs, numeric(game.white_time_remaining_ms), clock.periodsRemaining, game.white_periods_remaining]
      : [numeric(game.black_time_remaining_ms), clock.mainTimeMs, game.black_periods_remaining, clock.periodsRemaining];
    if (nextAuthority.state.phase === "stopped") {
      const revision = game.scoring_revision + 1;
      const expiresAt = new Date(now.getTime() + japaneseScoringDecisionWindowSeconds() * 1_000);
      const draftLoaded = { ...loaded, moves: nextMoves, authority: nextAuthority };
      const hash = proposalHash(
        draftLoaded, revision, nextMove.move_number, nextMove.board_hash,
        nextAuthority.normalPlay.prisoners, [], [],
      );
      await client.query(
        `INSERT INTO game_japanese_scoring_state
           (game_id, board_hash, stopped_move_number, revision, proposal_hash,
            captured_white_by_black_at_stop, captured_black_by_white_at_stop,
            expires_at, suggestion_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')`,
        [
          gameId, nextMove.board_hash, nextMove.move_number, revision, hash,
          nextAuthority.normalPlay.prisoners.capturedWhiteByBlack,
          nextAuthority.normalPlay.prisoners.capturedBlackByWhite,
          expiresAt,
        ],
      );
      const updated = await client.query<JapaneseGameRow>(
        `UPDATE games SET phase='scoring', to_move=NULL, consecutive_passes=2,
            scoring_revision=$2, black_time_remaining_ms=$3, white_time_remaining_ms=$4,
            black_periods_remaining=$5, white_periods_remaining=$6,
            updated_at=$7, version=version+1 WHERE id=$1 RETURNING *`,
        [gameId, revision, ...clockAssignments, now],
      );
      const state = await loadJapaneseGame(client, gameId, playerKey, false);
      const gameState = serializeJapaneseGame({ ...state, game: { ...updated.rows[0], black_player_name: game.black_player_name, white_player_name: game.white_player_name, rated: game.rated } }, now);
      return { game: gameState, boundary: analysisBoundary(state) };
    }
    const updated = await client.query<JapaneseGameRow>(
      `UPDATE games SET to_move=$2, consecutive_passes=$3,
          black_time_remaining_ms=$4, white_time_remaining_ms=$5,
          black_periods_remaining=$6, white_periods_remaining=$7,
          turn_started_at=$8, updated_at=$8, version=version+1
        WHERE id=$1 RETURNING *`,
      [gameId, nextAuthority.state.toMove, nextAuthority.state.consecutivePasses, ...clockAssignments, now],
    );
    const nextLoaded = {
      ...loaded,
      moves: nextMoves,
      authority: nextAuthority,
      game: { ...updated.rows[0], black_player_name: game.black_player_name, white_player_name: game.white_player_name, rated: game.rated },
    };
    return { game: serializeJapaneseGame(nextLoaded, now), boundary: null };
  });
  return result.boundary
    ? analyzeInitialSuggestion(gameId, playerKey, result.boundary)
    : result.game;
}

export async function setJapaneseDeadGroup(
  gameId: string,
  playerKey: string,
  proposal: { x: number; y: number; dead: boolean; expectedRevision: number },
): Promise<GameState> {
  return withTransaction(async (client) => {
    const loaded = await loadJapaneseGame(client, gameId, playerKey, true);
    assertScoring(loaded, proposal.expectedRevision);
    if (typeof proposal.dead !== "boolean") throw new GameServiceError("Dead/alive state is required.", 400, "invalid_dead_state");
    let toggled;
    try {
      toggled = toggleDeadGroup(
        loaded.authority.normalPlay.board.map((row) => [...row]),
        loaded.deadRows.map(({ x, y }) => ({ x, y })),
        { x: proposal.x, y: proposal.y },
        proposal.dead,
      );
    } catch (error) {
      throw new GameServiceError(error instanceof Error ? error.message : "Invalid group.", 400, "invalid_dead_stone");
    }
    if (!toggled.changed) return serializeJapaneseGame(loaded);
    return serializeJapaneseGame(await replaceProposal(client, loaded, {
      deadStones: toggled.deadStones,
      neutralRegionSeeds: loaded.neutralRows,
      source: "player_edit",
      actor: playerColor(loaded.game, playerKey),
    }));
  });
}

async function proposalContent(
  client: PoolClient,
  gameId: string,
  revision: number,
): Promise<{ deadStones: Position[]; neutralRegionSeeds: Position[] }> {
  const row = (await client.query<Pick<JapaneseProposalRow, "dead_stones" | "neutral_region_seeds">>(
    `SELECT dead_stones, neutral_region_seeds FROM game_japanese_scoring_proposals
      WHERE game_id=$1 AND scoring_revision=$2`, [gameId, revision],
  )).rows[0];
  if (!row) throw corruption("proposal history missing");
  return {
    deadStones: parseProposalPositions(row.dead_stones, "dead_stones"),
    neutralRegionSeeds: parseProposalPositions(row.neutral_region_seeds, "neutral_region_seeds"),
  };
}

export async function undoJapaneseScoringChange(
  gameId: string,
  playerKey: string,
  expectedRevision: number,
): Promise<GameState> {
  return withTransaction(async (client) => {
    const loaded = await loadJapaneseGame(client, gameId, playerKey, true);
    assertScoring(loaded, expectedRevision);
    const parent = loaded.currentProposal?.parent_scoring_revision;
    if (parent === null || parent === undefined) {
      throw new GameServiceError("There is no scoring change to undo.", 409, "nothing_to_undo");
    }
    const content = await proposalContent(client, gameId, parent);
    return serializeJapaneseGame(await replaceProposal(client, loaded, {
      ...content, source: "undo", actor: playerColor(loaded.game, playerKey),
    }));
  });
}

export async function resetJapaneseScoringSuggestion(
  gameId: string,
  playerKey: string,
  expectedRevision: number,
): Promise<GameState> {
  return withTransaction(async (client) => {
    const loaded = await loadJapaneseGame(client, gameId, playerKey, true);
    const scoring = assertScoring(loaded, expectedRevision);
    const suggestion = (await client.query<JapaneseProposalRow>(
      `SELECT scoring_revision, parent_scoring_revision, source, actor_color,
              proposal_hash, dead_stones, neutral_region_seeds, created_at
         FROM game_japanese_scoring_proposals
        WHERE game_id=$1 AND stopped_move_number=$2 AND source='katago_initial'
        ORDER BY scoring_revision DESC LIMIT 1`,
      [gameId, scoring.stopped_move_number],
    )).rows[0];
    if (!suggestion || scoring.suggestion_status !== "ready") {
      throw new GameServiceError("A validated KataGo suggestion is not available.", 409, "suggestion_unavailable");
    }
    return serializeJapaneseGame(await replaceProposal(client, loaded, {
      deadStones: parseProposalPositions(suggestion.dead_stones, "dead_stones"),
      neutralRegionSeeds: parseProposalPositions(suggestion.neutral_region_seeds, "neutral_region_seeds"),
      source: "reset",
      actor: playerColor(loaded.game, playerKey),
    }));
  });
}

export async function confirmJapaneseScore(
  gameId: string,
  playerKey: string,
  expectedRevision: number,
): Promise<GameState> {
  return withTransaction(async (client) => {
    const loaded = await loadJapaneseGame(client, gameId, playerKey, true);
    if (loaded.game.status === "finished") return serializeJapaneseGame(loaded);
    const scoring = assertScoring(loaded, expectedRevision);
    const color = playerColor(loaded.game, playerKey);
    if (
      scoring[`${color}_confirmed_revision`] === expectedRevision
      && scoring[`${color}_confirmed_proposal_hash`] === scoring.proposal_hash
    ) return serializeJapaneseGame(loaded);
    const now = new Date();
    const stateResult = await client.query<JapaneseScoringRow>(
      `UPDATE game_japanese_scoring_state SET
          ${color}_confirmed_revision=$2, ${color}_confirmed_proposal_hash=$3,
          ${color}_confirmed_at=$4, ${color}_participated_at=COALESCE(${color}_participated_at,$4),
          updated_at=$4 WHERE game_id=$1 RETURNING *`,
      [gameId, expectedRevision, scoring.proposal_hash, now],
    );
    const gameResult = await client.query<JapaneseGameRow>(
      "UPDATE games SET version=version+1, updated_at=$2 WHERE id=$1 RETURNING *",
      [gameId, now],
    );
    let next: LoadedJapaneseGame = {
      ...loaded,
      scoring: stateResult.rows[0],
      game: { ...gameResult.rows[0], black_player_name: loaded.game.black_player_name, white_player_name: loaded.game.white_player_name, rated: loaded.game.rated },
    };
    const both = next.scoring!.black_confirmed_revision === expectedRevision
      && next.scoring!.white_confirmed_revision === expectedRevision
      && next.scoring!.black_confirmed_proposal_hash === scoring.proposal_hash
      && next.scoring!.white_confirmed_proposal_hash === scoring.proposal_hash;
    if (!both) return serializeJapaneseGame(next, now);
    const score = scoreCurrent(next)!;
    const preview = toJapaneseTerritoryPreview(score);
    const deadBlack = next.deadRows.filter(({ color: stone }) => stone === "black").length;
    const deadWhite = next.deadRows.length - deadBlack;
    const scoredBoard = next.authority.normalPlay.board.map((row) => [...row]);
    for (const { x, y } of next.deadRows) scoredBoard[y][x] = null;
    const finalState = await client.query<JapaneseScoringRow>(
      `UPDATE game_japanese_scoring_state SET scored_board_hash=$2,
          scored_proposal_hash=proposal_hash, living_black_stones=$3,
          living_white_stones=$4, black_territory=$5, white_territory=$6,
          dame_points=$7, territory_excluded_by_agreement=$8,
          dead_black_stones=$9, dead_white_stones=$10,
          black_prisoners_final=$11, white_prisoners_final=$12,
          black_total=$13, white_total=$14, outcome_kind=$15, winner=$16,
          margin=$17, finalized_at=$18, updated_at=$18
        WHERE game_id=$1 RETURNING *`,
      [
        gameId, boardHash(scoredBoard), score.livingBlackStones, score.livingWhiteStones,
        score.blackTerritory, score.whiteTerritory, score.damePoints,
        score.territoryExcludedByAgreement, deadBlack, deadWhite,
        score.blackPrisonersFinal, score.whitePrisonersFinal, score.blackTotal,
        score.whiteTotal, score.outcome.kind, score.outcome.kind === "points" ? score.outcome.winner : null,
        score.outcome.kind === "points" ? score.outcome.margin : 0, now,
      ],
    );
    const winnerKey = preview.winner === "black" ? loaded.game.black_player_key
      : preview.winner === "white" ? loaded.game.white_player_key : null;
    const finished = await client.query<JapaneseGameRow>(
      `UPDATE games SET status='finished', phase='scoring', to_move=NULL,
          finish_reason='score', result=$2, winner_key=$3,
          finished_at=$4, updated_at=$4, version=version+1
        WHERE id=$1 RETURNING *`,
      [gameId, preview.result, winnerKey, now],
    );
    const { rated } = await finalizeGameRatings(client, gameId);
    next = {
      ...next,
      scoring: finalState.rows[0],
      game: { ...finished.rows[0], black_player_name: loaded.game.black_player_name, white_player_name: loaded.game.white_player_name, rated },
    };
    return serializeJapaneseGame(next, now);
  });
}

export async function resumeJapanesePlay(
  gameId: string,
  playerKey: string,
  expectedRevision: number,
): Promise<GameState> {
  return withTransaction(async (client) => {
    const loaded = await loadJapaneseGame(client, gameId, playerKey, true);
    const scoring = assertScoring(loaded, expectedRevision);
    const resumptionNumber = loaded.resumes.length + 1;
    if (japaneseScoringResumptionsRemaining(loaded.resumes.length) === 0) {
      throw new GameServiceError("This is the final scoring resolution phase.", 409, "resumption_limit_reached");
    }
    const requestedBy = playerColor(loaded.game, playerKey);
    const resumedToMove = opposite(requestedBy);
    await client.query(
      `INSERT INTO game_japanese_resume_authorizations
         (game_id,resumption_number,scoring_revision,stopped_move_number,
          stopped_board_hash,requested_by_color,rules,rules_profile,
          scoring_method,komi,handicap)
       VALUES ($1,$2,$3,$4,$5,$6,'japanese',$7,'territory',6.5,0)`,
      [gameId, resumptionNumber, scoring.revision, scoring.stopped_move_number, scoring.board_hash, requestedBy, JAPANESE_1989_RULES_PROFILE],
    );
    const now = new Date();
    const game = await client.query<JapaneseGameRow>(
      `UPDATE games SET phase='play',to_move=$2,consecutive_passes=0,
          scoring_revision=scoring_revision+1,turn_started_at=$3,updated_at=$3,
          version=version+1 WHERE id=$1 RETURNING *`,
      [gameId, resumedToMove, now],
    );
    await client.query("DELETE FROM game_japanese_scoring_state WHERE game_id=$1", [gameId]);
    const next = await loadJapaneseGame(client, gameId, playerKey, false);
    return serializeJapaneseGame({
      ...next,
      game: { ...game.rows[0], black_player_name: loaded.game.black_player_name, white_player_name: loaded.game.white_player_name, rated: loaded.game.rated },
    }, now);
  });
}

function proposalAdjudicationSafe(proposal: KataGoScoringProposal): boolean {
  return proposal.groups.every((group) =>
    group.reason === "suggested-dead" || group.reason === "seki"
    || (group.reason === "status-not-dead" && group.confidence >= 0.85)
  );
}

type DeadlineAdjudicationEvidence = Readonly<{
  diagnostics: KataGoRequestDiagnostics | null;
  latencyMs: number;
  errorClass: KataGoErrorCode | null;
  proposal?: KataGoScoringProposal;
}>;

async function finishJapaneseDeadline(
  client: PoolClient,
  loaded: LoadedJapaneseGame,
  input: Readonly<{
    outcomeKind: "katago_validated" | "katago_low_confidence" | "katago_unavailable" | "no_participation" | "abandonment";
    winner: Stone | null;
    abandonedBy: Stone | null;
    adjudication?: DeadlineAdjudicationEvidence;
    score?: JapaneseTerritoryScore;
  }>,
): Promise<GameState> {
  const scoring = loaded.scoring!;
  const now = new Date();
  const score = input.score;
  const adjudicationProposal = input.adjudication?.proposal;
  const adjudicationDeadRows: JapaneseDeadRow[] = adjudicationProposal
    ? sortPositions([...adjudicationProposal.deadStones]).map(({ x, y }) => {
      const color = loaded.authority.normalPlay.board[y]?.[x];
      if (!color) throw corruption("deadline adjudication contains an empty dead point");
      return { x, y, color };
    })
    : [];
  const adjudicationProposalHash = adjudicationProposal
    ? proposalHash(
      loaded, scoring.revision, scoring.stopped_move_number, scoring.board_hash,
      loaded.authority.normalPlay.prisoners, adjudicationDeadRows,
      [...adjudicationProposal.neutralRegionSeeds],
    )
    : null;
  const deadBlack = adjudicationDeadRows.filter(({ color }) => color === "black").length;
  const deadWhite = adjudicationDeadRows.length - deadBlack;
  const diagnostics = input.adjudication?.diagnostics;
  await client.query(
    `INSERT INTO game_japanese_scoring_terminal_events
       (game_id,scoring_revision,stopped_move_number,stopped_board_hash,
        proposal_hash,outcome_kind,winner_color,abandoned_by_color,
        rules,rules_profile,scoring_method,komi,handicap,
        captured_white_by_black_at_stop,captured_black_by_white_at_stop,
        adjudication_proposal_hash,adjudication_dead_stones,
        adjudication_neutral_region_seeds,adjudication_request_identity,
        adjudication_provider_kind,adjudication_engine_version,
        adjudication_model_version,adjudication_config_version,
        adjudication_confidence_policy_version,adjudication_latency_ms,
        adjudication_error_class,
        living_black_stones,living_white_stones,black_territory,white_territory,
        dame_points,territory_excluded_by_agreement,dead_black_stones,
        dead_white_stones,black_prisoners_final,white_prisoners_final,
        black_total,white_total,margin)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'japanese',$9,'territory',6.5,0,
             $10,$11,$12,$13::jsonb,$14::jsonb,$15,$16,$17,$18,$19,$20,$21,$22,
             $23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35)`,
    [
      loaded.game.id, scoring.revision, scoring.stopped_move_number, scoring.board_hash,
      scoring.proposal_hash, input.outcomeKind, input.winner, input.abandonedBy,
      JAPANESE_1989_RULES_PROFILE,
      scoring.captured_white_by_black_at_stop,
      scoring.captured_black_by_white_at_stop,
      adjudicationProposalHash,
      adjudicationProposal ? JSON.stringify(adjudicationDeadRows) : null,
      adjudicationProposal
        ? JSON.stringify(sortPositions([...adjudicationProposal.neutralRegionSeeds]))
        : null,
      diagnostics?.requestIdentity ?? null,
      diagnostics?.providerKind ?? null,
      diagnostics?.engineVersion ?? null,
      diagnostics?.modelVersion ?? null,
      diagnostics?.configVersion ?? null,
      diagnostics?.confidencePolicyVersion ?? null,
      input.adjudication?.latencyMs ?? null,
      input.adjudication?.errorClass ?? null,
      score?.livingBlackStones ?? null, score?.livingWhiteStones ?? null,
      score?.blackTerritory ?? null, score?.whiteTerritory ?? null,
      score?.damePoints ?? null, score?.territoryExcludedByAgreement ?? null,
      score ? deadBlack : null, score ? deadWhite : null,
      score?.blackPrisonersFinal ?? null, score?.whitePrisonersFinal ?? null,
      score?.blackTotal ?? null, score?.whiteTotal ?? null,
      score?.outcome.kind === "points" ? score.outcome.margin : score ? 0 : null,
    ],
  );
  const result = score ? toJapaneseTerritoryPreview(score).result
    : input.outcomeKind === "abandonment" && input.winner
      ? `${input.winner === "black" ? "B" : "W"}+F` : "Void";
  const winnerKey = input.winner === "black" ? loaded.game.black_player_key
    : input.winner === "white" ? loaded.game.white_player_key : null;
  const reason = score ? "japanese_adjudication"
    : input.outcomeKind === "abandonment"
      ? "japanese_abandonment"
      : "japanese_no_result";
  const game = await client.query<JapaneseGameRow>(
    `UPDATE games SET status='finished',phase='play',to_move=NULL,
        finish_reason=$2,result=$3,winner_key=$4,finished_at=$5,updated_at=$5,
        version=version+1 WHERE id=$1 RETURNING *`,
    [loaded.game.id, reason, result, winnerKey, now],
  );
  const { rated } = await finalizeGameRatings(client, loaded.game.id);
  await client.query("DELETE FROM game_japanese_scoring_state WHERE game_id=$1", [loaded.game.id]);
  return serializeJapaneseGame({
    ...loaded,
    scoring: null,
    deadRows: [],
    neutralRows: [],
    currentProposal: null,
    game: { ...game.rows[0], black_player_name: loaded.game.black_player_name, white_player_name: loaded.game.white_player_name, rated },
  }, now);
}

export async function resolveJapaneseScoringDeadline(
  gameId: string,
  playerKey: string,
  expectedRevision: number,
): Promise<GameState> {
  const decision = await withTransaction(async (client) => {
    const loaded = await loadJapaneseGame(client, gameId, playerKey, true);
    const scoring = assertScoring(loaded, expectedRevision, {
      allowExpired: true,
      allowPending: true,
    });
    if (scoring.expires_at.getTime() > Date.now()) {
      throw new GameServiceError("The scoring deadline has not expired.", 409, "scoring_deadline_active");
    }
    const policy = decideJapaneseScoringDeadline({
      blackParticipated: scoring.black_participated_at !== null,
      whiteParticipated: scoring.white_participated_at !== null,
    });
    if (policy.kind === "no-result") {
      return { complete: true as const, game: await finishJapaneseDeadline(client, loaded, {
        outcomeKind: "no_participation", winner: null, abandonedBy: null,
      }) };
    }
    if (policy.kind === "abandonment") {
      return { complete: true as const, game: await finishJapaneseDeadline(client, loaded, {
        outcomeKind: "abandonment", winner: policy.winner, abandonedBy: policy.abandonedBy,
      }) };
    }
    return { complete: false as const, boundary: analysisBoundary(loaded) };
  });
  if (decision.complete) return decision.game;
  const started = Date.now();
  let proposal: KataGoScoringProposal;
  let diagnostics: KataGoRequestDiagnostics | null = null;
  try {
    const runtime = configuredKataGoScoringRuntime();
    const request = kataGoRequest(decision.boundary, runtime, "deadline-adjudication");
    const canonicalRequest = canonicalizeKataGoScoringRequest(request);
    diagnostics = kataGoRequestDiagnostics(canonicalRequest.requestIdentity, runtime);
    proposal = await runtime.client.analyze(request);
  } catch (error) {
    return withTransaction(async (client) => {
      const loaded = await loadJapaneseGame(client, gameId, playerKey, true);
      assertScoring(loaded, expectedRevision, {
        allowExpired: true,
        allowPending: true,
      });
      return finishJapaneseDeadline(client, loaded, {
        outcomeKind: "katago_unavailable", winner: null, abandonedBy: null,
        adjudication: {
          diagnostics,
          latencyMs: Date.now() - started,
          errorClass: kataGoErrorClass(error),
        },
      });
    });
  }
  return withTransaction(async (client) => {
    const loaded = await loadJapaneseGame(client, gameId, playerKey, true);
    assertScoring(loaded, expectedRevision, {
      allowExpired: true,
      allowPending: true,
    });
    if (
      proposal.requestIdentity !== diagnostics?.requestIdentity
      || proposal.stoppedBoardHash !== loaded.scoring!.board_hash
      || proposal.scoringRevision !== loaded.scoring!.revision
    ) {
      return finishJapaneseDeadline(client, loaded, {
        outcomeKind: "katago_unavailable", winner: null, abandonedBy: null,
        adjudication: {
          diagnostics,
          latencyMs: Date.now() - started,
          errorClass: "stale_response",
        },
      });
    }
    if (!proposalAdjudicationSafe(proposal)) {
      return finishJapaneseDeadline(client, loaded, {
        outcomeKind: "katago_low_confidence", winner: null, abandonedBy: null,
        adjudication: {
          diagnostics,
          latencyMs: Date.now() - started,
          errorClass: null,
          proposal,
        },
      });
    }
    let score: JapaneseTerritoryScore;
    try {
      score = scoreJapaneseTerritory({
        board: loaded.authority.normalPlay.board.map((row) => [...row]),
        prisoners: loaded.authority.normalPlay.prisoners,
        deadStones: [...proposal.deadStones],
        agreedNeutralRegionSeeds: [...proposal.neutralRegionSeeds],
        komi: 6.5,
      });
    } catch {
      return finishJapaneseDeadline(client, loaded, {
        outcomeKind: "katago_low_confidence", winner: null, abandonedBy: null,
        adjudication: {
          diagnostics,
          latencyMs: Date.now() - started,
          errorClass: null,
          proposal,
        },
      });
    }
    return finishJapaneseDeadline(client, loaded, {
      outcomeKind: "katago_validated",
      winner: score.outcome.kind === "points" ? score.outcome.winner : null,
      abandonedBy: null,
      adjudication: {
        diagnostics,
        latencyMs: Date.now() - started,
        errorClass: null,
        proposal,
      },
      score,
    });
  });
}

export async function claimJapaneseWholeBoardRepetition(
  gameId: string,
  playerKey: string,
  expectedVersion: number,
): Promise<GameState> {
  return withTransaction(async (client) => {
    const loaded = await loadJapaneseGame(client, gameId, playerKey, true);
    assertExpectedVersion(loaded.game, expectedVersion);
    if (loaded.game.status !== "active" || loaded.game.phase !== "play") {
      throw new GameServiceError(
        "A whole-board repetition may be claimed only during play.",
        409,
        "repetition_claim_unavailable",
      );
    }
    const evidence = currentJapaneseWholeBoardRepetition(loaded.moves.map((move) => ({
      moveNumber: move.move_number,
      color: move.color,
      isPass: move.is_pass,
      boardHash: move.board_hash,
    })));
    if (!evidence) {
      throw new GameServiceError(
        "The current whole-board position has not repeated after a move.",
        409,
        "repetition_not_present",
      );
    }
    const color = playerColor(loaded.game, playerKey);
    if (loaded.repetitionClaims.some((claim) => claim.claimant_color === color)) {
      return serializeJapaneseGame(loaded);
    }
    const now = new Date();
    await client.query(
      `INSERT INTO game_japanese_repetition_claims
         (game_id,move_number,claimant_color,repeated_from_move_number,board_hash,
          rules,rules_profile,scoring_method,komi,handicap,claimed_at)
       VALUES ($1,$2,$3,$4,$5,'japanese',$6,'territory',6.5,0,$7)`,
      [
        gameId, evidence.moveNumber, color, evidence.repeatedFromMoveNumber,
        evidence.boardHash, JAPANESE_1989_RULES_PROFILE, now,
      ],
    );
    const claims = [...loaded.repetitionClaims, {
      move_number: evidence.moveNumber,
      claimant_color: color,
      repeated_from_move_number: evidence.repeatedFromMoveNumber,
      board_hash: evidence.boardHash,
      claimed_at: now,
    }];
    const agreed = claims.some((claim) => claim.claimant_color === "black")
      && claims.some((claim) => claim.claimant_color === "white");
    const updated = await client.query<JapaneseGameRow>(agreed
      ? `UPDATE games SET status='finished',phase='play',to_move=NULL,
            finish_reason='japanese_repetition',result='Void',winner_key=NULL,
            finished_at=$2,updated_at=$2,version=version+1
          WHERE id=$1 RETURNING *`
      : "UPDATE games SET updated_at=$2,version=version+1 WHERE id=$1 RETURNING *",
    [gameId, now]);
    const rated = agreed
      ? (await finalizeGameRatings(client, gameId)).rated
      : false;
    return serializeJapaneseGame({
      ...loaded,
      repetitionClaims: claims,
      game: {
        ...updated.rows[0],
        black_player_name: loaded.game.black_player_name,
        white_player_name: loaded.game.white_player_name,
        rated,
      },
    }, now);
  });
}

export async function resignJapaneseGame(gameId: string, playerKey: string): Promise<GameState> {
  return withTransaction(async (client) => {
    const loaded = await loadJapaneseGame(client, gameId, playerKey, true);
    if (loaded.game.status === "finished") return serializeJapaneseGame(loaded);
    const loser = playerColor(loaded.game, playerKey);
    const winner = opposite(loser);
    const winnerKey = winner === "black" ? loaded.game.black_player_key : loaded.game.white_player_key;
    const now = new Date();
    const game = await client.query<JapaneseGameRow>(
      `UPDATE games SET status='finished',phase='play',to_move=NULL,
          finish_reason='resignation',result=$2,winner_key=$3,
          finished_at=$4,updated_at=$4,version=version+1 WHERE id=$1 RETURNING *`,
      [gameId, `${winner === "black" ? "B" : "W"}+R`, winnerKey, now],
    );
    if (loaded.scoring) {
      await client.query("DELETE FROM game_japanese_scoring_state WHERE game_id=$1", [gameId]);
    }
    const { rated } = await finalizeGameRatings(client, gameId);
    return serializeJapaneseGame({
      ...loaded,
      scoring: null,
      deadRows: [],
      neutralRows: [],
      currentProposal: null,
      game: { ...game.rows[0], black_player_name: loaded.game.black_player_name, white_player_name: loaded.game.white_player_name, rated },
    }, now);
  });
}
