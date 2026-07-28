import { NextRequest } from "next/server";
import { apiError, noStoreJson } from "@/lib/api/responses";
import {
  consumeEphemeralIpPolicyRateLimit,
  consumeEphemeralPolicyRateLimit,
  RATE_LIMIT_POLICIES,
} from "@/lib/auth/rateLimit";
import { assertExpectedPlayer } from "@/lib/auth/playerBindingServer";
import { resolvePlayerKey } from "@/lib/auth/requestAuth";
import { gamePollResponseBody, parseKnownGameVersion } from "@/lib/game/gamePolling";
import { GameServiceError, pollGameState } from "@/lib/game/gameService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CANONICAL_GAME_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function assertCanonicalGameId(gameId: string): void {
  if (!CANONICAL_GAME_ID.test(gameId)) {
    throw new GameServiceError("Game not found.", 404, "game_not_found");
  }
}

function invalidGameReadRequest(): GameServiceError {
  return new GameServiceError(
    "The game read request is invalid.",
    400,
    "invalid_game_read_request",
  );
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ gameId: string }> },
) {
  try {
    const { gameId } = await context.params;
    assertCanonicalGameId(gameId);
    const query = parseKnownGameVersion(request.nextUrl.search);
    if (query.kind === "invalid") throw invalidGameReadRequest();
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    const playerKey = await resolvePlayerKey(request);
    assertExpectedPlayer(request, playerKey);
    consumeEphemeralPolicyRateLimit(request, RATE_LIMIT_POLICIES.gameRead, playerKey);
    const knownVersion = query.kind === "full" ? null : query.knownVersion;
    const result = await pollGameState(gameId, playerKey, knownVersion);
    return noStoreJson(gamePollResponseBody(result));
  } catch (error) {
    return apiError(error);
  }
}
