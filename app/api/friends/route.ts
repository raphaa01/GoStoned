import { NextRequest } from "next/server";
import { noStoreJson } from "@/lib/api/responses";
import { consumeEphemeralIpPolicyRateLimit, consumePolicyRateLimit, RATE_LIMIT_POLICIES } from "@/lib/auth/rateLimit";
import { requireRequestUser } from "@/lib/auth/requestAuth";
import { assertExpectedPlayer } from "@/lib/auth/playerBindingServer";
import { getFriendsDashboard } from "@/lib/friends/friendService";
import { friendRequestError } from "@/lib/friends/request";
import { friendRouteError } from "@/lib/friends/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    if (request.nextUrl.search !== "") throw friendRequestError();
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    const user = await requireRequestUser(request);
    assertExpectedPlayer(request, user.playerKey);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.friendsRead, user.playerKey);
    return noStoreJson({ ok: true, dashboard: await getFriendsDashboard(user.id) });
  } catch (error) {
    return friendRouteError(error);
  }
}
