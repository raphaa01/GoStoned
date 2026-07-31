import { NextRequest } from "next/server";
import { apiError } from "@/lib/api/responses";
import {
  consumeEphemeralIpPolicyRateLimit,
  consumeEphemeralPolicyRateLimit,
  RATE_LIMIT_POLICIES,
} from "@/lib/auth/rateLimit";
import { assertExpectedPlayer } from "@/lib/auth/playerBindingServer";
import { resolvePlayerKey } from "@/lib/auth/requestAuth";
import { GameServiceError } from "@/lib/game/gameServiceError";
import { exportPersistedGameToSgf } from "@/lib/game/gameSgfService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CANONICAL_GAME_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ gameId: string }> },
) {
  try {
    const { gameId } = await context.params;
    if (!CANONICAL_GAME_ID.test(gameId)) {
      throw new GameServiceError("Game not found.", 404, "game_not_found");
    }
    if (request.nextUrl.searchParams.size > 0) {
      throw new GameServiceError("SGF export does not accept query parameters.", 400, "invalid_sgf_export_request");
    }
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    const playerKey = await resolvePlayerKey(request);
    assertExpectedPlayer(request, playerKey);
    consumeEphemeralPolicyRateLimit(request, RATE_LIMIT_POLICIES.gameRead, playerKey);
    const sgf = await exportPersistedGameToSgf(gameId, playerKey);
    return new Response(sgf, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": `attachment; filename="gostone-${gameId}.sgf"`,
        "Content-Type": "application/x-go-sgf; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
