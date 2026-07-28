import { NextRequest } from "next/server";
import { apiError, noStoreJson } from "@/lib/api/responses";
import {
  consumeEphemeralIpPolicyRateLimit,
  consumePolicyRateLimit,
  RATE_LIMIT_POLICIES,
} from "@/lib/auth/rateLimit";
import { resolvePlayerKey } from "@/lib/auth/requestAuth";
import { assertExpectedPlayer } from "@/lib/auth/playerBindingServer";
import { resumePlay } from "@/lib/game/gameService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ gameId: string }> },
) {
  try {
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    const playerKey = await resolvePlayerKey(request);
    assertExpectedPlayer(request, playerKey);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.scoringDecisionBurst, playerKey);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.scoringDecision, playerKey);
    const body = (await request.json()) as {
      expectedRevision?: unknown;
      claim?: unknown;
      x?: unknown;
      y?: unknown;
    };
    if (
      !Number.isInteger(body.expectedRevision)
      || (body.claim !== "dead" && body.claim !== "alive")
      || !Number.isInteger(body.x)
      || !Number.isInteger(body.y)
    ) {
      return noStoreJson(
        { ok: false, error: "A scoring revision, dispute claim, and stone coordinate are required." },
        { status: 400 },
      );
    }
    const { gameId } = await context.params;
    const game = await resumePlay(
      gameId,
      playerKey,
      body.expectedRevision as number,
      body.claim,
      { x: body.x as number, y: body.y as number },
    );
    return noStoreJson({ ok: true, actor: playerKey, game });
  } catch (error) {
    return apiError(error);
  }
}
