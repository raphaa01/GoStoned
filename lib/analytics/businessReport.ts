import "server-only";
import type { PoolClient, QueryResultRow } from "pg";
import { withReadOnlyTransaction } from "@/lib/db";

type CountValue = string | number;

type SummaryRow = QueryResultRow & {
  accounts_total: CountValue;
  accounts_today: CountValue;
  accounts_7d: CountValue;
  accounts_30d: CountValue;
  games_total: CountValue;
  games_today: CountValue;
  games_7d: CountValue;
  games_30d: CountValue;
  games_active: CountValue;
  games_finished: CountValue;
  moves_total: CountValue;
};

type DailyRow = QueryResultRow & {
  day: string;
  accounts: CountValue;
  games: CountValue;
  finished_games: CountValue;
};

type BreakdownRow = QueryResultRow & {
  dimension: "board" | "clock" | "kind" | "rules";
  value: string;
  count: CountValue;
};

type AccountRow = QueryResultRow & {
  username: string;
  created_at: Date | string;
  games: CountValue;
  last_game_at: Date | string | null;
};

type GameRow = QueryResultRow & {
  id: string;
  started_at: Date | string;
  finished_at: Date | string | null;
  status: string;
  board_size: number;
  time_control: string;
  game_type: string;
  rules: string;
  moves: CountValue;
  black_name: string;
  white_name: string;
};

export type BusinessDay = {
  date: string;
  accounts: number;
  games: number;
  finishedGames: number;
};

export type BusinessBreakdown = {
  label: string;
  count: number;
};

export type RecentAccount = {
  username: string;
  createdAt: string;
  games: number;
  lastGameAt: string | null;
};

export type RecentGame = {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  boardSize: number;
  timeControl: string;
  gameType: string;
  rules: string;
  moves: number;
  blackName: string;
  whiteName: string;
};

export type BusinessAnalyticsReport = {
  summary: {
    accountsTotal: number;
    accountsToday: number;
    accounts7d: number;
    accounts30d: number;
    gamesTotal: number;
    gamesToday: number;
    games7d: number;
    games30d: number;
    gamesActive: number;
    gamesFinished: number;
    movesTotal: number;
  };
  days: BusinessDay[];
  boardSizes: BusinessBreakdown[];
  timeControls: BusinessBreakdown[];
  gameTypes: BusinessBreakdown[];
  rules: BusinessBreakdown[];
  recentAccounts: RecentAccount[];
  recentGames: RecentGame[];
};

