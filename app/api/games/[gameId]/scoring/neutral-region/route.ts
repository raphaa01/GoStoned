import { NextRequest } from "next/server";
import { noStoreJson } from "@/lib/api/responses";
import {
  consumeEphemeralIpPolicyRateLimit,
  consumePolicyRateLimit,
  RATE_LIMIT_POLICIES,
} from "@/lib/auth/rateLimit";
import { assertExpectedPlayer } from "@/lib/auth/playerBindingServer";
import { resolvePlayerKey } from "@/lib/auth/requestAuth";
import { setJapaneseNeutralRegion } from "@/lib/game/gameService";
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
      [["x", "y", "neutral", "expectedRevision"]],
    );
    if (!Number.isSafeInteger(body.x) || !Number.isSafeInteger(body.y)
      || typeof body.neutral !== "boolean"
      || !Number.isSafeInteger(body.expectedRevision)
      || Number(body.expectedRevision) < 1) {
      throw invalidGameMutationRequest();
    }
    const game = await setJapaneseNeutralRegion(gameId, playerKey, {
      x: Number(body.x),
      y: Number(body.y),
      neutral: body.neutral,
      expectedRevision: Number(body.expectedRevision),
    });
    return noStoreJson({ ok: true, actor: playerKey, game });
  } catch (error) {
    return gameMutationRouteError(error);
  }
}
