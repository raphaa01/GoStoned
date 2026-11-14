import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { closePool, getPool, query } from "../lib/db";
import { getDatabaseUrl, isUnambiguousLocalDatabase } from "../lib/env";
import { assertSmokeDatabaseIdentity } from "../lib/smokeDatabase";
import { getGameState, resignGame, submitMove } from "../lib/game/gameService";
import { roundRobin } from "../lib/tournaments/policy";
import * as tournaments from "../lib/tournaments/service";

async function main() {
  assert.ok(
    isUnambiguousLocalDatabase(getDatabaseUrl()),
    "Tournament smoke is local-only.",
  );
  await assertSmokeDatabaseIdentity(getPool());
  const users: string[] = [];
  const events: string[] = [];
  const games: string[] = [];
  const key = (id: string) => `user:${id}`;
  const settings = {
    name: "Club tournament",
    boardSize: 9 as const,
    timeControl: "blitz" as const,
    maxPlayers: 4,
    format: "round_robin" as const,
  };
  async function newUser(count = 10, rating = 1200) {
    const result = await query<{ id: string }>(
      "INSERT INTO users(username,display_name) VALUES ($1,$2) RETURNING id",
      [
        `ts_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
        `Player ${users.length + 1}`,
      ],
    );
    const id = result.rows[0].id;
    users.push(id);
    await query(
      `INSERT INTO player_glicko2_ratings
      (player_key,user_id,rating,rating_deviation,volatility,rated_game_count,algorithm_version,last_rating_period_at)
      VALUES ($1,$2,$3,120,0.06,$4,'glicko2-v1-tau-0.5',statement_timestamp())`,
      [key(id), id, rating, count],
    );
    return id;
  }
  async function playReady(
    id: string,
    matchId: string,
    black: string,
    white: string,
  ) {
    assert.equal(
      await tournaments.readyTournamentMatch(black, id, matchId),
      null,
      "Clocks must not start before both ready.",
    );
    const game = await tournaments.readyTournamentMatch(white, id, matchId);
    assert.ok(game);
    games.push(game);
    const duplicate = await Promise.all([
      tournaments.readyTournamentMatch(black, id, matchId),
      tournaments.readyTournamentMatch(white, id, matchId),
    ]);
    assert.deepEqual(
      duplicate,
      [game, game],
      "Ready retries must return the same game.",
    );
    return game;
  }
  try {
    for (let i = 0; i < 8; i++) await newUser();
    const [host, a, b, c, d, e, outsider] = users;
    const novice = await newUser(9);
    assert.equal(
      (await tournaments.getTournamentDashboard(novice)).eligible,
      false,
    );
    await assert.rejects(tournaments.createTournament(novice, settings), {
      code: "tournament_games_required",
    });
    const id = await tournaments.createTournament(host, settings);
    events.push(id);
    const lobby = await tournaments.getTournamentDetail(host, id);
    const code = lobby.tournament.code!;
    await assert.rejects(tournaments.getTournamentDetail(outsider, id), {
      code: "tournament_not_found",
    });
    await assert.rejects(tournaments.joinTournament(a, { id }), {
      code: "tournament_not_found",
    });
    await query(
      "INSERT INTO friendships(requester_id,addressee_id,status,responded_at) VALUES ($1,$2,'accepted',statement_timestamp())",
      [host, a],
    );
    await tournaments.inviteTournamentFriend(host, id, a);
    assert(
      (await tournaments.getTournamentDashboard(a)).invitations.some(
        (t) => t.id === id,
      ),
    );
    await tournaments.joinTournament(a, { id });
    await tournaments.joinTournament(b, { code });
    const joins = await Promise.allSettled([
      tournaments.joinTournament(c, { code }),
      tournaments.joinTournament(d, { code }),
    ]);
    assert.equal(
      joins.filter((r) => r.status === "fulfilled").length,
      1,
      "Capacity must hold under concurrent joins.",
    );
    const full = await tournaments.getTournamentDetail(host, id);
    assert.equal(full.tournament.memberCount, 4);
    await assert.rejects(tournaments.updateTournament(a, id, settings), {
      code: "tournament_host_required",
    });
    await assert.rejects(
      tournaments.updateTournament(host, id, { ...settings, maxPlayers: 2 }),
      { code: "tournament_capacity_too_small" },
    );
    await Promise.all([
      tournaments.startTournament(host, id),
      tournaments.startTournament(host, id),
    ]);
    let current = await tournaments.getTournamentDetail(host, id);
    const firstRound = current.matches.filter((m) => m.round === 1);
    assert.equal(firstRound.length, 2);
    const match = firstRound[0];
    const game = await playReady(id, match.id, match.blackId!, match.whiteId!);
    const watcher = full.standings.find(
      (r) => r.userId !== match.blackId && r.userId !== match.whiteId,
    )!.userId;
    assert((await tournaments.tournamentGame(watcher, game, true)).game);
    await assert.rejects(tournaments.tournamentGame(outsider, game, true), {
      code: "tournament_game_not_found",
    });
    await assert.rejects(getGameState(game, key(watcher)), {
      code: "not_participant",
    });
    await assert.rejects(
      submitMove(game, key(watcher), { x: 0, y: 0, expectedVersion: 0 }),
    );
    const other = firstRound[1];
    const otherGame = await playReady(
      id,
      other.id,
      other.blackId!,
      other.whiteId!,
    );
    await Promise.all([
      resignGame(game, key(match.blackId!)),
      resignGame(otherGame, key(other.blackId!)),
    ]);
    const rated = await query<{ count: string }>(
      "SELECT COUNT(*)::text FROM game_glicko2_rating_events WHERE game_id=ANY($1::uuid[])",
      [games],
    );
    assert.equal(
      rated.rows[0].count,
      "0",
      "Private games must never change ratings.",
    );
    current = await tournaments.getTournamentDetail(host, id);
    assert.equal(current.tournament.round, 2);
    const secondRound = current.matches.find((m) => m.round === 2)!;
    await tournaments.readyTournamentMatch(
      secondRound.blackId!,
      id,
      secondRound.id,
    );
    await query(
      "UPDATE tournament_matches SET ready_deadline=statement_timestamp()-interval '1 second' WHERE tournament_id=$1 AND round=2",
      [id],
    );
    current = await tournaments.getTournamentDetail(host, id);
    assert.equal(current.tournament.round, 3);
    await query(
      "UPDATE tournament_matches SET ready_deadline=statement_timestamp()-interval '1 second' WHERE tournament_id=$1 AND round=3",
      [id],
    );
    current = await tournaments.getTournamentDetail(host, id);
    assert.equal(current.tournament.status, "finished");
    assert.equal(
      current.standings.reduce((sum, r) => sum + r.wins, 0),
      3,
      "Only two played wins and one no-show win count.",
    );
    console.log(
      "Private lobby, invitations, capacity races, simultaneous games, spectators, unranked results and no-shows passed.",
    );

    const knockout = await tournaments.createTournament(host, {
      ...settings,
      name: "Knockout",
      format: "knockout",
      maxPlayers: 8,
    });
    events.push(knockout);
    const koCode = (await tournaments.getTournamentDetail(host, knockout))
      .tournament.code!;
    for (const user of [a, b, c, d])
      await tournaments.joinTournament(user, { code: koCode });
    await tournaments.startTournament(host, knockout);
    for (let round = 0; round < 5; round++) {
      const detail = await tournaments.getTournamentDetail(host, knockout);
      if (detail.tournament.status === "finished") break;
      for (const m of detail.matches.filter(
        (m) => m.status === "pending" && m.readyDeadline,
      )) {
        const gameId = await playReady(knockout, m.id, m.blackId!, m.whiteId!);
        await resignGame(gameId, key(m.whiteId!));
      }
    }
    const koFinal = await tournaments.getTournamentDetail(host, knockout);
    assert.equal(koFinal.tournament.status, "finished");
    assert.equal(koFinal.standings.filter((r) => r.place === 1).length, 1);
    console.log(
      "Five-player knockout, byes, round progression and elimination standings passed.",
    );

    const dashboard = await tournaments.getTournamentDashboard(host);
    const monthly = dashboard.monthly.find(
      (t) => t.category === dashboard.category,
    )!;
    events.push(...dashboard.monthly.map((t) => t.id));
    const leaguePlayers = [host, a, b, c, d, e];
    for (let i = 0; i < 5; i++) leaguePlayers.push(await newUser());
    for (const user of leaguePlayers)
      await tournaments.joinTournament(user, { id: monthly.id });
    await query(
      "UPDATE tournaments SET starts_at=statement_timestamp()-interval '1 hour',ends_at=statement_timestamp()+interval '1 hour' WHERE id=$1",
      [monthly.id],
    );
    // A missing opponent must never consume one of the ten rated games.
    await tournaments.queueMonthly(host, monthly.id, true);
    await tournaments.queueMonthly(a, monthly.id, true);
    let league = await tournaments.getTournamentDetail(host, monthly.id);
    const expired = league.matches.find((m) => m.status === "pending")!;
    await tournaments.readyTournamentMatch(host, monthly.id, expired.id);
    await query(
      "UPDATE tournament_matches SET ready_deadline=statement_timestamp()-interval '1 second' WHERE id=$1",
      [expired.id],
    );
    league = await tournaments.getTournamentDetail(host, monthly.id);
    assert.equal(league.standings.find((r) => r.userId === host)?.played, 0);
    for (const round of roundRobin(leaguePlayers))
      for (const [black, white] of round) {
        if (!white) continue;
        await tournaments.queueMonthly(black, monthly.id, true);
        await tournaments.queueMonthly(white, monthly.id, true);
        const detail = await tournaments.getTournamentDetail(black, monthly.id);
        const pairing = detail.matches.find(
          (m) =>
            m.status === "pending" && [m.blackId, m.whiteId].includes(black),
        );
        assert.ok(pairing);
        const gameId = await playReady(
          monthly.id,
          pairing.id,
          pairing.blackId!,
          pairing.whiteId!,
        );
        const result = await resignGame(gameId, key(white));
        assert.equal(
          result.rated,
          true,
          "Monthly games use the existing human rating finalizer.",
        );
        await tournaments.getTournamentDetail(black, monthly.id);
      }
    league = await tournaments.getTournamentDetail(host, monthly.id);
    assert(league.standings.every((r) => r.played === 10));
    await assert.rejects(tournaments.queueMonthly(host, monthly.id, true), {
      code: "tournament_game_limit",
    });
    const lateOpponent = users[7];
    for (const user of [outsider, lateOpponent])
      await tournaments.joinTournament(user, { id: monthly.id });
    await tournaments.queueMonthly(outsider, monthly.id, true);
    await tournaments.queueMonthly(lateOpponent, monthly.id, true);
    const latePairing = (
      await tournaments.getTournamentDetail(outsider, monthly.id)
    ).matches.find((m) => m.status === "pending")!;
    const lateGame = await playReady(
      monthly.id,
      latePairing.id,
      latePairing.blackId!,
      latePairing.whiteId!,
    );
    await query(
      "UPDATE tournaments SET ends_at=statement_timestamp() WHERE id=$1",
      [monthly.id],
    );
    await Promise.all([
      tournaments.getTournamentDetail(host, monthly.id),
      tournaments.getTournamentDetail(a, monthly.id),
    ]);
    const awards = await query<{ user_id: string; place: number }>(
      "SELECT user_id,place FROM tournament_trophies WHERE tournament_id=$1 ORDER BY user_id",
      [monthly.id],
    );
    assert(awards.rows.length > 0);
    assert(awards.rows.every((r) => r.place <= 3));
    await resignGame(lateGame, key(outsider));
    const afterDeadline = await tournaments.getTournamentDetail(
      outsider,
      monthly.id,
    );
    assert.equal(afterDeadline.tournament.status, "finished");
    assert.equal(
      afterDeadline.matches.find((m) => m.id === latePairing.id)?.status,
      "finished",
    );
    assert.equal(
      afterDeadline.standings.find((r) => r.userId === outsider)?.played,
      0,
    );
    assert.equal(
      afterDeadline.standings.find((r) => r.userId === lateOpponent)?.points,
      0,
    );
    assert.deepEqual(
      (
        await query(
          "SELECT user_id,place FROM tournament_trophies WHERE tournament_id=$1 ORDER BY user_id",
          [monthly.id],
        )
      ).rows,
      awards.rows,
    );
    const winner = awards.rows[0].user_id;
    await tournaments.displayTrophy(winner, monthly.id, false);
    assert.equal((await tournaments.getTrophies(winner, false)).length, 0);
    assert.equal((await tournaments.getTrophies(winner, true)).length, 1);
    const leaderboards = await tournaments.getRapidLeaderboards(winner);
    assert.equal(
      leaderboards.worldwide.find((row) => row.userId === winner)?.points,
      (4 - awards.rows[0].place) * 2,
    );
    assert(leaderboards.friends.some((row) => row.userId === winner));
    assert(
      (await tournaments.getTournamentHistory(winner, true)).some(
        (entry) =>
          entry.tournament.id === monthly.id &&
          entry.standing.place === awards.rows[0].place &&
          entry.standing.played === 10,
      ),
    );
    console.log(
      "Monthly queue, no-show recovery, 55 rated games, ten-game cap, deadline, idempotent awards and profile display passed.",
    );

    // Rapid rankings are local; the search pool still spans the category.
    const grouped = (
      await query<{
        id: string;
      }>(`INSERT INTO tournaments(kind,name,month,category,format,board_size,time_control,max_players,starts_at,ends_at,status)
      VALUES ('monthly','Grouped Rapid','2050-04',1,'league',13,'rapid',32,statement_timestamp()-interval '1 hour',statement_timestamp()+interval '1 day','running') RETURNING id`)
    ).rows[0].id;
    events.push(grouped);
    const groupedPlayers: string[] = [];
    for (let i = 0; i < 26; i++) {
      const u = await newUser();
      groupedPlayers.push(u);
      await tournaments.joinTournament(u, { id: grouped });
    }
    const firstGroup = await tournaments.getTournamentDetail(
      groupedPlayers[0],
      grouped,
    );
    const secondGroup = await tournaments.getTournamentDetail(
      groupedPlayers[25],
      grouped,
    );
    assert.equal(firstGroup.standings.length, 24);
    assert.equal(secondGroup.standings.length, 2);
    assert.equal(secondGroup.group, 2);
    assert.equal(secondGroup.standings[0].place, 1);
    await tournaments.queueMonthly(groupedPlayers[0], grouped, true);
    await tournaments.queueMonthly(groupedPlayers[25], grouped, true);
    const crossGroup = (
      await tournaments.getTournamentDetail(groupedPlayers[25], grouped)
    ).matches.find((m) => m.status === "pending");
    assert(
      crossGroup &&
        [crossGroup.blackId, crossGroup.whiteId].includes(groupedPlayers[0]),
    );
    console.log("Rapid groups capped at 24; cross-group matchmaking passed.");

    const classicPlayers: string[] = [];
    for (let i = 0; i < 6; i++)
      classicPlayers.push(await newUser(10, 1700 + i));
    async function classicEvent(month: string, players = classicPlayers) {
      const id = (
        await query<{ id: string }>(
          `INSERT INTO tournaments(kind,name,month,category,format,board_size,time_control,max_players,starts_at,ends_at,monthly_mode,schedule_hour)
        VALUES ('monthly','Monthly Classic test',$1,2,'league',19,'classic',32,statement_timestamp()+interval '1 day',statement_timestamp()+interval '8 days','classic',16) RETURNING id`,
          [month],
        )
      ).rows[0].id;
      events.push(id);
      if (players.length)
        await assert.rejects(tournaments.joinTournament(players[0], { id }), {
          code: "invalid_tournament_request",
        });
      for (const u of players)
        await tournaments.joinTournament(u, { id, acceptSchedule: true });
      return id;
    }
    const classic = await classicEvent("2050-05");
    await assert.rejects(tournaments.joinTournament(host, { id: classic }), {
      code: "tournament_category_mismatch",
    });
    await assert.rejects(
      tournaments.queueMonthly(classicPlayers[0], classic, true),
      { code: "tournament_not_running" },
    );
    // Five rounds with real games; fast-forward only the isolated event schedule.
    const opponents = new Set<string>();
    for (let round = 1; round <= 5; round++) {
      await query(
        "UPDATE tournament_matches SET finished_at=statement_timestamp()-interval '10 minutes' WHERE tournament_id=$1 AND status IN ('finished','void')",
        [classic],
      );
      await query(
        "UPDATE tournaments SET starts_at=statement_timestamp()-($2::int*interval '1 day')-interval '1 minute' WHERE id=$1",
        [classic, round - 1],
      );
      const detail = await tournaments.getTournamentDetail(
        classicPlayers[0],
        classic,
      );
      assert.equal(detail.tournament.round, round);
      for (const match of detail.matches.filter(
        (m) => m.round === round && m.status === "pending",
      )) {
        const pair = [match.blackId!, match.whiteId!].sort().join(":");
        assert(!opponents.has(pair));
        opponents.add(pair);
        const remaining = Date.parse(match.readyDeadline!) - Date.now();
        assert(remaining > 230000 && remaining < 245000);
        const gameId = await playReady(
          classic,
          match.id,
          match.blackId!,
          match.whiteId!,
        );
        const clock = await getGameState(gameId, key(match.blackId!));
        assert.equal(clock.boardSize, 19);
        assert.equal(clock.clock.mainTimeSeconds, 3600);
        assert.equal(clock.clock.byoYomiPeriods, 3);
        assert.equal(clock.clock.byoYomiSeconds, 30);
        assert.equal(
          (await resignGame(gameId, key(match.whiteId!))).rated,
          true,
        );
      }
      await tournaments.getTournamentDetail(classicPlayers[0], classic);
    }
    const classicFinal = await tournaments.getTournamentDetail(
      classicPlayers[0],
      classic,
    );
    assert.equal(classicFinal.tournament.status, "finished");
    assert(classicFinal.standings.every((r) => r.played === 5));
    assert(
      (
        await query(
          "SELECT 1 FROM tournament_trophies WHERE tournament_id=$1",
          [classic],
        )
      ).rowCount! > 0,
    );
    const missed = await classicEvent("2050-06");
    // A late check-in commits attendance exactly once even though it is rejected.
    for (let round = 1; round <= 2; round++) {
      await query(
        "UPDATE tournament_matches SET finished_at=statement_timestamp()-interval '10 minutes' WHERE tournament_id=$1",
        [missed],
      );
      await query(
        "UPDATE tournaments SET starts_at=statement_timestamp()-($2::int*interval '1 day')-interval '1 minute' WHERE id=$1",
        [missed, round - 1],
      );
      const detail = await tournaments.getTournamentDetail(
        classicPlayers[0],
        missed,
      );
      const pair = detail.matches.find(
        (m) =>
          m.round === round &&
          m.status === "pending" &&
          [m.blackId, m.whiteId].includes(classicPlayers[0]),
      )!;
      const opponent =
        pair.blackId === classicPlayers[0] ? pair.whiteId! : pair.blackId!;
      await tournaments.readyTournamentMatch(opponent, missed, pair.id);
      await query(
        "UPDATE tournament_matches SET ready_deadline=statement_timestamp()-interval '1 second' WHERE tournament_id=$1 AND round=$2",
        [missed, round],
      );
      await assert.rejects(
        tournaments.readyTournamentMatch(classicPlayers[0], missed, pair.id),
        { code: "tournament_match_closed" },
      );
      const after = await tournaments.getTournamentDetail(
        classicPlayers[0],
        missed,
      );
      assert.equal(after.noShows, round);
      assert.equal(after.withdrawn, round === 2);
      assert.equal(
        after.standings.find((r) => r.userId === classicPlayers[0])!.points,
        0,
      );
      assert.equal(
        after.standings.find((r) => r.userId === opponent)!.wins >= 1,
        true,
      );
    }
    assert.equal(
      (
        await query(
          "SELECT 1 FROM tournament_classic_penalties WHERE user_id=$1 AND blocked_month=$2",
          [classicPlayers[0], "2050-07"],
        )
      ).rowCount,
      1,
    );
    const nextClassic = await classicEvent("2050-07", []);
    await assert.rejects(
      tournaments.joinTournament(classicPlayers[0], {
        id: nextClassic,
        acceptSchedule: true,
      }),
      { code: "tournament_classic_suspended" },
    );
    const freshClassic = await newUser(10, 1700);
    await tournaments.joinTournament(freshClassic, {
      id: nextClassic,
      acceptSchedule: true,
    });
    await tournaments.leaveTournament(freshClassic, nextClassic);
    assert.equal(
      (await tournaments.getTournamentDetail(freshClassic, nextClassic)).joined,
      false,
    );
    await query(
      "UPDATE tournaments SET starts_at=statement_timestamp()-interval '1 minute' WHERE id=$1",
      [nextClassic],
    );
    assert.equal(
      (await tournaments.getTournamentDetail(freshClassic, nextClassic))
        .tournament.status,
      "cancelled",
    );
    assert.equal(
      (
        await query(
          "SELECT 1 FROM tournament_matches WHERE tournament_id=$1 AND game_id IS NOT NULL",
          [missed],
        )
      ).rowCount,
      0,
    );
    const largePlayers = [classicPlayers[0], freshClassic];
    for (let i = 0; i < 31; i++) largePlayers.push(await newUser(10, 1700));
    const largeClassic = await classicEvent("2050-08", largePlayers);
    await query(
      "UPDATE tournaments SET starts_at=statement_timestamp()-interval '1 minute' WHERE id=$1",
      [largeClassic],
    );
    await tournaments.getTournamentDetail(largePlayers[0], largeClassic);
    const fields = await query<{ leaderboard_group: number; count: string }>(
      "SELECT leaderboard_group,COUNT(*)::text FROM tournament_members WHERE tournament_id=$1 GROUP BY leaderboard_group ORDER BY leaderboard_group",
      [largeClassic],
    );
    assert.deepEqual(
      fields.rows.map((r) => Number(r.count)),
      [17, 16],
    );
    const fieldTwo = (
      await query<{ user_id: string }>(
        "SELECT user_id FROM tournament_members WHERE tournament_id=$1 AND leaderboard_group=2 LIMIT 1",
        [largeClassic],
      )
    ).rows[0].user_id;
    const fieldDetail = await tournaments.getTournamentDetail(
      fieldTwo,
      largeClassic,
    );
    assert.equal(fieldDetail.group, 2);
    assert.equal(fieldDetail.standings.length, 16);
    assert(
      fieldDetail.matches.every((m) =>
        [m.blackId, m.whiteId].every(
          (u) =>
            u === null || fieldDetail.standings.some((s) => s.userId === u),
        ),
      ),
    );
    console.log(
      "Classic 19x19/60min/3x30, five real rated rounds, trophies, no-show idempotency, next-month suspension, withdrawal and minimum field passed.",
    );

    await query("UPDATE tournament_settings SET premium_hosting_enabled=true");
    await assert.rejects(tournaments.createTournament(outsider, settings), {
      code: "premium_required",
    });
    await query(
      "INSERT INTO tournament_host_entitlements(user_id,premium_until) VALUES ($1,statement_timestamp()+interval '1 day')",
      [outsider],
    );
    const premium = await tournaments.createTournament(outsider, settings);
    events.push(premium);
    console.log("Future Premium enforcement passed.");
  } finally {
    await query("UPDATE tournament_settings SET premium_hosting_enabled=false");
    if (events.length)
      await query("DELETE FROM tournaments WHERE id=ANY($1::uuid[])", [events]);
    // Rated audit evidence is immutable, including in the isolated smoke DB.
    if (games.length)
      await query(
        `DELETE FROM games g WHERE id=ANY($1::uuid[])
      AND NOT EXISTS(SELECT 1 FROM game_glicko2_rating_events e WHERE e.game_id=g.id)`,
        [games],
      );
    if (users.length)
      await query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
    await closePool();
  }
}
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
