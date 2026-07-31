import { NextRequest, NextResponse } from "next/server";
import { apiError, noStoreJson } from "@/lib/api/responses";
import {
  consumeEphemeralIpPolicyRateLimit,
  RATE_LIMIT_POLICIES,
} from "@/lib/auth/rateLimit";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ActivitySummaryRow = {
  unfinished_games: string;
  games_started_last_24_hours: string;
  recently_waiting_players: string;
  observed_at: Date;
};

function publicCount(value: string): number | "under_5" {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error("Public activity contained an invalid count.");
  }
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("Public activity contained an invalid count.");
  }
  return count > 0 && count < 5 ? "under_5" : count;
}

function publicSnapshot(body: unknown) {
  const response = NextResponse.json(body);
  response.headers.set(
    "Cache-Control",
    "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
  );
  return response;
}

export async function GET(request: NextRequest) {
  try {
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.publicGameSummary);
    if (request.nextUrl.searchParams.size > 0) {
      return noStoreJson(
        {
          ok: false,
          error: "Activity snapshots do not accept query parameters.",
          code: "invalid_activity_request",
        },
        { status: 400 },
      );
    }
    const result = await query<ActivitySummaryRow>(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'active')::text AS unfinished_games,
         COUNT(*) FILTER (
           WHERE started_at >= NOW() - INTERVAL '24 hours'
         )::text AS games_started_last_24_hours,
         (
           SELECT COUNT(*)::text
             FROM matchmaking_queue
            WHERE status = 'waiting'
              AND updated_at >= NOW() - INTERVAL '5 minutes'
         ) AS recently_waiting_players,
         statement_timestamp() AS observed_at
       FROM games`,
    );
    const row = result.rows[0];
    return publicSnapshot({
      ok: true,
      summary: {
        unfinishedGames: publicCount(row.unfinished_games),
        gamesStartedLast24Hours: publicCount(row.games_started_last_24_hours),
        recentlyWaitingPlayers: publicCount(row.recently_waiting_players),
        observedAt: row.observed_at.toISOString(),
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
