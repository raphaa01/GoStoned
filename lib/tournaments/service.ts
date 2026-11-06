import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { query, withTransaction } from "@/lib/db";
import { GameServiceError } from "@/lib/game/gameServiceError";
import { getGameState } from "@/lib/game/gameService";
import { getTimeControl } from "@/lib/game/timeControls";
import { DEFAULT_MATCH_RULES } from "@/lib/game/rulesPolicy";
import { assertNotRestricted } from "@/lib/moderation/communityService";
import {
  isPlayerPairBlocked,
  lockPlayerPair,
} from "@/lib/moderation/playerBlockService";
import { containsBannedChatContent } from "@/lib/moderation/chatModeration";
import {
  monthlyWindow,
  tournamentCategory,
  MONTHLY_GAMES,
  REQUIRED_RATED_GAMES,
  READY_WINDOW_MS,
  QUEUE_LEASE_MS,
  roundRobin,
  rankStandings,
  finalMonthlyStandings,
} from "./policy";
import type {
  Tournament,
  TournamentSettings,
  TournamentMatch,
  TournamentDetail,
  TournamentDashboard,
  Standing,
  TournamentTrophy,
} from "./types";

type TournamentRow = {
  id: string;
  kind: Tournament["kind"];
  host_id: string | null;
  name: string;
  code: string | null;
  month: string | null;
  category: number | null;
  format: Tournament["format"];
  board_size: Tournament["boardSize"];
  time_control: Tournament["timeControl"];
  max_players: number;
  status: Tournament["status"];
  round: number;
  starts_at: Date;
  ends_at: Date | null;
  member_count?: string;
};
type MatchRow = {
  id: string;
  round: number;
  black_id: string | null;
  white_id: string | null;
  black_ready: boolean;
  white_ready: boolean;
  ready_deadline: Date | null;
  status: TournamentMatch["status"];
  game_id: string | null;
  winner_id: string | null;
  result: string | null;
  black_name?: string;
  white_name?: string;
};
type Access = {
  rating: number;
  ratedGames: number;
  canHost: boolean;
  eligible: boolean;
};
const key = (id: string) => `user:${id}`;
function fail(code: string, status = 409): never {
  throw new GameServiceError(code.replaceAll("_", " "), status, code);
}
function serialize(row: TournamentRow): Tournament {
  return {
    id: row.id,
    kind: row.kind,
    hostId: row.host_id,
    name: row.name,
    code: row.code,
    month: row.month,
    category: row.category,
    format: row.format,
    boardSize: row.board_size,
    timeControl: row.time_control,
    maxPlayers: row.max_players,
    status: row.status,
    round: row.round,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at?.toISOString() ?? null,
    memberCount: Number(row.member_count ?? 0),
  };
}

async function access(
  client: PoolClient,
  userId: string,
  requireEligible = true,
): Promise<Access> {
  const result = await client.query<{
    rating: string;
    rated_games: number;
    can_host: boolean;
  }>(
    `SELECT COALESCE(r.rating,1200)::text AS rating,COALESCE(r.rated_game_count,0) AS rated_games,
      (NOT s.premium_hosting_enabled OR EXISTS (SELECT 1 FROM tournament_host_entitlements e
        WHERE e.user_id=$1 AND e.premium_until>statement_timestamp())) AS can_host
    FROM tournament_settings s LEFT JOIN player_glicko2_ratings r ON r.user_id=$1 WHERE s.id=true`,
    [userId],
  );
  const row = result.rows[0];
  if (!row)
    throw new Error("Tournament settings are missing; apply migration 059.");
  const eligible = row.rated_games >= REQUIRED_RATED_GAMES;
  if (requireEligible && !eligible) fail("tournament_games_required", 403);
  return {
    rating: Number(row.rating),
    ratedGames: row.rated_games,
    canHost: row.can_host,
    eligible,
  };
}

async function lockTournament(
  client: PoolClient,
  id: string,
): Promise<TournamentRow> {
  const result = await client.query<TournamentRow>(
    "SELECT * FROM tournaments WHERE id=$1 FOR UPDATE",
    [id],
  );
  if (!result.rows[0]) fail("tournament_not_found", 404);
  return result.rows[0];
}
async function member(client: PoolClient, id: string, userId: string) {
  const result = await client.query<{ queue_until: Date | null }>(
    "SELECT queue_until FROM tournament_members WHERE tournament_id=$1 AND user_id=$2",
    [id, userId],
  );
  return result.rows[0];
}
async function requireMember(client: PoolClient, id: string, userId: string) {
  const row = await member(client, id, userId);
  if (!row) fail("tournament_not_found", 404);
  return row;
}

