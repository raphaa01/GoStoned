import { NextRequest } from "next/server";
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

function parseBoardSize(value: string | null): BoardSize {
  const size = Number(value);
  return size === 9 || size === 13 ? size : 19;
}

export async function GET(request: NextRequest) {
  const boardSize = parseBoardSize(request.nextUrl.searchParams.get("boardSize"));

  try {
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.publicStats);
    const leaderboard = await getLeaderboard(boardSize);
    return noStoreJson({ ok: true, boardSize, leaderboard });
  } catch (error) {
    if (error instanceof RateLimitError) return apiError(error);
    console.error("Stats query failed:", error);
    return noStoreJson(
      { ok: false, boardSize, leaderboard: [], error: "Stats are temporarily unavailable." },
      { status: 503 },
    );
  }
}
