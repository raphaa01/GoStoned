import type { PoolClient, QueryResultRow } from "pg";
import { GameServiceError } from "@/lib/game/gameServiceError";
import {
  GLICKO2_ALGORITHM_VERSION,
  updateGlicko2Rating,
  type Glicko2Rating,
} from "./glicko2";

export const GLICKO2_INITIAL_RATING = 1200;
export const GLICKO2_INITIAL_RATING_DEVIATION = 350;
export const GLICKO2_INITIAL_VOLATILITY = 0.06;
export const GLICKO2_PROVISIONAL_GAME_COUNT = 10;
export const LEGACY_RATING_ALGORITHM_VERSION = "fixed-elo-legacy-v1" as const;

type TerminalFinishReason =
  | "score"
  | "legacy_score"
  | "resignation"
  | "timeout"
  | "japanese_adjudication"
  | "japanese_no_result"
  | "japanese_repetition"
  | "japanese_abandonment";

type TerminalGameRow = QueryResultRow & {
  id: string;
  status: "active" | "finished";
  black_player_key: string;
  white_player_key: string;
  winner_key: string | null;
  finish_reason: TerminalFinishReason | null;
  result: string | null;
  finished_at: Date | null;
};

type RegisteredPlayerRow = QueryResultRow & {
  user_id: string;
  player_key: string;
};

type GlobalRatingRow = QueryResultRow & {
  player_key: string;
  rating: string | number;
  rating_deviation: string | number;
  volatility: string | number;
  rated_game_count: number;
  algorithm_version: string;
  last_rating_period_at: Date;
};

type ExistingEventRow = QueryResultRow & {
  player_key: string;
  outcome_kind: RatingOutcomeKind;
  algorithm_version: string;
};

type RatingOutcomeKind = "win" | "loss" | "draw" | "no_result";

type ClassifiedTerminal = Readonly<{
  kind: "rated" | "no_result";
  outcomes: Readonly<Record<"black" | "white", RatingOutcomeKind>>;
  scores: Readonly<Record<"black" | "white", 0 | 0.5 | 1 | null>>;
}>;

type PersistedRatingState = Readonly<{
  playerKey: string;
  rating: number;
  ratingDeviation: number;
  volatility: number;
  ratedGameCount: number;
  lastRatingPeriodAt: Date;
}>;

export type RatingFinalizationResult = Readonly<{
  rated: boolean;
  kind: "rated" | "no_result" | "unrated";
}>;

function conflict(message: string): never {
  throw new GameServiceError(message, 500, "rating_history_conflict");
}

function finiteNumber(value: string | number, name: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) conflict(`The persisted ${name} is invalid.`);
  return parsed;
}

function fixed(value: number, decimals: number): number {
  if (!Number.isFinite(value)) conflict("The Glicko-2 result is not finite.");
  return Number(value.toFixed(decimals));
}

function classifyTerminal(game: TerminalGameRow): ClassifiedTerminal {
  if (
    game.status !== "finished"
    || game.finish_reason === null
    || game.result === null
    || game.result.length === 0
    || !(game.finished_at instanceof Date)
    || !Number.isFinite(game.finished_at.getTime())
  ) {
    return conflict("Ratings require one complete terminal game result.");
  }
  if (game.black_player_key === game.white_player_key) {
    return conflict("Ratings require two distinct game participants.");
  }
  if (
    game.finish_reason === "japanese_no_result"
    || game.finish_reason === "japanese_repetition"
  ) {
    if (game.winner_key !== null) {
      return conflict("A no-result game cannot identify a winner.");
    }
    return {
      kind: "no_result",
      outcomes: { black: "no_result", white: "no_result" },
      scores: { black: null, white: null },
    };
  }
  if (game.winner_key === null) {
    if (![
      "score",
      "legacy_score",
      "japanese_adjudication",
    ].includes(game.finish_reason)) {
      return conflict("This terminal reason requires an unambiguous winner.");
    }
    return {
      kind: "rated",
      outcomes: { black: "draw", white: "draw" },
      scores: { black: 0.5, white: 0.5 },
    };
  }
  if (
    game.winner_key !== game.black_player_key
    && game.winner_key !== game.white_player_key
  ) {
    return conflict("The terminal winner is not a game participant.");
  }
  const blackWon = game.winner_key === game.black_player_key;
  return {
    kind: "rated",
    outcomes: {
      black: blackWon ? "win" : "loss",
      white: blackWon ? "loss" : "win",
    },
    scores: { black: blackWon ? 1 : 0, white: blackWon ? 0 : 1 },
  };
}

