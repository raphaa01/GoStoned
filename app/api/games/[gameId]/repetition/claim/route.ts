import { NextRequest } from "next/server";
import { noStoreJson } from "@/lib/api/responses";
import {
  consumeEphemeralIpPolicyRateLimit,
  consumePolicyRateLimit,
  RATE_LIMIT_POLICIES,
} from "@/lib/auth/rateLimit";
import { resolvePlayerKey } from "@/lib/auth/requestAuth";
import { assertExpectedPlayer } from "@/lib/auth/playerBindingServer";
import { claimJapaneseWholeBoardRepetition } from "@/lib/game/gameService";
import { MAX_PERSISTED_GAME_VERSION } from "@/lib/game/gamePolling";
import {
  assertGameMutationMetadata,
  gameMutationRouteError,
  invalidGameMutationRequest,
  readGameMutationJson,
} from "@/lib/game/gameMutationRequest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ gameId: string }> },
) {
  try {
    const { gameId } = await context.params;
    assertGameMutationMetadata(request, gameId, "json");
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    const playerKey = await resolvePlayerKey(request);
    assertExpectedPlayer(request, playerKey);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.moveBurst, playerKey);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.move, playerKey);
    const body = await readGameMutationJson(request, [["expectedVersion"]]);
    if (
      !Number.isSafeInteger(body.expectedVersion)
      || Number(body.expectedVersion) < 0
      || Number(body.expectedVersion) > MAX_PERSISTED_GAME_VERSION
    ) throw invalidGameMutationRequest();
    const game = await claimJapaneseWholeBoardRepetition(
      gameId,
      playerKey,
      body.expectedVersion as number,
    );
    return noStoreJson({ ok: true, actor: playerKey, game });
  } catch (error) {
    return gameMutationRouteError(error);
  }
}
