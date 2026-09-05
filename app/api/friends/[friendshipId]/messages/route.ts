import { NextRequest } from "next/server";
import { noStoreJson } from "@/lib/api/responses";
import { assertAuthMutationRequest } from "@/lib/auth/credentialRequest";
import { consumeEphemeralIpPolicyRateLimit, consumePolicyRateLimit, RATE_LIMIT_POLICIES, type RateLimitPolicy } from "@/lib/auth/rateLimit";
import { requireRequestUser } from "@/lib/auth/requestAuth";
import { assertExpectedPlayer } from "@/lib/auth/playerBindingServer";
import { getFriendMessages, sendFriendMessage } from "@/lib/friends/friendService";
import { assertUuid, exactFields, parseMessageCursor, readFriendJson } from "@/lib/friends/request";
import { friendRouteError } from "@/lib/friends/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function actor(request: NextRequest, policy: RateLimitPolicy) {
  consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
  const user = await requireRequestUser(request);
  assertExpectedPlayer(request, user.playerKey);
  await consumePolicyRateLimit(request, policy, user.playerKey);
  return user;
}

export async function GET(request: NextRequest, context: { params: Promise<{ friendshipId: string }> }) {
  try {
    const after = parseMessageCursor(request);
    const user = await actor(request, RATE_LIMIT_POLICIES.friendsRead);
    const { friendshipId } = await context.params;
    assertUuid(friendshipId);
    return noStoreJson({ ok: true, messages: await getFriendMessages(user.id, friendshipId, after) });
  } catch (error) {
    return friendRouteError(error);
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ friendshipId: string }> }) {
  try {
    assertAuthMutationRequest(request, { requireJson: true });
    const user = await actor(request, RATE_LIMIT_POLICIES.friendMessageSend);
    const { friendshipId } = await context.params;
    assertUuid(friendshipId);
    const body = await readFriendJson(request);
    exactFields(body, ["message"]);
    const message = await sendFriendMessage(user.id, friendshipId, body.message);
    return noStoreJson({ ok: true, message }, { status: 201 });
  } catch (error) {
    return friendRouteError(error);
  }
}
