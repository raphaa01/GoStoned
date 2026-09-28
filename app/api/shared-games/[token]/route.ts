import { NextRequest } from "next/server";
import { apiError, noStoreJson } from "@/lib/api/responses";
import { consumeEphemeralIpPolicyRateLimit, RATE_LIMIT_POLICIES } from "@/lib/auth/rateLimit";
import { GameServiceError } from "@/lib/game/gameServiceError";
import { getSharedFinishedGame } from "@/lib/game/sharedGameService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    if (!TOKEN.test(token)) throw new GameServiceError("Shared game not found.", 404, "shared_game_not_found");
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    return noStoreJson({ ok: true, game: await getSharedFinishedGame(token) });
  } catch (error) {
    return apiError(error);
  }
}
