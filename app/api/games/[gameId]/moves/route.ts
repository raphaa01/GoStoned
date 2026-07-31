import { after, NextRequest } from "next/server";
import { noStoreJson } from "@/lib/api/responses";
import {
  consumeEphemeralIpPolicyRateLimit,
  consumePolicyRateLimit,
  RATE_LIMIT_POLICIES,
} from "@/lib/auth/rateLimit";
import { resolvePlayerKey } from "@/lib/auth/requestAuth";
import { assertExpectedPlayer } from "@/lib/auth/playerBindingServer";
import { MAX_PERSISTED_GAME_VERSION } from "@/lib/game/gamePolling";
import { submitMove } from "@/lib/game/gameService";
import {
  assertGameMutationMetadata,
  gameMutationRouteError,
  invalidGameMutationRequest,
  readGameMutationJson,
} from "@/lib/game/gameMutationRequest";
import { dispatchBotTurnIfNeeded, safelyDispatch } from "@/lib/katago/dispatch";

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
    const body = await readGameMutationJson(
      request,
      [
        ["x", "y", "expectedVersion"],
        ["isPass", "expectedVersion"],
        ["x", "y", "isPass", "expectedVersion"],
      ],
    );
    const isPass = body.isPass === true;
    if (
      !Number.isSafeInteger(body.expectedVersion)
      || Number(body.expectedVersion) < 0
      || Number(body.expectedVersion) > MAX_PERSISTED_GAME_VERSION
      || (isPass && ("x" in body || "y" in body))
      || (!isPass && body.isPass !== undefined && body.isPass !== false)
      || (!isPass && (!Number.isSafeInteger(body.x) || !Number.isSafeInteger(body.y)))
    ) {
      throw invalidGameMutationRequest();
    }

    const game = await submitMove(gameId, playerKey, {
      x: body.x as number | undefined,
      y: body.y as number | undefined,
      isPass,
      expectedVersion: body.expectedVersion as number,
    });
    after(() => safelyDispatch(() => dispatchBotTurnIfNeeded(gameId)));
    return noStoreJson({ ok: true, actor: playerKey, game });
  } catch (error) {
    return gameMutationRouteError(error);
  }
}
