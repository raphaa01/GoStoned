import { NextRequest } from "next/server";
import { apiError, noStoreJson } from "@/lib/api/responses";
import {
  consumeEphemeralIpPolicyRateLimit,
  consumePolicyRateLimit,
  RATE_LIMIT_POLICIES,
} from "@/lib/auth/rateLimit";
import { resolvePlayerKey } from "@/lib/auth/requestAuth";
import { assertExpectedPlayer } from "@/lib/auth/playerBindingServer";
import { submitMove } from "@/lib/game/gameService";

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
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.moveBurst, playerKey);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.move, playerKey);
    const body = (await request.json()) as {
      x?: unknown;
      y?: unknown;
      isPass?: unknown;
    };
    if (body.isPass !== true && (!Number.isInteger(body.x) || !Number.isInteger(body.y))) {
      return noStoreJson({ ok: false, error: "Integer x and y are required." }, { status: 400 });
    }

    const { gameId } = await context.params;
    const game = await submitMove(gameId, playerKey, {
      x: body.x as number | undefined,
      y: body.y as number | undefined,
      isPass: body.isPass === true,
    });
    return noStoreJson({ ok: true, actor: playerKey, game });
  } catch (error) {
    return apiError(error);
  }
}
