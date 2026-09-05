import { NextRequest } from "next/server";
import { noStoreJson } from "@/lib/api/responses";
import { assertAuthMutationRequest } from "@/lib/auth/credentialRequest";
import { consumeEphemeralIpPolicyRateLimit, consumePolicyRateLimit, RATE_LIMIT_POLICIES } from "@/lib/auth/rateLimit";
import { requireRequestUser } from "@/lib/auth/requestAuth";
import { assertExpectedPlayer } from "@/lib/auth/playerBindingServer";
import { removeFriendship, respondToFriendRequest } from "@/lib/friends/friendService";
import { assertUuid, exactFields, friendRequestError, readFriendJson } from "@/lib/friends/request";
import { friendRouteError } from "@/lib/friends/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function actor(request: NextRequest) {
  consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
  const user = await requireRequestUser(request);
  assertExpectedPlayer(request, user.playerKey);
  await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.friendsMutation, user.playerKey);
  return user;
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ friendshipId: string }> }) {
  try {
    assertAuthMutationRequest(request, { requireJson: true });
    if (request.nextUrl.search !== "") throw friendRequestError();
    const user = await actor(request);
    const { friendshipId } = await context.params;
    assertUuid(friendshipId);
    const body = await readFriendJson(request);
    exactFields(body, ["action"]);
    if (body.action !== "accept" && body.action !== "decline") throw friendRequestError();
    await respondToFriendRequest(user.id, friendshipId, body.action === "accept");
    return noStoreJson({ ok: true });
  } catch (error) {
    return friendRouteError(error);
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ friendshipId: string }> }) {
  try {
    assertAuthMutationRequest(request);
    if (request.nextUrl.search !== "") throw friendRequestError();
    const user = await actor(request);
    const { friendshipId } = await context.params;
    assertUuid(friendshipId);
    await removeFriendship(user.id, friendshipId);
    return noStoreJson({ ok: true });
  } catch (error) {
    return friendRouteError(error);
  }
}
