import { NextRequest } from "next/server";
import { apiError, noStoreJson } from "@/lib/api/responses";
import {
  consumeEphemeralIpPolicyRateLimit,
  consumePolicyRateLimit,
  RATE_LIMIT_POLICIES,
} from "@/lib/auth/rateLimit";
import { resolvePlayerKey } from "@/lib/auth/requestAuth";
import { EXPECTED_PLAYER_HEADER } from "@/lib/auth/playerBinding";
import { GameServiceError, resignGame } from "@/lib/game/gameService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ gameId: string }> },
) {
  try {
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    const playerKey = await resolvePlayerKey(request);
    if (request.headers.get(EXPECTED_PLAYER_HEADER) !== playerKey) {
      throw new GameServiceError(
        "The player session changed. Refresh before resigning.",
        409,
        "identity_changed",
      );
    }
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.resignBurst, playerKey);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.resign, playerKey);
    const { gameId } = await context.params;
    const game = await resignGame(gameId, playerKey);
    return noStoreJson({ ok: true, game });
  } catch (error) {
    return apiError(error);
  }
}