async function standings(
  client: PoolClient,
  t: TournamentRow,
): Promise<Standing[]> {
  const result = await client.query<{
    user_id: string;
    name: string;
    rating: string;
    points: string;
    wins: string;
    losses: string;
    draws: string;
    played: string;
    tiebreak: string;
  }>(
    `WITH results AS (
      SELECT p.user_id,CASE WHEN m.black_id=p.user_id THEN m.white_id ELSE m.black_id END AS opponent,
        CASE WHEN m.winner_id=p.user_id THEN 1.0 WHEN m.winner_id IS NULL THEN 0.5 ELSE 0 END AS points,
        m.winner_id
      FROM tournament_members p JOIN tournament_matches m ON m.tournament_id=p.tournament_id
        AND p.user_id IN (m.black_id,m.white_id)
      WHERE p.tournament_id=$1 AND m.status='finished' AND m.result <> 'bye'
        AND ($2::timestamptz IS NULL OR m.finished_at < $2)
    ), totals AS (
      SELECT p.user_id,COALESCE(SUM(r.points),0) AS points,
        COUNT(*) FILTER (WHERE r.winner_id=p.user_id) AS wins,
        COUNT(*) FILTER (WHERE r.winner_id IS NOT NULL AND r.winner_id<>p.user_id) AS losses,
        COUNT(*) FILTER (WHERE r.opponent IS NOT NULL AND r.winner_id IS NULL) AS draws,
        COUNT(r.opponent) AS played
      FROM tournament_members p LEFT JOIN results r ON r.user_id=p.user_id
      WHERE p.tournament_id=$1 GROUP BY p.user_id
    ) SELECT p.user_id,COALESCE(NULLIF(u.display_name,''),u.username) AS name,
      p.rating_snapshot::text AS rating,totals.points::text,totals.wins::text,totals.losses::text,
      totals.draws::text,totals.played::text,
      COALESCE((SELECT SUM(o.points) FROM results r JOIN totals o ON o.user_id=r.opponent
        WHERE r.user_id=p.user_id),0)::text AS tiebreak
    FROM tournament_members p JOIN users u ON u.id=p.user_id JOIN totals ON totals.user_id=p.user_id
    WHERE p.tournament_id=$1`,
    [t.id, t.kind === "monthly" ? t.ends_at : null],
  );
  const rows = rankStandings(
    result.rows.map((r) => ({
      userId: r.user_id,
      name: r.name,
      rating: Number(r.rating),
      points: Number(r.points),
      wins: Number(r.wins),
      losses: Number(r.losses),
      draws: Number(r.draws),
      played: Number(r.played),
      tiebreak: Number(r.tiebreak),
    })),
  );
  if (t.kind === "monthly" && t.status === "finished")
    return finalMonthlyStandings(rows);
  if (t.format !== "knockout") return rows;
  // Elimination placement is determined by the last round reached, not Buchholz.
  const reached = await client.query<{
    user_id: string;
    last_round: number;
    champion: boolean;
  }>(
    `SELECT p.user_id,COALESCE(MAX(m.round),0) AS last_round,
      COALESCE(bool_or(m.round=$2 AND m.winner_id=p.user_id AND m.status='finished'),false) AS champion
     FROM tournament_members p LEFT JOIN tournament_matches m ON m.tournament_id=p.tournament_id
       AND p.user_id IN (m.black_id,m.white_id)
     WHERE p.tournament_id=$1 GROUP BY p.user_id`,
    [t.id, t.round],
  );
  const progress = new Map(reached.rows.map((r) => [r.user_id, r]));
  rows.sort(
    (a, b) =>
      Number(progress.get(b.userId)?.champion) -
        Number(progress.get(a.userId)?.champion) ||
      (progress.get(b.userId)?.last_round ?? 0) -
        (progress.get(a.userId)?.last_round ?? 0) ||
      a.userId.localeCompare(b.userId),
  );
  let place = 1;
  return rows.map((r, i) => {
    const current = progress.get(r.userId);
    const previous = i ? progress.get(rows[i - 1].userId) : undefined;
    if (
      previous &&
      (previous.last_round !== current?.last_round ||
        previous.champion !== current?.champion)
    )
      place = i + 1;
    return { ...r, place };
  });
}

async function insertPairs(
  client: PoolClient,
  t: TournamentRow,
  round: number,
  pairs: Array<[string, string | null]>,
  activate: boolean,
) {
  await client.query(
    `INSERT INTO tournament_matches
      (tournament_id,round,slot,black_id,white_id,status,winner_id,result,finished_at,ready_deadline)
      SELECT $1,$2,(pair.ordinality-1)::int,pair.black,pair.white,
        CASE WHEN pair.white IS NULL THEN 'finished' ELSE 'pending' END,
        CASE WHEN pair.white IS NULL THEN pair.black END,
        CASE WHEN pair.white IS NULL THEN 'bye' END,
        CASE WHEN pair.white IS NULL THEN statement_timestamp() END,
        CASE WHEN pair.white IS NOT NULL THEN $5::timestamptz END
      FROM unnest($3::uuid[],$4::uuid[]) WITH ORDINALITY AS pair(black,white,ordinality)`,
    [
      t.id,
      round,
      pairs.map(([black]) => black),
      pairs.map(([, white]) => white),
      activate ? new Date(Date.now() + READY_WINDOW_MS) : null,
    ],
  );
}

