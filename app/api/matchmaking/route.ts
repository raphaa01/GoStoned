import { NextRequest } from "next/server";
import { apiError, noStoreJson } from "@/lib/api/responses";
import {
  consumeEphemeralIpPolicyRateLimit,
  consumeEphemeralPolicyRateLimit,
  consumePolicyRateLimit,
  RATE_LIMIT_POLICIES,
} from "@/lib/auth/rateLimit";
import { resolvePlayerKey } from "@/lib/auth/requestAuth";
import { isTimeControlId } from "@/lib/game/timeControls";
import { GameServiceError } from "@/lib/game/gameService";
import {
  cancelMatchmaking,
  getMatchmakingStatus,
  isBoardSize,
  joinMatchmaking,
} from "@/lib/matchmaking/matchmakingService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    const playerKey = await resolvePlayerKey(request);
    consumeEphemeralPolicyRateLimit(request, RATE_LIMIT_POLICIES.matchmakingRead, playerKey);
    const matchmaking = await getMatchmakingStatus(playerKey);
    return noStoreJson({ ok: true, matchmaking });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    const playerKey = await resolvePlayerKey(request);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.matchmakingJoinBurst, playerKey);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.matchmakingJoin, playerKey);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new GameServiceError(
        "The matchmaking request must contain valid JSON.",
        400,
        "invalid_matchmaking_request",
      );
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new GameServiceError(
        "A valid board size and time control are required.",
        400,
        "invalid_matchmaking_request",
      );
    }
    const input = body as {
      boardSize?: unknown;
      timeControl?: unknown;
    };
    if (!isBoardSize(input.boardSize) || !isTimeControlId(input.timeControl)) {
      return noStoreJson(
        {
          ok: false,
          error: "A valid board size and time control are required.",
          code: "invalid_matchmaking_request",
        },
        { status: 400 },
      );
    }
    const matchmaking = await joinMatchmaking(
      playerKey,
      input.boardSize,
      input.timeControl,
    );
    return noStoreJson({ ok: true, matchmaking });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    const playerKey = await resolvePlayerKey(request);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.matchmakingCancel, playerKey);
    const matchmaking = await cancelMatchmaking(playerKey);
    return noStoreJson({ ok: true, matchmaking });
  } catch (error) {
    return apiError(error);
  }
}
