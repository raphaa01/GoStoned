import { NextRequest } from "next/server";
import { noStoreJson } from "@/lib/api/responses";
import {
  consumeEphemeralIpPolicyRateLimit,
  consumePolicyRateLimit,
  RATE_LIMIT_POLICIES,
} from "@/lib/auth/rateLimit";
import { resolvePlayerKey } from "@/lib/auth/requestAuth";
import { assertExpectedPlayer } from "@/lib/auth/playerBindingServer";
import { resumePlay } from "@/lib/game/gameService";
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
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.scoringDecisionBurst, playerKey);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.scoringDecision, playerKey);
    const body = await readGameMutationJson(
      request,
      [["expectedRevision", "claim", "x", "y"]],
    );
    if (
      !Number.isSafeInteger(body.expectedRevision)
      || Number(body.expectedRevision) < 1
      || (body.claim !== "dead" && body.claim !== "alive")
      || !Number.isSafeInteger(body.x)
      || !Number.isSafeInteger(body.y)
    ) {
      throw invalidGameMutationRequest();
    }
    const game = await resumePlay(
      gameId,
      playerKey,
      body.expectedRevision as number,
      body.claim,
      { x: body.x as number, y: body.y as number },
    );
    return noStoreJson({ ok: true, actor: playerKey, game });
  } catch (error) {
    return gameMutationRouteError(error);
  }
}
