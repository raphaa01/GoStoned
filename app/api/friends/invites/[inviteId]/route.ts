import { NextRequest } from "next/server";
import { noStoreJson } from "@/lib/api/responses";
import { assertAuthMutationRequest } from "@/lib/auth/credentialRequest";
import { consumeEphemeralIpPolicyRateLimit, consumePolicyRateLimit, RATE_LIMIT_POLICIES } from "@/lib/auth/rateLimit";
import { requireRequestUser } from "@/lib/auth/requestAuth";
import { assertExpectedPlayer } from "@/lib/auth/playerBindingServer";
import { respondToGameInvite } from "@/lib/friends/friendService";
import { assertUuid, exactFields, friendRequestError, readFriendJson } from "@/lib/friends/request";
import { friendRouteError } from "@/lib/friends/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(request: NextRequest, context: { params: Promise<{ inviteId: string }> }) {
  try {
    assertAuthMutationRequest(request, { requireJson: true });
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    const user = await requireRequestUser(request);
    assertExpectedPlayer(request, user.playerKey);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.friendsMutation, user.playerKey);
    const { inviteId } = await context.params;
    assertUuid(inviteId);
    const body = await readFriendJson(request);
    exactFields(body, ["action"]);
    if (body.action !== "accept" && body.action !== "decline" && body.action !== "cancel") {
      throw friendRequestError();
    }
    const result = await respondToGameInvite(user.id, inviteId, body.action);
    return noStoreJson({ ok: true, ...result });
  } catch (error) {
    return friendRouteError(error);
  }
}
