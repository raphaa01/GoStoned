import { NextRequest } from "next/server";
import { apiError, noStoreJson } from "@/lib/api/responses";
import {
  consumeEphemeralIpPolicyRateLimit,
  consumePolicyRateLimit,
  RATE_LIMIT_POLICIES,
} from "@/lib/auth/rateLimit";
import { resolvePlayerKey } from "@/lib/auth/requestAuth";
import { confirmScore } from "@/lib/game/gameService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ gameId: string }> },
) {
  try {
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    const playerKey = await resolvePlayerKey(request);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.scoringDecisionBurst, playerKey);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.scoringDecision, playerKey);
    const body = (await request.json()) as { expectedRevision?: unknown };
    if (!Number.isInteger(body.expectedRevision)) {
      return noStoreJson(
        { ok: false, error: "A valid scoring revision is required." },
        { status: 400 },
      );
    }
    const { gameId } = await context.params;
    const game = await confirmScore(gameId, playerKey, body.expectedRevision as number);
    return noStoreJson({ ok: true, game });
  } catch (error) {
    return apiError(error);
  }
}
