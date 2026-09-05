import { NextRequest } from "next/server";
import { noStoreJson } from "@/lib/api/responses";
import { assertAuthMutationRequest } from "@/lib/auth/credentialRequest";
import { consumeEphemeralIpPolicyRateLimit, consumePolicyRateLimit, RATE_LIMIT_POLICIES } from "@/lib/auth/rateLimit";
import { requireRequestUser } from "@/lib/auth/requestAuth";
import { assertExpectedPlayer } from "@/lib/auth/playerBindingServer";
import { createGameInvite } from "@/lib/friends/friendService";
import { assertUuid, exactFields, parseBoardSize, parseTimeControl, readFriendJson } from "@/lib/friends/request";
import { friendRouteError } from "@/lib/friends/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ friendshipId: string }> }) {
  try {
    assertAuthMutationRequest(request, { requireJson: true });
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    const user = await requireRequestUser(request);
    assertExpectedPlayer(request, user.playerKey);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.friendsMutation, user.playerKey);
    const { friendshipId } = await context.params;
    assertUuid(friendshipId);
    const body = await readFriendJson(request);
    exactFields(body, ["boardSize", "timeControl"]);
    const invite = await createGameInvite(
      user.id,
      friendshipId,
      parseBoardSize(body.boardSize),
      parseTimeControl(body.timeControl),
    );
    return noStoreJson({ ok: true, invite }, { status: 201 });
  } catch (error) {
    return friendRouteError(error);
  }
}
