import { NextRequest, NextResponse } from "next/server";
import { apiError, noStoreJson } from "@/lib/api/responses";
import {
  consumeEphemeralIpPolicyRateLimit,
  RATE_LIMIT_POLICIES,
  RateLimitError,
} from "@/lib/auth/rateLimit";
import { getLeaderboard } from "@/lib/stats/statsService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function publicLeaderboardJson(body: unknown) {
  const response = NextResponse.json(body);
  response.headers.set(
    "Cache-Control",
    "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
  );
  return response;
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.search !== "") {
    return noStoreJson(
      {
        ok: false,
        error: "Global leaderboard requests do not accept filters.",
        code: "invalid_stats_request",
      },
      { status: 400 },
    );
  }

  try {
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.publicStats);
    const snapshot = await getLeaderboard();
    return publicLeaderboardJson({
      ok: true,
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
