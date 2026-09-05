import { NextRequest } from "next/server";
import { noStoreJson } from "@/lib/api/responses";
import { assertAuthMutationRequest } from "@/lib/auth/credentialRequest";
import { consumeEphemeralIpPolicyRateLimit, consumePolicyRateLimit, RATE_LIMIT_POLICIES } from "@/lib/auth/rateLimit";
import { requireRequestUser } from "@/lib/auth/requestAuth";
import { assertExpectedPlayer } from "@/lib/auth/playerBindingServer";
import { sendFriendRequest } from "@/lib/friends/friendService";
import { assertUuid, exactFields, friendRequestError, readFriendJson } from "@/lib/friends/request";
import { friendRouteError } from "@/lib/friends/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertAuthMutationRequest(request, { requireJson: true });
    if (request.nextUrl.search !== "") throw friendRequestError();
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    const user = await requireRequestUser(request);
    assertExpectedPlayer(request, user.playerKey);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.friendsMutation, user.playerKey);
    const body = await readFriendJson(request);
    exactFields(body, ["targetId"]);
    if (typeof body.targetId !== "string") throw friendRequestError();
    assertUuid(body.targetId);
    const friendshipId = await sendFriendRequest(user.id, body.targetId);
    return noStoreJson({ ok: true, friendshipId }, { status: 201 });
  } catch (error) {
    return friendRouteError(error);
  }
}
