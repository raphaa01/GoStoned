import type { PoolClient } from "pg";
import { query, withTransaction } from "@/lib/db";
import type { TournamentLeaderboards } from "./types";

const rapidEvents = "kind='monthly' AND monthly_mode='rapid' AND rapid_game_limit=10";

// A league point remains decisive within a category. The signed margin contributes
// up to 49 score units in either direction, and the class multiplies both terms.
const score = `round((100 * (3 * wins + draws)
  + 49 * margin / (50 + abs(margin))) * (category + 1), 2)`;

const liveScores = `
  events AS (
    SELECT id,category,ends_at FROM tournaments WHERE month=$2 AND ${rapidEvents}
      AND starts_at<=statement_timestamp() AND ends_at>statement_timestamp()
      AND status IN ('lobby','running')
  ), outcomes AS (
    SELECT t.id AS tournament_id,t.category,p.user_id,
      g.winner_key='user:'||p.user_id::text AS won,
      g.winner_key IS NULL AS drew,
      CASE WHEN g.result ~ '^[BW][+][0-9]+([.][0-9]+)?$'
        THEN substring(g.result FROM 3)::numeric *
          CASE WHEN g.winner_key='user:'||p.user_id::text THEN 1 ELSE -1 END
        ELSE 0 END AS margin
    FROM events t JOIN tournament_matches m ON m.tournament_id=t.id
    JOIN games g ON g.id=m.game_id AND g.status='finished' AND g.finished_at<t.ends_at
    CROSS JOIN LATERAL (VALUES (m.black_id),(m.white_id)) p(user_id)
    JOIN tournament_members member ON member.tournament_id=t.id AND member.user_id=p.user_id
    WHERE NOT member.withdrawn AND g.result IS NOT NULL
  ), totals AS (
    SELECT tournament_id,category,user_id, count(*) FILTER (WHERE won)::int AS wins,
      count(*) FILTER (WHERE drew)::int AS draws,SUM(margin) AS margin
    FROM outcomes GROUP BY tournament_id,category,user_id
  ), scores AS (
    SELECT user_id,wins,${score} AS score FROM totals
  ), global_ranks AS (
    SELECT *,rank() OVER (ORDER BY score DESC) AS place FROM scores
  )`;

const historicalScores = `global_ranks AS (
  SELECT r.user_id,r.wins,r.score,r.place FROM tournament_rapid_rankings r
  JOIN tournaments t ON t.id=r.tournament_id WHERE t.month=$2
    AND EXISTS (SELECT 1 FROM tournaments own_t JOIN tournament_members own
      ON own.tournament_id=own_t.id WHERE own.user_id=$1 AND own_t.month=$2
        AND own_t.kind='monthly' AND own_t.monthly_mode='rapid' AND own_t.status='finished')
)`;

export async function readRapidRankings(userId: string, month: string, history: boolean): Promise<TournamentLeaderboards> {
  const rows = await query<{
    scope: "worldwide" | "friends";
    user_id: string;
    wins: number;
    score: string;
    place: string;
    name: string;
  }>(`WITH ${history ? historicalScores : liveScores}, friends AS (
    SELECT CASE WHEN requester_id=$1 THEN addressee_id ELSE requester_id END AS user_id
    FROM friendships WHERE status='accepted' AND $1 IN (requester_id,addressee_id)
    AND NOT EXISTS (SELECT 1 FROM player_blocks b WHERE
      (b.blocker_key='user:'||requester_id::text AND b.blocked_key='user:'||addressee_id::text)
      OR (b.blocker_key='user:'||addressee_id::text AND b.blocked_key='user:'||requester_id::text))
    UNION SELECT $1::uuid
  ), ranked AS (
    SELECT 'worldwide' AS scope, user_id,wins,score,place FROM global_ranks
    UNION ALL
    SELECT 'friends',r.user_id,r.wins,r.score,rank() OVER (ORDER BY r.score DESC)
    FROM global_ranks r JOIN friends f ON f.user_id=r.user_id
  ), numbered AS (
    SELECT *,row_number() OVER (PARTITION BY scope ORDER BY place,user_id) AS row_number FROM ranked
  )
  SELECT n.*,COALESCE(NULLIF(u.display_name,''),u.username) AS name
  FROM numbered n JOIN users u ON u.id=n.user_id
  WHERE row_number<=50 OR n.user_id=$1 ORDER BY scope,place,user_id`, [userId,month]);
  const result: TournamentLeaderboards = { worldwide: [], friends: [] };
  for (const row of rows.rows) {
    result[row.scope].push({
      userId: row.user_id, name: row.name, place: Number(row.place),
      points: Number(row.score), wins: row.wins,
    });
  }
  return result;
}

async function saveMonth(client: PoolClient, month: string) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('rapid-rankings:' || $1,0))", [month]);
  const marked = await client.query(`UPDATE tournaments SET rapid_rankings_finalized=true
    WHERE month=$1 AND ${rapidEvents} AND status='finished' AND NOT rapid_rankings_finalized
    AND NOT EXISTS (SELECT 1 FROM tournaments pending WHERE pending.month=$1 AND ${rapidEvents}
      AND pending.status NOT IN ('finished','cancelled'))`, [month]);
  if (!marked.rowCount) return;
  await client.query(`WITH totals AS (
    SELECT t.id AS tournament_id,t.category,p.user_id,
      (p.final_standing->>'wins')::int AS wins,(p.final_standing->>'draws')::int AS draws,
      COALESCE((p.final_standing->>'margin')::numeric,0) AS margin
    FROM tournaments t JOIN tournament_members p ON p.tournament_id=t.id
    WHERE t.month=$1 AND ${rapidEvents} AND t.status='finished'
      AND NOT p.withdrawn AND (p.final_standing->>'played')::int>0
  ), scores AS (
    SELECT tournament_id,user_id,wins,${score} AS score FROM totals
  )
  INSERT INTO tournament_rapid_rankings(tournament_id,user_id,wins,score,place)
  SELECT tournament_id,user_id,wins,score,rank() OVER (ORDER BY score DESC) FROM scores
  ON CONFLICT DO NOTHING`, [month]);
}

export async function saveFinishedRapidRankings() {
  const months = await query<{ month: string }>(`SELECT DISTINCT month FROM tournaments t
    WHERE ${rapidEvents} AND status='finished' AND NOT rapid_rankings_finalized
    AND NOT EXISTS (SELECT 1 FROM tournaments pending WHERE pending.month=t.month AND ${rapidEvents}
      AND pending.status NOT IN ('finished','cancelled')) ORDER BY month LIMIT 16`);
  for (const { month } of months.rows)
    await withTransaction(client => saveMonth(client, month));
}
