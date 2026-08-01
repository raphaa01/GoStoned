import { NextRequest } from "next/server";
import { noStoreJson } from "@/lib/api/responses";
import {
  consumeEphemeralIpPolicyRateLimit,
  consumePolicyRateLimit,
  RATE_LIMIT_POLICIES,
} from "@/lib/auth/rateLimit";
import { assertExpectedPlayer } from "@/lib/auth/playerBindingServer";
import { resolvePlayerKey } from "@/lib/auth/requestAuth";
import { submitVerifiedLocalBotAction, type LocalBotAction } from "@/lib/bot/localBotService";
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
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.localBotMoveBurst, playerKey);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.localBotMove, playerKey);
    const body = await readGameMutationJson(request, [
      ["action", "expectedVersion", "x", "y"],
      ["action", "expectedVersion", "x", "y", "isPass"],
      ["action", "expectedVersion", "isPass"],
      ["action", "expectedVersion"],
    ]);
    const expectedVersion = body.expectedVersion;
    if (
      !Number.isSafeInteger(expectedVersion)
      || Number(expectedVersion) < 0
      || Number(expectedVersion) > MAX_PERSISTED_GAME_VERSION
    ) {
      throw invalidGameMutationRequest();
    }

    let action: LocalBotAction;
    if (body.action === "confirm-score") {
      if ("x" in body || "y" in body || "isPass" in body) {
        throw invalidGameMutationRequest();
      }
      action = { action: "confirm-score", expectedVersion: Number(expectedVersion) };
    } else if (body.action === "move") {
      const isPass = body.isPass === true;
      if (
        (isPass && ("x" in body || "y" in body))
        || (!isPass && body.isPass !== undefined && body.isPass !== false)
        || (!isPass && (!Number.isSafeInteger(body.x) || !Number.isSafeInteger(body.y)))
      ) {
        throw invalidGameMutationRequest();
      }
      action = isPass
        ? { action: "move", expectedVersion: Number(expectedVersion), isPass: true }
        : {
            action: "move",
            expectedVersion: Number(expectedVersion),
            x: Number(body.x),
            y: Number(body.y),
          };
    } else {
      throw invalidGameMutationRequest();
    }

    const game = await submitVerifiedLocalBotAction(gameId, playerKey, action);
    return noStoreJson({ ok: true, actor: playerKey, game });
  } catch (error) {
    return gameMutationRouteError(error);
  }
}