function count(value: CountValue | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

function byDimension(rows: BreakdownRow[], dimension: BreakdownRow["dimension"]): BusinessBreakdown[] {
  return rows
    .filter((row) => row.dimension === dimension)
    .map((row) => ({ label: row.value, count: count(row.count) }));
}

async function readBusinessAnalytics(client: PoolClient): Promise<BusinessAnalyticsReport> {
  const summaryResult = await client.query<SummaryRow>(
    `SELECT
       (SELECT COUNT(*) FROM users) AS accounts_total,
       (SELECT COUNT(*) FROM users WHERE created_at >= CURRENT_DATE) AS accounts_today,
       (SELECT COUNT(*) FROM users WHERE created_at >= CURRENT_DATE - INTERVAL '6 days') AS accounts_7d,
       (SELECT COUNT(*) FROM users WHERE created_at >= CURRENT_DATE - INTERVAL '29 days') AS accounts_30d,
       (SELECT COUNT(*) FROM games) AS games_total,
       (SELECT COUNT(*) FROM games WHERE started_at >= CURRENT_DATE) AS games_today,
       (SELECT COUNT(*) FROM games WHERE started_at >= CURRENT_DATE - INTERVAL '6 days') AS games_7d,
       (SELECT COUNT(*) FROM games WHERE started_at >= CURRENT_DATE - INTERVAL '29 days') AS games_30d,
       (SELECT COUNT(*) FROM games WHERE status = 'active') AS games_active,
       (SELECT COUNT(*) FROM games WHERE status = 'finished') AS games_finished,
       (SELECT COUNT(*) FROM moves) AS moves_total`,
  );
  const dailyResult = await client.query<DailyRow>(
    `WITH days AS (
       SELECT generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, INTERVAL '1 day')::date AS day
     )
     SELECT TO_CHAR(days.day, 'YYYY-MM-DD') AS day,
            (SELECT COUNT(*) FROM users WHERE created_at >= days.day AND created_at < days.day + 1) AS accounts,
            (SELECT COUNT(*) FROM games WHERE started_at >= days.day AND started_at < days.day + 1) AS games,
            (SELECT COUNT(*) FROM games WHERE finished_at >= days.day AND finished_at < days.day + 1) AS finished_games
       FROM days
      ORDER BY days.day`,
  );
  const breakdownResult = await client.query<BreakdownRow>(
    `SELECT 'board' AS dimension, board_size::text AS value, COUNT(*) AS count
       FROM games WHERE started_at >= CURRENT_DATE - INTERVAL '29 days'
      GROUP BY board_size
     UNION ALL
     SELECT 'clock', time_control, COUNT(*)
       FROM games WHERE started_at >= CURRENT_DATE - INTERVAL '29 days'
      GROUP BY time_control
     UNION ALL
     SELECT 'kind', game_type, COUNT(*)
       FROM games WHERE started_at >= CURRENT_DATE - INTERVAL '29 days'
      GROUP BY game_type
     UNION ALL
     SELECT 'rules', rules, COUNT(*)
       FROM games WHERE started_at >= CURRENT_DATE - INTERVAL '29 days'
      GROUP BY rules
     ORDER BY dimension, count DESC, value`,
  );
  const recentAccountsResult = await client.query<AccountRow>(
    `SELECT account.username, account.created_at, COUNT(game_record.id) AS games,
            MAX(game_record.started_at) AS last_game_at
       FROM users AS account
       LEFT JOIN games AS game_record
         ON game_record.black_player_key = 'user:' || account.id::text
         OR game_record.white_player_key = 'user:' || account.id::text
      GROUP BY account.id, account.username, account.created_at
      ORDER BY account.created_at DESC, account.id
      LIMIT 20`,
  );
  const recentGamesResult = await client.query<GameRow>(
    `SELECT game_record.id, game_record.started_at, game_record.finished_at,
            game_record.status, game_record.board_size, game_record.time_control,
            game_record.game_type, game_record.rules, COUNT(move.id) AS moves,
            COALESCE(black_user.display_name, black_user.username,
              CASE WHEN game_record.black_player_key LIKE 'bot:%' THEN 'Computer' ELSE 'Gast' END) AS black_name,
            COALESCE(white_user.display_name, white_user.username,
              CASE WHEN game_record.white_player_key LIKE 'bot:%' THEN 'Computer' ELSE 'Gast' END) AS white_name
       FROM games AS game_record
       LEFT JOIN users AS black_user
         ON game_record.black_player_key = 'user:' || black_user.id::text
       LEFT JOIN users AS white_user
         ON game_record.white_player_key = 'user:' || white_user.id::text
       LEFT JOIN moves AS move ON move.game_id = game_record.id
      GROUP BY game_record.id, black_user.display_name, black_user.username,
               white_user.display_name, white_user.username
      ORDER BY game_record.started_at DESC, game_record.id
      LIMIT 20`,
  );

  const summary = summaryResult.rows[0];
  if (!summary) throw new Error("Business analytics summary is unavailable.");
  const breakdownRows = breakdownResult.rows;

  return {
    summary: {
      accountsTotal: count(summary.accounts_total),
      accountsToday: count(summary.accounts_today),
      accounts7d: count(summary.accounts_7d),
      accounts30d: count(summary.accounts_30d),
      gamesTotal: count(summary.games_total),
      gamesToday: count(summary.games_today),
      games7d: count(summary.games_7d),
      games30d: count(summary.games_30d),
      gamesActive: count(summary.games_active),
      gamesFinished: count(summary.games_finished),
      movesTotal: count(summary.moves_total),
    },
    days: dailyResult.rows.map((row) => ({
      date: row.day,
      accounts: count(row.accounts),
      games: count(row.games),
      finishedGames: count(row.finished_games),
    })),
    boardSizes: byDimension(breakdownRows, "board"),
    timeControls: byDimension(breakdownRows, "clock"),
    gameTypes: byDimension(breakdownRows, "kind"),
    rules: byDimension(breakdownRows, "rules"),
    recentAccounts: recentAccountsResult.rows.map((row) => ({
      username: row.username,
      createdAt: iso(row.created_at),
      games: count(row.games),
      lastGameAt: row.last_game_at ? iso(row.last_game_at) : null,
    })),
    recentGames: recentGamesResult.rows.map((row) => ({
      id: row.id,
      startedAt: iso(row.started_at),
      finishedAt: row.finished_at ? iso(row.finished_at) : null,
      status: row.status,
      boardSize: row.board_size,
      timeControl: row.time_control,
      gameType: row.game_type,
      rules: row.rules,
      moves: count(row.moves),
      blackName: row.black_name,
      whiteName: row.white_name,
    })),
  };
}

export function getBusinessAnalyticsReport(): Promise<BusinessAnalyticsReport> {
  return withReadOnlyTransaction(readBusinessAnalytics);
}
