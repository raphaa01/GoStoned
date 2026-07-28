import { NextRequest } from "next/server";
import { apiError, noStoreJson } from "@/lib/api/responses";
import {
  consumeEphemeralIpPolicyRateLimit,
  consumePolicyRateLimit,
  RATE_LIMIT_POLICIES,
} from "@/lib/auth/rateLimit";
import { resolvePlayerKey } from "@/lib/auth/requestAuth";
import { resignGame } from "@/lib/game/gameService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ gameId: string }> },
) {
  try {
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    const playerKey = await resolvePlayerKey(request);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.resignBurst, playerKey);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.resign, playerKey);
    const { gameId } = await context.params;
    const game = await resignGame(gameId, playerKey);
    return noStoreJson({ ok: true, game });
  } catch (error) {
    return apiError(error);
  }
}
