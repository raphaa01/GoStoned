import { NextRequest } from "next/server";
import { noStoreJson } from "@/lib/api/responses";
import {
  consumeEphemeralIpPolicyRateLimit,
  consumePolicyRateLimit,
  RATE_LIMIT_POLICIES,
} from "@/lib/auth/rateLimit";
import { resolvePlayerKey } from "@/lib/auth/requestAuth";
import { assertExpectedPlayer } from "@/lib/auth/playerBindingServer";
import { setDeadGroup } from "@/lib/game/gameService";
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
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.scoringEditBurst, playerKey);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.scoringEdit, playerKey);
    const body = await readGameMutationJson(
      request,
      [["x", "y", "dead", "expectedRevision"]],
    );
    if (
      !Number.isSafeInteger(body.x)
      || !Number.isSafeInteger(body.y)
      || typeof body.dead !== "boolean"
      || !Number.isSafeInteger(body.expectedRevision)
      || Number(body.expectedRevision) < 1
    ) {
      throw invalidGameMutationRequest();
    }
    const game = await setDeadGroup(gameId, playerKey, {
      x: body.x as number,
      y: body.y as number,
      dead: body.dead,
      expectedRevision: body.expectedRevision as number,
    });
    return noStoreJson({ ok: true, actor: playerKey, game });
  } catch (error) {
    return gameMutationRouteError(error);
  }
}