function stateFromRow(row: GlobalRatingRow): PersistedRatingState {
  if (
    row.algorithm_version !== GLICKO2_ALGORITHM_VERSION
    || !Number.isSafeInteger(row.rated_game_count)
    || row.rated_game_count < 0
    || !(row.last_rating_period_at instanceof Date)
    || !Number.isFinite(row.last_rating_period_at.getTime())
  ) {
    return conflict("The global rating state is not compatible with Glicko-2 v1.");
  }
  return {
    playerKey: row.player_key,
    rating: finiteNumber(row.rating, "rating"),
    ratingDeviation: finiteNumber(row.rating_deviation, "rating deviation"),
    volatility: finiteNumber(row.volatility, "volatility"),
    ratedGameCount: row.rated_game_count,
    lastRatingPeriodAt: row.last_rating_period_at,
  };
}

function updatedState(
  player: PersistedRatingState,
  opponent: PersistedRatingState,
  score: 0 | 0.5 | 1,
): PersistedRatingState {
  const updated: Glicko2Rating = updateGlicko2Rating(
    {
      rating: player.rating,
      ratingDeviation: player.ratingDeviation,
      volatility: player.volatility,
    },
    [{
      opponentRating: opponent.rating,
      opponentRatingDeviation: opponent.ratingDeviation,
      score,
    }],
  );
  return {
    ...player,
    rating: fixed(updated.rating, 6),
    ratingDeviation: fixed(updated.ratingDeviation, 6),
    volatility: fixed(updated.volatility, 9),
    ratedGameCount: player.ratedGameCount + 1,
  };
}

function exactExistingPair(
  events: readonly ExistingEventRow[],
  game: TerminalGameRow,
  terminal: ClassifiedTerminal,
): boolean {
  if (events.length !== 2) return false;
  const expected = new Map([
    [game.black_player_key, terminal.outcomes.black],
    [game.white_player_key, terminal.outcomes.white],
  ]);
  return events.every((event) =>
    event.algorithm_version === GLICKO2_ALGORITHM_VERSION
    && expected.get(event.player_key) === event.outcome_kind
  ) && new Set(events.map(({ player_key }) => player_key)).size === 2;
}

/**
 * Finalizes one game as a single transactional Glicko-2 rating period.
 * The caller must provide its existing transaction client. This function
 * locks the game first, then both global rating rows in player-key order.
 * Bot-shaped or guest participants remain unrated until a separate immutable
 * calibrated-opponent contract exists on the game.
 */
