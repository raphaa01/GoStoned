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
      [
        ["expectedRevision"],
        ["expectedRevision", "claim", "x", "y"],
      ],
    );
    if (
      !Number.isSafeInteger(body.expectedRevision)
      || Number(body.expectedRevision) < 1
      || (body.claim !== undefined && body.claim !== "dead" && body.claim !== "alive")
      || (body.x !== undefined && !Number.isSafeInteger(body.x))
      || (body.y !== undefined && !Number.isSafeInteger(body.y))
      || ((body.claim === undefined) !== (body.x === undefined))
      || ((body.claim === undefined) !== (body.y === undefined))
    ) {
      throw invalidGameMutationRequest();
    }
    const game = await resumePlay(
      gameId,
      playerKey,
      body.expectedRevision as number,
      body.claim === "dead" || body.claim === "alive" ? body.claim : null,
      Number.isSafeInteger(body.x) && Number.isSafeInteger(body.y)
        ? { x: body.x as number, y: body.y as number }
        : null,
    );
    return noStoreJson({ ok: true, actor: playerKey, game });
  } catch (error) {
    return gameMutationRouteError(error);
  }
}
