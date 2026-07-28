import { NextRequest } from "next/server";
import { apiError, noStoreJson } from "@/lib/api/responses";
import {
  consumeEphemeralIpPolicyRateLimit,
  consumeEphemeralPolicyRateLimit,
  RATE_LIMIT_POLICIES,
} from "@/lib/auth/rateLimit";
import { resolvePlayerKey } from "@/lib/auth/requestAuth";
import { gamePollResponseBody, parseKnownGameVersion } from "@/lib/game/gamePolling";
import { pollGameState } from "@/lib/game/gameService";

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
    const knownVersion = parseKnownGameVersion(request.nextUrl.searchParams);
    const result = await pollGameState(gameId, playerKey, knownVersion);
    return noStoreJson(gamePollResponseBody(result));
  } catch (error) {
    return apiError(error);
  }
}
