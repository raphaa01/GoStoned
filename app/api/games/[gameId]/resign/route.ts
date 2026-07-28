import { NextRequest } from "next/server";
import { noStoreJson } from "@/lib/api/responses";
import {
  consumeEphemeralIpPolicyRateLimit,
  consumePolicyRateLimit,
  RATE_LIMIT_POLICIES,
} from "@/lib/auth/rateLimit";
import { resolvePlayerKey } from "@/lib/auth/requestAuth";
import { assertExpectedPlayer } from "@/lib/auth/playerBindingServer";
import { resignGame } from "@/lib/game/gameService";
import {
  assertGameMutationMetadata,
  gameMutationRouteError,
} from "@/lib/game/gameMutationRequest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ gameId: string }> },
) {
  try {
    const { gameId } = await context.params;
    assertGameMutationMetadata(request, gameId, "none");
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    const playerKey = await resolvePlayerKey(request);
    assertExpectedPlayer(request, playerKey);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.resignBurst, playerKey);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.resign, playerKey);
    const game = await resignGame(gameId, playerKey);
    return noStoreJson({ ok: true, actor: playerKey, game });
  } catch (error) {
    return gameMutationRouteError(error);
  }
}
