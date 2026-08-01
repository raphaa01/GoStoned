import { NextRequest } from "next/server";
import { apiError, noStoreJson } from "@/lib/api/responses";
import {
  consumeEphemeralIpPolicyRateLimit,
  consumeEphemeralPolicyRateLimit,
  consumePolicyRateLimit,
  RATE_LIMIT_POLICIES,
} from "@/lib/auth/rateLimit";
import { resolvePlayerKey } from "@/lib/auth/requestAuth";
import { assertExpectedPlayer } from "@/lib/auth/playerBindingServer";
import { isTimeControlId } from "@/lib/game/timeControls";
import {
  cancelMatchmaking,
  getMatchmakingStatus,
  isBoardSize,
  joinMatchmaking,
} from "@/lib/matchmaking/matchmakingService";
import {
  assertMatchmakingMutationMetadata,
  invalidMatchmakingRequest,
  matchmakingMutationRouteError,
  readMatchmakingJoinRequest,
} from "@/lib/matchmaking/matchmakingMutationRequest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    const playerKey = await resolvePlayerKey(request);
    assertExpectedPlayer(request, playerKey);
    consumeEphemeralPolicyRateLimit(request, RATE_LIMIT_POLICIES.matchmakingRead, playerKey);
    const matchmaking = await getMatchmakingStatus(playerKey, {
      allowOnDemandBot: true,
    });
    return noStoreJson({ ok: true, actor: playerKey, matchmaking });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertMatchmakingMutationMetadata(request, "json");
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    const playerKey = await resolvePlayerKey(request);
    assertExpectedPlayer(request, playerKey);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.matchmakingJoinBurst, playerKey);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.matchmakingJoin, playerKey);
    const input = await readMatchmakingJoinRequest(request);
    if (!isBoardSize(input.boardSize) || !isTimeControlId(input.timeControl)) {
      throw invalidMatchmakingRequest();
    }
    const matchmaking = await joinMatchmaking(
      playerKey,
      input.boardSize,
      input.timeControl,
    );
    return noStoreJson({ ok: true, actor: playerKey, matchmaking });
  } catch (error) {
    return matchmakingMutationRouteError(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    assertMatchmakingMutationMetadata(request, "none");
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    const playerKey = await resolvePlayerKey(request);
    assertExpectedPlayer(request, playerKey);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.matchmakingCancel, playerKey);
    const matchmaking = await cancelMatchmaking(playerKey);
    return noStoreJson({ ok: true, actor: playerKey, matchmaking });
  } catch (error) {
    return matchmakingMutationRouteError(error);
  }
}
