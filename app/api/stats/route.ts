import { NextRequest, NextResponse } from "next/server";
import { apiError, noStoreJson } from "@/lib/api/responses";
import {
  consumeEphemeralIpPolicyRateLimit,
  RATE_LIMIT_POLICIES,
  RateLimitError,
} from "@/lib/auth/rateLimit";
import type { BoardSize } from "@/lib/game/types";
import { getLeaderboard } from "@/lib/stats/statsService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseBoardSize(request: NextRequest): BoardSize | null {
  if (request.nextUrl.search === "?boardSize=9") return 9;
  if (request.nextUrl.search === "?boardSize=13") return 13;
  if (request.nextUrl.search === "?boardSize=19") return 19;
  return null;
}

function publicLeaderboardJson(body: unknown) {
  const response = NextResponse.json(body);
  response.headers.set(
    "Cache-Control",
    "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
  );
  return response;
}

export async function GET(request: NextRequest) {
  const boardSize = parseBoardSize(request);
  if (boardSize === null) {
    return noStoreJson(
      {
        ok: false,
        error: "Stats requests require exactly one supported board size.",
        code: "invalid_stats_request",
      },
      { status: 400 },
    );
  }

  try {
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.publicStats);
    const snapshot = await getLeaderboard(boardSize);
    return publicLeaderboardJson({
      ok: true,
      boardSize,
      leaderboard: snapshot.entries,
      observedAt: snapshot.observedAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof RateLimitError) return apiError(error);
    console.error("Stats query failed:", error);
    return noStoreJson(
      {
        ok: false,
        error: "Stats are temporarily unavailable.",
        code: "internal_error",
      },
      { status: 503 },
    );
  }
}
