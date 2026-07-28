import { NextRequest } from "next/server";
import { apiError, noStoreJson } from "@/lib/api/responses";
import {
  consumeEphemeralIpPolicyRateLimit,
  consumeEphemeralPolicyRateLimit,
  RATE_LIMIT_POLICIES,
} from "@/lib/auth/rateLimit";
import { resolvePlayerKey } from "@/lib/auth/requestAuth";
import { getGameState } from "@/lib/game/gameService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ gameId: string }> },
) {
  try {
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    const playerKey = await resolvePlayerKey(request);
    consumeEphemeralPolicyRateLimit(request, RATE_LIMIT_POLICIES.gameRead, playerKey);
    const { gameId } = await context.params;
    const game = await getGameState(gameId, playerKey);
    return noStoreJson({ ok: true, game });
  } catch (error) {
    return apiError(error);
  }
}
