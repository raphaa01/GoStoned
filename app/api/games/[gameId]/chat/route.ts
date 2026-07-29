import { NextRequest } from "next/server";
import { readBoundedJsonObject } from "@/lib/api/boundedJson";
import { apiError, noStoreJson } from "@/lib/api/responses";
import { AuthError } from "@/lib/auth/accountService";
import { assertAuthMutationRequest } from "@/lib/auth/credentialRequest";
import {
  consumeEphemeralIpPolicyRateLimit,
  consumeEphemeralPolicyRateLimit,
  consumePolicyRateLimit,
  RATE_LIMIT_POLICIES,
} from "@/lib/auth/rateLimit";
import { resolvePlayerKey } from "@/lib/auth/requestAuth";
import { assertExpectedPlayer } from "@/lib/auth/playerBindingServer";
import { getGameMessages, sendGameMessage } from "@/lib/game/chatService";
import { GameServiceError } from "@/lib/game/gameService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const MAX_CHAT_REQUEST_BODY_BYTES = 4_096;
export const MAX_CHAT_REQUEST_BODY_CHUNKS = MAX_CHAT_REQUEST_BODY_BYTES;
export const CHAT_REQUEST_BODY_IDLE_TIMEOUT_MS = 1_000;
export const CHAT_REQUEST_BODY_TOTAL_TIMEOUT_MS = 2_000;

const CANONICAL_GAME_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function invalidChatRequest() {
  return new GameServiceError(
    "The chat request is invalid.",
    400,
    "invalid_chat_request",
  );
}

function assertCanonicalGameId(gameId: string): void {
  if (!CANONICAL_GAME_ID.test(gameId)) {
    throw new GameServiceError("Game not found.", 404, "game_not_found");
  }
}

function parseAfterId(request: NextRequest): number {
  const entries = [...request.nextUrl.searchParams.entries()];
  if (entries.length === 0) return 0;
  if (entries.length !== 1 || entries[0][0] !== "after") throw invalidChatRequest();
  const raw = entries[0][1];
  if (!/^(0|[1-9][0-9]*)$/.test(raw)) throw invalidChatRequest();
  const afterId = Number(raw);
  if (!Number.isSafeInteger(afterId)) throw invalidChatRequest();
  return afterId;
}

async function readMessageBody(request: NextRequest): Promise<unknown> {
  const body = await readBoundedJsonObject(request, {
    maxBytes: MAX_CHAT_REQUEST_BODY_BYTES,
    maxChunks: MAX_CHAT_REQUEST_BODY_CHUNKS,
    idleTimeoutMs: CHAT_REQUEST_BODY_IDLE_TIMEOUT_MS,
    totalTimeoutMs: CHAT_REQUEST_BODY_TOTAL_TIMEOUT_MS,
    invalidJson: invalidChatRequest,
  });
  const entries = Object.entries(body);
  if (entries.length !== 1 || entries[0][0] !== "message") throw invalidChatRequest();
  return entries[0][1];
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
    const afterId = parseAfterId(request);
    const { gameId } = await context.params;
    assertCanonicalGameId(gameId);
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    const playerKey = await resolvePlayerKey(request);
    assertExpectedPlayer(request, playerKey);
    consumeEphemeralPolicyRateLimit(request, RATE_LIMIT_POLICIES.chatRead, playerKey);
    const chat = await getGameMessages(gameId, playerKey, afterId);
    return noStoreJson({ ok: true, ...chat });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ gameId: string }> },
) {
  try {
    assertAuthMutationRequest(request, { requireJson: true });
    if (request.nextUrl.search !== "") throw invalidChatRequest();
    const { gameId } = await context.params;
    assertCanonicalGameId(gameId);
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    const playerKey = await resolvePlayerKey(request);
    assertExpectedPlayer(request, playerKey);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.chatSendBurst, playerKey);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.chatSend, playerKey);
    const messageValue = await readMessageBody(request);
    const message = await sendGameMessage(gameId, playerKey, messageValue);
    return noStoreJson({ ok: true, actor: playerKey, message }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}
