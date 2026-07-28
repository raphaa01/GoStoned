import { NextRequest } from "next/server";
import { apiError, noStoreJson } from "@/lib/api/responses";
import { AuthError } from "@/lib/auth/accountService";
import { assertAuthMutationRequest } from "@/lib/auth/credentialRequest";
import { assertExpectedPlayer } from "@/lib/auth/playerBindingServer";
import {
  consumeEphemeralIpPolicyRateLimit,
  consumeEphemeralPolicyRateLimit,
  consumePolicyRateLimit,
  RATE_LIMIT_POLICIES,
} from "@/lib/auth/rateLimit";
import { resolvePlayerKey } from "@/lib/auth/requestAuth";
import { GameServiceError } from "@/lib/game/gameService";
import {
  getGameOpponentBlockState,
  setGameOpponentBlocked,
} from "@/lib/moderation/playerBlockService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CANONICAL_GAME_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function invalidRequest() {
  return new GameServiceError(
    "The block request is invalid.",
    400,
    "invalid_block_request",
  );
}

function assertCanonicalGameId(gameId: string): void {
  if (!CANONICAL_GAME_ID.test(gameId)) {
    throw new GameServiceError("Game not found.", 404, "game_not_found");
  }
}

function assertNoQuery(request: NextRequest): void {
  if (request.nextUrl.search !== "") throw invalidRequest();
}

function assertMutationContract(request: NextRequest): void {
  assertAuthMutationRequest(request);
  assertNoQuery(request);
  if (request.body !== null) throw invalidRequest();
}

function routeError(error: unknown) {
  if (error instanceof AuthError) {
    return noStoreJson(
      { ok: false, error: error.message, code: error.code },
      { status: error.status },
    );
  }
  return apiError(error);
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ gameId: string }> },
) {
  try {
    assertNoQuery(request);
    const { gameId } = await context.params;
    assertCanonicalGameId(gameId);
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    const playerKey = await resolvePlayerKey(request);
    assertExpectedPlayer(request, playerKey);
    consumeEphemeralPolicyRateLimit(
      request,
      RATE_LIMIT_POLICIES.playerBlockRead,
      playerKey,
    );
    const state = await getGameOpponentBlockState(gameId, playerKey);
    return noStoreJson({ ok: true, actor: playerKey, ...state });
  } catch (error) {
    return routeError(error);
  }
}

async function mutateBlock(
  request: NextRequest,
  context: { params: Promise<{ gameId: string }> },
  blocked: boolean,
) {
  try {
    assertMutationContract(request);
    const { gameId } = await context.params;
    assertCanonicalGameId(gameId);
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    const playerKey = await resolvePlayerKey(request);
    assertExpectedPlayer(request, playerKey);
    await consumePolicyRateLimit(
      request,
      RATE_LIMIT_POLICIES.playerBlockMutationBurst,
      playerKey,
    );
    await consumePolicyRateLimit(
      request,
      RATE_LIMIT_POLICIES.playerBlockMutation,
      playerKey,
    );
    const state = await setGameOpponentBlocked(gameId, playerKey, blocked);
    return noStoreJson({ ok: true, actor: playerKey, ...state });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ gameId: string }> },
) {
  return mutateBlock(request, context, true);
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ gameId: string }> },
) {
  return mutateBlock(request, context, false);
}
