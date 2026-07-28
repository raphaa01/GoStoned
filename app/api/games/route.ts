import { NextRequest } from "next/server";
import { apiError, noStoreJson } from "@/lib/api/responses";
import {
  consumeEphemeralIpPolicyRateLimit,
  RATE_LIMIT_POLICIES,
} from "@/lib/auth/rateLimit";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type GameSummaryRow = {
  active_9: string;
  active_13: string;
  active_19: string;
  active_games: string;
  games_today: string;
  waiting_players: string;
};

export async function GET(request: NextRequest) {
  try {
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.publicGameSummary);
    const result = await query<GameSummaryRow>(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'active' AND board_size = 9)::text AS active_9,
         COUNT(*) FILTER (WHERE status = 'active' AND board_size = 13)::text AS active_13,
         COUNT(*) FILTER (WHERE status = 'active' AND board_size = 19)::text AS active_19,
         COUNT(*) FILTER (WHERE status = 'active')::text AS active_games,
         COUNT(*) FILTER (WHERE started_at >= CURRENT_DATE)::text AS games_today,
         (
           SELECT COUNT(*)::text
             FROM matchmaking_queue
            WHERE status = 'waiting'
              AND updated_at >= NOW() - INTERVAL '5 minutes'
         ) AS waiting_players
       FROM games`,
    );
    const row = result.rows[0];
    const activeGames = Number(row.active_games);
    const waitingPlayers = Number(row.waiting_players);
    return noStoreJson({
      ok: true,
      summary: {
        activeByBoard: {
          9: Number(row.active_9),
          13: Number(row.active_13),
          19: Number(row.active_19),
        },
        activeGames,
        gamesToday: Number(row.games_today),
        playersOnline: activeGames * 2 + waitingPlayers,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