export async function finalizeGameRatings(
  client: PoolClient,
  gameId: string,
): Promise<RatingFinalizationResult> {
  const game = (await client.query<TerminalGameRow>(
    `SELECT id,status,black_player_key,white_player_key,winner_key,
            finish_reason,result,finished_at
       FROM games WHERE id=$1 FOR UPDATE`,
    [gameId],
  )).rows[0];
  if (!game) return conflict("The terminal game is missing during rating finalization.");
  const terminal = classifyTerminal(game);

  const existing = await client.query<ExistingEventRow>(
    `SELECT player_key,outcome_kind,algorithm_version
       FROM game_glicko2_rating_events
      WHERE game_id=$1
      ORDER BY player_key
      FOR UPDATE`,
    [gameId],
  );
  if (existing.rowCount !== 0) {
    if (!exactExistingPair(existing.rows, game, terminal)) {
      return conflict("The game has partial or contradictory rating evidence.");
    }
    return { rated: true, kind: terminal.kind };
  }

  const registered = await client.query<RegisteredPlayerRow>(
    `SELECT id::text AS user_id,'user:' || id::text AS player_key
       FROM users
      WHERE 'user:' || id::text IN ($1::text,$2::text)
      ORDER BY player_key`,
    [game.black_player_key, game.white_player_key],
  );
  const registeredKeys = new Set(registered.rows.map(({ player_key }) => player_key));
  if (
    registered.rowCount !== 2
    || registeredKeys.size !== 2
    || !registeredKeys.has(game.black_player_key)
    || !registeredKeys.has(game.white_player_key)
  ) {
    return { rated: false, kind: "unrated" };
  }

  await client.query(
    `INSERT INTO player_glicko2_ratings
       (user_id,player_key,rating,rating_deviation,volatility,rated_game_count,
        algorithm_version,last_rating_period_at)
     SELECT player.user_id::uuid,player.player_key,$3,$4,$5,0,$6,statement_timestamp()
       FROM UNNEST($1::text[],$2::text[]) AS player(user_id,player_key)
     ON CONFLICT (player_key) DO NOTHING`,
    [
      registered.rows.map(({ user_id }) => user_id),
      registered.rows.map(({ player_key }) => player_key),
      GLICKO2_INITIAL_RATING,
      GLICKO2_INITIAL_RATING_DEVIATION,
      GLICKO2_INITIAL_VOLATILITY,
      GLICKO2_ALGORITHM_VERSION,
    ],
  );
  const locked = await client.query<GlobalRatingRow>(
    `SELECT player_key,rating,rating_deviation,volatility,rated_game_count,
            algorithm_version,last_rating_period_at
       FROM player_glicko2_ratings
      WHERE player_key IN ($1::text,$2::text)
      ORDER BY player_key
      FOR UPDATE`,
    [game.black_player_key, game.white_player_key],
  );
  if (locked.rowCount !== 2) {
    return conflict("Both global rating states must exist before finalization.");
  }
  const states = new Map(
    locked.rows.map((row) => {
      const state = stateFromRow(row);
      return [state.playerKey, state] as const;
    }),
  );
  const blackBefore = states.get(game.black_player_key);
  const whiteBefore = states.get(game.white_player_key);
  if (!blackBefore || !whiteBefore) {
    return conflict("The locked global rating states do not match the game.");
  }

  const blackAfter = terminal.kind === "rated"
    ? updatedState(blackBefore, whiteBefore, terminal.scores.black!)
    : blackBefore;
  const whiteAfter = terminal.kind === "rated"
    ? updatedState(whiteBefore, blackBefore, terminal.scores.white!)
    : whiteBefore;
  const period = (await client.query<{ rating_period_at: Date }>(
    "SELECT statement_timestamp() AS rating_period_at",
  )).rows[0]?.rating_period_at;
  if (!(period instanceof Date) || !Number.isFinite(period.getTime())) {
    return conflict("The rating period timestamp is unavailable.");
  }

  const players = [
    {
      color: "black" as const,
      before: blackBefore,
      after: { ...blackAfter, lastRatingPeriodAt: period },
      opponent: whiteBefore,
      opponentKey: game.white_player_key,
      outcome: terminal.outcomes.black,
      score: terminal.scores.black,
    },
    {
      color: "white" as const,
      before: whiteBefore,
      after: { ...whiteAfter, lastRatingPeriodAt: period },
      opponent: blackBefore,
      opponentKey: game.black_player_key,
      outcome: terminal.outcomes.white,
      score: terminal.scores.white,
    },
  ].sort((left, right) => left.before.playerKey.localeCompare(right.before.playerKey));

  for (const player of players) {
    const after = terminal.kind === "rated" ? player.after : player.before;
    await client.query(
      `INSERT INTO game_glicko2_rating_events
         (game_id,player_key,opponent_key,opponent_kind,player_color,
          outcome_kind,score,finish_reason,game_result,game_finished_at,
          opponent_rating,opponent_rating_deviation,
          rating_before,rating_after,rating_deviation_before,rating_deviation_after,
          volatility_before,volatility_after,rated_game_count_before,
          rated_game_count_after,last_rating_period_at_before,
          last_rating_period_at_after,algorithm_version,rating_period_at)
       VALUES ($1,$2,$3,'registered_human',$4,$5,$6,$7,$8,$9,$10,$11,$12,
               $13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
      [
        game.id,
        player.before.playerKey,
        player.opponentKey,
        player.color,
        player.outcome,
        player.score,
        game.finish_reason,
        game.result,
        game.finished_at,
        player.opponent.rating,
        player.opponent.ratingDeviation,
        player.before.rating,
        after.rating,
        player.before.ratingDeviation,
        after.ratingDeviation,
        player.before.volatility,
        after.volatility,
        player.before.ratedGameCount,
        after.ratedGameCount,
        player.before.lastRatingPeriodAt,
        terminal.kind === "rated" ? period : player.before.lastRatingPeriodAt,
        GLICKO2_ALGORITHM_VERSION,
        period,
      ],
    );
  }

  if (terminal.kind === "rated") {
    for (const player of players) {
      await client.query(
        `UPDATE player_glicko2_ratings
            SET rating=$2,rating_deviation=$3,volatility=$4,rated_game_count=$5,
                algorithm_version=$6,last_rating_period_at=$7,
                updated_at=statement_timestamp()
          WHERE player_key=$1`,
        [
          player.after.playerKey,
          player.after.rating,
          player.after.ratingDeviation,
          player.after.volatility,
          player.after.ratedGameCount,
          GLICKO2_ALGORITHM_VERSION,
          period,
        ],
      );
    }
  }
  return { rated: true, kind: terminal.kind };
}
