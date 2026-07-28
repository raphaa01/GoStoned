import { NextRequest } from "next/server";
import { apiError, noStoreJson } from "@/lib/api/responses";
import {
  consumeEphemeralIpPolicyRateLimit,
  consumeEphemeralPolicyRateLimit,
  consumePolicyRateLimit,
  RATE_LIMIT_POLICIES,
} from "@/lib/auth/rateLimit";
import { resolvePlayerKey } from "@/lib/auth/requestAuth";
import { getGameMessages, sendGameMessage } from "@/lib/game/chatService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ gameId: string }> },
) {
  try {
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    const playerKey = await resolvePlayerKey(request);
    consumeEphemeralPolicyRateLimit(request, RATE_LIMIT_POLICIES.chatRead, playerKey);
    const afterId = Number(request.nextUrl.searchParams.get("after") ?? 0);
    const { gameId } = await context.params;
    const messages = await getGameMessages(
      gameId,
      playerKey,
      Number.isSafeInteger(afterId) ? afterId : 0,
    );
    return noStoreJson({ ok: true, messages });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ gameId: string }> },
) {
  try {
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    const playerKey = await resolvePlayerKey(request);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.chatSendBurst, playerKey);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.chatSend, playerKey);
    const body = (await request.json()) as { message?: unknown };
    const { gameId } = await context.params;
    const message = await sendGameMessage(gameId, playerKey, body.message);
    return noStoreJson({ ok: true, message }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