async function advance(client: PoolClient, t: TournamentRow): Promise<void> {
  if (t.status === "cancelled") return;
  if (
    t.kind === "monthly" &&
    t.status === "lobby" &&
    t.starts_at.getTime() <= Date.now()
  ) {
    await client.query("UPDATE tournaments SET status='running' WHERE id=$1", [
      t.id,
    ]);
    t.status = "running";
  }
  await client.query(
    `UPDATE tournament_matches m SET status='finished',
      winner_id=CASE WHEN g.winner_key='user:'||m.black_id::text THEN m.black_id
        WHEN g.winner_key='user:'||m.white_id::text THEN m.white_id ELSE NULL END,
      result=g.result,finished_at=g.finished_at
    FROM games g WHERE m.tournament_id=$1 AND m.game_id=g.id AND m.status='playing' AND g.status='finished'`,
    [t.id],
  );
  // Games may outlive a monthly deadline. Keep their visible state current
  // without reopening the event or changing its frozen standings/awards.
  if (t.status === "finished") return;
  await client.query(
    `UPDATE tournament_matches SET status=CASE WHEN $2='private' AND (black_ready OR white_ready) THEN 'finished' ELSE 'void' END,
      winner_id=CASE WHEN $2<>'private' THEN NULL WHEN black_ready THEN black_id WHEN white_ready THEN white_id ELSE NULL END,
      result=CASE WHEN $2='private' AND (black_ready OR white_ready) THEN 'forfeit' ELSE 'no_show' END,finished_at=statement_timestamp()
    WHERE tournament_id=$1 AND status='pending' AND ready_deadline<=statement_timestamp()`,
    [t.id, t.kind],
  );
  if (t.kind === "monthly") {
    if (t.ends_at!.getTime() <= Date.now()) {
      await client.query(
        "UPDATE tournaments SET status='finished' WHERE id=$1",
        [t.id],
      );
      await client.query(
        "UPDATE tournament_members SET queue_until=NULL WHERE tournament_id=$1 AND queue_until IS NOT NULL",
        [t.id],
      );
      await client.query(
        "UPDATE tournament_matches SET status='void',result='deadline' WHERE tournament_id=$1 AND status='pending'",
        [t.id],
      );
      t.status = "finished";
      const completed = rankStandings(
        (await standings(client, t)).filter((r) => r.played === MONTHLY_GAMES),
      );
      for (const row of completed.filter((r) => r.place <= 3)) {
        await client.query(
          `INSERT INTO tournament_trophies (tournament_id,user_id,place)
          VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [t.id, row.userId, row.place],
        );
      }
    }
    return;
  }
  if (t.status !== "running") return;
  const unfinished = await client.query(
    "SELECT 1 FROM tournament_matches WHERE tournament_id=$1 AND round=$2 AND status IN ('pending','playing') LIMIT 1",
    [t.id, t.round],
  );
  if (unfinished.rowCount) return;
  if (t.format === "knockout") {
    const winners = await client.query<{ winner_id: string }>(
      `SELECT winner_id FROM tournament_matches
      WHERE tournament_id=$1 AND round=$2 AND winner_id IS NOT NULL ORDER BY slot`,
      [t.id, t.round],
    );
    const ids = winners.rows.map((r) => r.winner_id);
    if (ids.length > 1) {
      t.round++;
      const pairs: Array<[string, string | null]> = [];
      for (let i = 0; i < ids.length; i += 2)
        pairs.push([ids[i], ids[i + 1] ?? null]);
      await insertPairs(client, t, t.round, pairs, true);
      await client.query("UPDATE tournaments SET round=$2 WHERE id=$1", [
        t.id,
        t.round,
      ]);
      return;
    }
  } else {
    const next = await client.query<{ round: number }>(
      "SELECT MIN(round) AS round FROM tournament_matches WHERE tournament_id=$1 AND round>$2",
      [t.id, t.round],
    );
    if (next.rows[0]?.round) {
      t.round = next.rows[0].round;
      await client.query("UPDATE tournaments SET round=$2 WHERE id=$1", [
        t.id,
        t.round,
      ]);
      await client.query(
        "UPDATE tournament_matches SET ready_deadline=$3 WHERE tournament_id=$1 AND round=$2 AND status='pending'",
        [t.id, t.round, new Date(Date.now() + READY_WINDOW_MS)],
      );
      return;
    }
  }
  await client.query(
    "UPDATE tournaments SET status='finished',ends_at=statement_timestamp() WHERE id=$1",
    [t.id],
  );
  t.status = "finished";
}

async function reconcileMonthly(userId: string) {
  const ids = await query<{ id: string }>(
    `SELECT t.id FROM tournaments t JOIN tournament_members p ON p.tournament_id=t.id
    WHERE p.user_id=$1 AND t.kind='monthly' AND t.ends_at<=statement_timestamp() AND t.status NOT IN ('finished','cancelled')
    ORDER BY t.ends_at LIMIT 12`,
    [userId],
  );
  for (const { id } of ids.rows)
    await withTransaction(async (c) => advance(c, await lockTournament(c, id)));
}

export async function getTournamentDashboard(
  userId: string,
): Promise<TournamentDashboard> {
  await reconcileMonthly(userId);
  return withTransaction(async (client) => {
    const rights = await access(client, userId, false);
    const window = monthlyWindow();
    if (rights.eligible) {
      for (let category = 0; category < 4; category++)
        await client.query(
          `INSERT INTO tournaments
        (kind,name,month,category,format,board_size,time_control,max_players,starts_at,ends_at,status)
        VALUES ('monthly',$1,$2,$3,'league',13,'rapid',32,$4,$5,$6) ON CONFLICT (month,category) DO NOTHING`,
          [
            `Monthly ${window.month}`,
            window.month,
            category,
            window.startsAt,
            window.endsAt,
            Date.now() >= window.startsAt.getTime() ? "running" : "lobby",
          ],
        );
    }
    const events = await client.query<
      TournamentRow & { joined: boolean; invited: boolean }
    >(
      `SELECT t.*,
      (SELECT COUNT(*) FROM tournament_members p WHERE p.tournament_id=t.id)::text AS member_count,
      EXISTS(SELECT 1 FROM tournament_members p WHERE p.tournament_id=t.id AND p.user_id=$1) AS joined,
      EXISTS(SELECT 1 FROM tournament_invitations i WHERE i.tournament_id=t.id AND i.user_id=$1) AS invited
      FROM tournaments t WHERE (t.month=$2 AND t.kind='monthly')
        OR EXISTS(SELECT 1 FROM tournament_members p WHERE p.tournament_id=t.id AND p.user_id=$1)
        OR (t.status='lobby' AND EXISTS(SELECT 1 FROM tournament_invitations i WHERE i.tournament_id=t.id AND i.user_id=$1))
      ORDER BY t.created_at DESC LIMIT 100`,
      [userId, window.month],
    );
    return {
      eligible: rights.eligible,
      ratedGames: rights.ratedGames,
      canHost: rights.canHost,
      category: tournamentCategory(rights.rating),
      monthly: events.rows
        .filter((r) => r.month === window.month)
        .map(serialize),
      mine: events.rows.filter((r) => r.joined).map(serialize),
      invitations: events.rows
        .filter((r) => r.invited && !r.joined && r.status === "lobby")
        .map(serialize),
    };
  });
}

export async function createTournament(
  userId: string,
  settings: TournamentSettings,
): Promise<string> {
  return withTransaction(async (client) => {
    const rights = await access(client, userId);
    await assertNotRestricted(key(userId), client);
    if (!rights.canHost) fail("premium_required", 403);
    if (containsBannedChatContent(settings.name))
      fail("invalid_tournament_name", 400);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `tournament-host:${userId}`,
    ]);
    const current = await client.query<{ count: string }>(
      "SELECT COUNT(*)::text FROM tournaments WHERE host_id=$1 AND status IN ('lobby','running')",
      [userId],
    );
    if (Number(current.rows[0].count) >= 3) fail("tournament_host_limit");
    const code = randomBytes(5).toString("hex").toUpperCase();
    const created = await client.query<{ id: string }>(
      `INSERT INTO tournaments
      (kind,host_id,name,code,format,board_size,time_control,max_players,starts_at)
      VALUES ('private',$1,$2,$3,$4,$5,$6,$7,statement_timestamp()) RETURNING id`,
      [
        userId,
        settings.name,
        code,
        settings.format,
        settings.boardSize,
        settings.timeControl,
        settings.maxPlayers,
      ],
    );
    const id = created.rows[0].id;
    await client.query(
      "INSERT INTO tournament_members (tournament_id,user_id,rating_snapshot) VALUES ($1,$2,$3)",
      [id, userId, rights.rating],
    );
    return id;
  });
}

export async function joinTournament(
  userId: string,
  target: { id?: string; code?: string },
): Promise<string> {
  const found = await query<{ id: string }>(
    "SELECT id FROM tournaments WHERE id=$1::uuid OR code=$2",
    [target.id ?? null, target.code ?? null],
  );
  if (!found.rows[0]) fail("tournament_not_found", 404);
  return withTransaction(async (client) => {
    const rights = await access(client, userId);
    await assertNotRestricted(key(userId), client);
    const t = await lockTournament(client, found.rows[0].id);
    await advance(client, t);
    if (await member(client, t.id, userId)) return t.id;
    if (t.kind === "private" && target.code !== t.code) {
      const invitation = await client.query(
        "SELECT 1 FROM tournament_invitations WHERE tournament_id=$1 AND user_id=$2",
        [t.id, userId],
      );
      if (!invitation.rowCount) fail("tournament_not_found", 404);
    }
    if (
      (t.kind === "private" && t.status !== "lobby") ||
      ["finished", "cancelled"].includes(t.status)
    )
      fail("tournament_closed");
    if (
      t.kind === "monthly" &&
      t.category !== tournamentCategory(rights.rating)
    )
      fail("tournament_category_mismatch", 403);
    if (t.kind === "monthly") {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`tournament-month:${t.month}:${userId}`],
      );
      const joined = await client.query(
        `SELECT 1 FROM tournament_members p JOIN tournaments t ON t.id=p.tournament_id
        WHERE p.user_id=$1 AND t.month=$2 LIMIT 1`,
        [userId, t.month],
      );
      if (joined.rowCount) fail("tournament_already_joined");
    } else {
      const count = await client.query<{ count: string }>(
        "SELECT COUNT(*)::text FROM tournament_members WHERE tournament_id=$1",
        [t.id],
      );
      if (Number(count.rows[0].count) >= t.max_players) fail("tournament_full");
    }
    await client.query(
      "INSERT INTO tournament_members (tournament_id,user_id,rating_snapshot) VALUES ($1,$2,$3)",
      [t.id, userId, rights.rating],
    );
    await client.query(
      "DELETE FROM tournament_invitations WHERE tournament_id=$1 AND user_id=$2",
      [t.id, userId],
    );
    return t.id;
  });
}

async function refreshGames(id: string, userId: string) {
  // Authorize before touching clocks. Reuse the authoritative game rulebook;
  // never infer a result from a browser clock or mutate games in tournament SQL.
  const result = await query<{ game_id: string; actor_key: string }>(
    `SELECT m.game_id,g.black_player_key AS actor_key
    FROM tournament_matches m JOIN games g ON g.id=m.game_id
    WHERE m.tournament_id=$1 AND m.status='playing' AND g.status='active'
      AND ((g.phase='play' AND g.turn_started_at +
        ((CASE WHEN g.to_move='black' THEN g.black_time_remaining_ms+g.black_periods_remaining*g.byo_yomi_seconds*1000
          ELSE g.white_time_remaining_ms+g.white_periods_remaining*g.byo_yomi_seconds*1000 END)::double precision * interval '1 millisecond')
        <=statement_timestamp())
        OR (g.phase='scoring' AND EXISTS(SELECT 1 FROM game_scoring_state s
          WHERE s.game_id=g.id AND s.expires_at<=statement_timestamp())))
      AND EXISTS(SELECT 1 FROM tournament_members p WHERE p.tournament_id=m.tournament_id AND p.user_id=$2)
    ORDER BY m.round,m.slot LIMIT 32`,
    [id, userId],
  );
  for (const row of result.rows) await getGameState(row.game_id, row.actor_key);
}

export async function getTournamentDetail(
  userId: string,
  id: string,
): Promise<TournamentDetail> {
  await refreshGames(id, userId);
  return withTransaction(async (client) => {
    await access(client, userId);
    const t = await lockTournament(client, id);
    const participation = await member(client, id, userId);
    if (t.kind === "private" && !participation)
      fail("tournament_not_found", 404);
    await advance(client, t);
    const ranked = await standings(client, t);
    const matches = await client.query<MatchRow>(
      `SELECT m.*,
      COALESCE(NULLIF(b.display_name,''),b.username,'—') AS black_name,
      COALESCE(NULLIF(w.display_name,''),w.username,'—') AS white_name
      FROM tournament_matches m LEFT JOIN users b ON b.id=m.black_id LEFT JOIN users w ON w.id=m.white_id
      WHERE m.tournament_id=$1 AND (m.round=$2 OR m.status='playing' OR $3 IN (m.black_id,m.white_id))
      ORDER BY m.round DESC,m.slot LIMIT 100`,
      [id, t.round, userId],
    );
    return {
      tournament: { ...serialize(t), memberCount: ranked.length },
      standings: ranked.filter((r, i) => i < 100 || r.userId === userId),
      matches: matches.rows.map((m) => ({
        id: m.id,
        round: m.round,
        blackId: m.black_id,
        whiteId: m.white_id,
        blackName: m.black_name!,
        whiteName: m.white_name!,
        blackReady: m.black_ready,
        whiteReady: m.white_ready,
        readyDeadline: m.ready_deadline?.toISOString() ?? null,
        status: m.status,
        gameId: m.game_id,
        winnerId: m.winner_id,
        result: m.result,
      })),
      joined: Boolean(participation),
      queueUntil: participation?.queue_until?.toISOString() ?? null,
      userId,
    };
  });
}

export async function updateTournament(
  userId: string,
  id: string,
  settings: TournamentSettings,
): Promise<void> {
  await withTransaction(async (client) => {
    await access(client, userId);
    await assertNotRestricted(key(userId), client);
    const t = await lockTournament(client, id);
    if (t.host_id !== userId) fail("tournament_host_required", 403);
    if (t.status !== "lobby") fail("tournament_settings_locked");
    if (containsBannedChatContent(settings.name))
      fail("invalid_tournament_name", 400);
    const count = await client.query<{ count: string }>(
      "SELECT COUNT(*)::text FROM tournament_members WHERE tournament_id=$1",
      [id],
    );
    if (Number(count.rows[0].count) > settings.maxPlayers)
      fail("tournament_capacity_too_small");
    await client.query(
      "UPDATE tournaments SET name=$2,board_size=$3,time_control=$4,max_players=$5,format=$6 WHERE id=$1",
      [
        id,
        settings.name,
        settings.boardSize,
        settings.timeControl,
        settings.maxPlayers,
        settings.format,
      ],
    );
  });
}

export async function startTournament(
  userId: string,
  id: string,
): Promise<void> {
  await withTransaction(async (client) => {
    await access(client, userId);
    await assertNotRestricted(key(userId), client);
    const t = await lockTournament(client, id);
    if (t.host_id !== userId) fail("tournament_host_required", 403);
    if (t.status === "running") return;
    if (t.status !== "lobby") fail("tournament_closed");
    const participants = await client.query<{ user_id: string }>(
      "SELECT user_id FROM tournament_members WHERE tournament_id=$1 ORDER BY rating_snapshot DESC,user_id",
      [id],
    );
    const ids = participants.rows.map((r) => r.user_id);
    if (ids.length < 2) fail("tournament_players_required");
    // Seed strongest against weakest in the first knockout round.
    if (t.format === "knockout") {
      const pairs: Array<[string, string | null]> = [];
      while (ids.length) {
        const first = ids.shift()!;
        pairs.push([first, ids.pop() ?? null]);
      }
      await insertPairs(client, t, 1, pairs, true);
    } else {
      for (const [index, pairs] of roundRobin(ids).entries())
        await insertPairs(client, t, index + 1, pairs, index === 0);
    }
    await client.query(
      "UPDATE tournaments SET status='running',round=1,starts_at=statement_timestamp() WHERE id=$1",
      [id],
    );
  });
}

async function lockPlayers(client: PoolClient, ids: string[]) {
  for (const id of [...ids].sort())
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `active-game-player:v1:${key(id)}`,
    ]);
}
async function assertAvailable(client: PoolClient, ids: string[]) {
  const keys = ids.map(key);
  const active = await client.query(
    "SELECT 1 FROM games WHERE status='active' AND (black_player_key=ANY($1::text[]) OR white_player_key=ANY($1::text[])) LIMIT 1",
    [keys],
  );
  if (active.rowCount) fail("player_in_game");
  const queued = await client.query(
    "SELECT 1 FROM matchmaking_queue WHERE player_key=ANY($1::text[]) AND status='waiting' AND updated_at>statement_timestamp()-interval '5 minutes' LIMIT 1",
    [keys],
  );
  if (queued.rowCount) fail("player_in_matchmaking");
  for (const id of ids) await assertNotRestricted(key(id), client);
}

export async function readyTournamentMatch(
  userId: string,
  id: string,
  matchId: string,
): Promise<string | null> {
  return withTransaction(async (client) => {
    await access(client, userId);
    const t = await lockTournament(client, id);
    await requireMember(client, id, userId);
    await advance(client, t);
    const found = await client.query<MatchRow>(
      "SELECT * FROM tournament_matches WHERE id=$1 AND tournament_id=$2",
      [matchId, id],
    );
    const m = found.rows[0];
    if (!m || ![m.black_id, m.white_id].includes(userId))
      fail("tournament_match_not_found", 404);
    if (m.status === "playing") return m.game_id;
    if (
      t.status !== "running" ||
      m.status !== "pending" ||
      !m.ready_deadline ||
      !m.black_id ||
      !m.white_id
    )
      fail("tournament_match_closed");
    await lockPlayers(client, [m.black_id, m.white_id]);
    await lockPlayerPair(client, key(m.black_id), key(m.white_id));
    await assertAvailable(client, [m.black_id, m.white_id]);
    if (await isPlayerPairBlocked(client, key(m.black_id), key(m.white_id)))
      fail("player_unavailable");
    const blackReady = m.black_ready || m.black_id === userId;
    const whiteReady = m.white_ready || m.white_id === userId;
    await client.query(
      "UPDATE tournament_matches SET black_ready=$2,white_ready=$3 WHERE id=$1",
      [matchId, blackReady, whiteReady],
    );
    if (!blackReady || !whiteReady) return null;
    const time = getTimeControl(t.time_control);
    const rules = DEFAULT_MATCH_RULES;
    const game = await client.query<{ id: string }>(
      `INSERT INTO games
      (game_type,board_size,black_player_key,white_player_key,time_control,
       rules,rules_profile,scoring_method,komi,handicap,phase,to_move,
       main_time_seconds,byo_yomi_periods,byo_yomi_seconds,black_time_remaining_ms,white_time_remaining_ms,
       black_periods_remaining,white_periods_remaining,turn_started_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'play','black',$11,$12,$13,$14,$14,$12,$12,statement_timestamp()) RETURNING id`,
      [
        t.kind === "private" ? "friendly" : "matchmaking",
        t.board_size,
        key(m.black_id),
        key(m.white_id),
        t.time_control,
        rules.ruleset,
        rules.rulesProfile,
        rules.scoringMethod,
        rules.komi,
        rules.handicap,
        time.mainTimeSeconds,
        time.byoYomiPeriods,
        time.byoYomiSeconds,
        time.mainTimeSeconds * 1000,
      ],
    );
    await client.query(
      "UPDATE tournament_matches SET status='playing',game_id=$2 WHERE id=$1",
      [matchId, game.rows[0].id],
    );
    await client.query(
      "UPDATE tournament_members SET queue_until=NULL WHERE tournament_id=$1 AND user_id=ANY($2::uuid[])",
      [id, [m.black_id, m.white_id]],
    );
    return game.rows[0].id;
  });
}

export async function queueMonthly(
  userId: string,
  id: string,
  waiting: boolean,
): Promise<void> {
  await refreshGames(id, userId);
  await withTransaction(async (client) => {
    await access(client, userId);
    const t = await lockTournament(client, id);
    await requireMember(client, id, userId);
    await advance(client, t);
    if (!waiting) {
      await client.query(
        "UPDATE tournament_members SET queue_until=NULL WHERE tournament_id=$1 AND user_id=$2",
        [id, userId],
      );
      return;
    }
    if (t.kind !== "monthly" || t.status !== "running")
      fail("tournament_not_running");
    await lockPlayers(client, [userId]);
    await assertAvailable(client, [userId]);
    const own = await client.query<{ count: string; busy: boolean }>(
      `SELECT
      COUNT(*) FILTER (WHERE status IN ('finished','pending','playing'))::text AS count,
      COALESCE(bool_or(status IN ('pending','playing')),false) AS busy
      FROM tournament_matches WHERE tournament_id=$1 AND $2 IN (black_id,white_id)`,
      [id, userId],
    );
    if (own.rows[0].busy) return;
    if (Number(own.rows[0].count) >= MONTHLY_GAMES)
      fail("tournament_game_limit");
    await client.query(
      "UPDATE tournament_members SET queue_until=$3 WHERE tournament_id=$1 AND user_id=$2",
      [id, userId, new Date(Date.now() + QUEUE_LEASE_MS)],
    );
    const opponents = await client.query<{ user_id: string }>(
      `SELECT p.user_id FROM tournament_members p
      WHERE p.tournament_id=$1 AND p.user_id<>$2 AND p.queue_until>statement_timestamp()
      AND NOT EXISTS(SELECT 1 FROM tournament_matches m WHERE m.tournament_id=$1
        AND p.user_id IN (m.black_id,m.white_id) AND m.status IN ('pending','playing','finished')
        AND (m.status IN ('pending','playing') OR $2 IN (m.black_id,m.white_id)))
      AND (SELECT COUNT(*) FROM tournament_matches m WHERE m.tournament_id=$1 AND p.user_id IN (m.black_id,m.white_id)
        AND m.status='finished')<$3
      ORDER BY p.queue_until,p.user_id LIMIT 20`,
      [id, userId, MONTHLY_GAMES],
    );
    for (const candidate of opponents.rows) {
      // The event row serializes tournament pairings. Try the other player's
      // activity lock without waiting while holding our own to avoid a cycle
      // with ordinary matchmaking/friend invitations.
      const lock = await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked",
        [`active-game-player:v1:${key(candidate.user_id)}`],
      );
      if (!lock.rows[0].locked) continue;
      const unavailable = await client.query(
        `SELECT 1 WHERE
        EXISTS(SELECT 1 FROM games WHERE status='active' AND $1 IN (black_player_key,white_player_key))
        OR EXISTS(SELECT 1 FROM matchmaking_queue WHERE player_key=$1 AND status='waiting' AND updated_at>statement_timestamp()-interval '5 minutes')
        OR EXISTS(SELECT 1 FROM player_restrictions WHERE player_key=$1 AND restricted_until>statement_timestamp())`,
        [key(candidate.user_id)],
      );
      if (
        unavailable.rowCount ||
        (await isPlayerPairBlocked(client, key(userId), key(candidate.user_id)))
      )
        continue;
      const round = t.round + 1;
      const pair: [string, string] =
        randomBytes(1)[0] % 2
          ? [userId, candidate.user_id]
          : [candidate.user_id, userId];
      await insertPairs(client, t, round, [pair], true);
      await client.query("UPDATE tournaments SET round=$2 WHERE id=$1", [
        id,
        round,
      ]);
      await client.query(
        "UPDATE tournament_members SET queue_until=NULL WHERE tournament_id=$1 AND user_id=ANY($2::uuid[])",
        [id, pair],
      );
      return;
    }
  });
}

export async function inviteTournamentFriend(
  userId: string,
  id: string,
  friendId: string,
): Promise<void> {
  await withTransaction(async (client) => {
    await access(client, userId);
    await assertNotRestricted(key(userId), client);
    const t = await lockTournament(client, id);
    if (t.host_id !== userId) fail("tournament_host_required", 403);
    if (t.status !== "lobby") fail("tournament_closed");
    const friendship = await client.query(
      `SELECT 1 FROM friendships WHERE status='accepted'
      AND ((requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1))`,
      [userId, friendId],
    );
    if (
      !friendship.rowCount ||
      (await isPlayerPairBlocked(client, key(userId), key(friendId)))
    )
      fail("player_unavailable", 404);
    await client.query(
      "INSERT INTO tournament_invitations (tournament_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
      [id, friendId],
    );
  });
}

export async function leaveTournament(
  userId: string,
  id: string,
): Promise<void> {
  await withTransaction(async (client) => {
    const t = await lockTournament(client, id);
    await requireMember(client, id, userId);
    if (t.status !== "lobby" || t.kind !== "private")
      fail("tournament_already_started");
    if (t.host_id === userId) {
      await client.query(
        "UPDATE tournaments SET status='cancelled',ends_at=statement_timestamp() WHERE id=$1",
        [id],
      );
    } else
      await client.query(
        "DELETE FROM tournament_members WHERE tournament_id=$1 AND user_id=$2",
        [id, userId],
      );
  });
}

export async function tournamentGame(
  userId: string,
  gameId: string,
  watch = false,
) {
  const result = await query<{ tournament_id: string; black_id: string }>(
    `SELECT m.tournament_id,m.black_id
    FROM tournament_matches m JOIN tournament_members p ON p.tournament_id=m.tournament_id AND p.user_id=$1
    WHERE m.game_id=$2 AND ($3 OR $1 IN (m.black_id,m.white_id))`,
    [userId, gameId, watch],
  );
  const row = result.rows[0];
  if (!row) fail("tournament_game_not_found", 404);
  return {
    tournamentId: row.tournament_id,
    ...(watch && row.black_id
      ? { game: await getGameState(gameId, key(row.black_id)) }
      : {}),
  };
}

export async function getTournamentNotice(userId: string) {
  const active = await query<{ id: string }>(
    `SELECT t.id FROM tournaments t JOIN tournament_members p ON p.tournament_id=t.id
    WHERE p.user_id=$1 AND t.status='running' ORDER BY t.created_at LIMIT 10`,
    [userId],
  );
  for (const { id } of active.rows) {
    await refreshGames(id, userId);
    await withTransaction(async (client) =>
      advance(client, await lockTournament(client, id)),
    );
  }
  const result = await query<{
    tournament_id: string;
    match_id: string;
    game_id: string | null;
    status: string;
    name: string;
  }>(
    `SELECT
    m.tournament_id,m.id AS match_id,m.game_id,m.status,t.name FROM tournament_matches m
    JOIN tournaments t ON t.id=m.tournament_id
    JOIN tournament_members p ON p.tournament_id=t.id AND p.user_id=$1
    WHERE $1 IN (m.black_id,m.white_id) AND t.status='running'
      AND (m.status='playing' OR (m.status='pending' AND m.ready_deadline>statement_timestamp()))
    ORDER BY m.ready_deadline NULLS LAST LIMIT 1`,
    [userId],
  );
  return result.rows[0]
    ? {
        tournamentId: result.rows[0].tournament_id,
        matchId: result.rows[0].match_id,
        gameId: result.rows[0].game_id,
        status: result.rows[0].status,
        name: result.rows[0].name,
      }
    : null;
}

export async function getTrophies(
  userId: string,
  own: boolean,
): Promise<TournamentTrophy[]> {
  await reconcileMonthly(userId);
  const result = await query<{
    tournament_id: string;
    name: string;
    month: string | null;
    category: number | null;
    place: number;
    displayed: boolean;
  }>(
    `SELECT
    a.tournament_id,t.name,t.month,t.category,a.place,a.displayed FROM tournament_trophies a JOIN tournaments t ON t.id=a.tournament_id
    WHERE a.user_id=$1 AND ($2 OR a.displayed) ORDER BY a.awarded_at DESC LIMIT 50`,
    [userId, own],
  );
  return result.rows.map((r) => ({
    tournamentId: r.tournament_id,
    name: r.name,
    month: r.month,
    category: r.category,
    place: r.place,
    displayed: r.displayed,
  }));
}
export async function displayTrophy(
  userId: string,
  id: string,
  displayed: boolean,
) {
  const result = await query(
    "UPDATE tournament_trophies SET displayed=$3 WHERE user_id=$1 AND tournament_id=$2",
    [userId, id, displayed],
  );
  if (!result.rowCount) fail("tournament_trophy_not_found", 404);
}
