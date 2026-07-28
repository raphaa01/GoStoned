import { NextRequest } from "next/server";
import { apiError, noStoreJson } from "@/lib/api/responses";
import {
  consumeEphemeralIpPolicyRateLimit,
  consumePolicyRateLimit,
  RATE_LIMIT_POLICIES,
} from "@/lib/auth/rateLimit";
import { resolvePlayerKey } from "@/lib/auth/requestAuth";
import { assertExpectedPlayer } from "@/lib/auth/playerBindingServer";
import { setDeadGroup } from "@/lib/game/gameService";

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
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.scoringEditBurst, playerKey);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.scoringEdit, playerKey);
    const body = (await request.json()) as {
      x?: unknown;
      y?: unknown;
      dead?: unknown;
      expectedRevision?: unknown;
    };
    if (
      !Number.isInteger(body.x)
      || !Number.isInteger(body.y)
      || typeof body.dead !== "boolean"
      || !Number.isInteger(body.expectedRevision)
    ) {
      return noStoreJson(
        { ok: false, error: "Integer coordinates, dead state, and scoring revision are required." },
        { status: 400 },
      );
    }
    const { gameId } = await context.params;
    const game = await setDeadGroup(gameId, playerKey, {
      x: body.x as number,
      y: body.y as number,
      dead: body.dead,
      expectedRevision: body.expectedRevision as number,
    });
    return noStoreJson({ ok: true, actor: playerKey, game });
  } catch (error) {
    return apiError(error);
  }
}
