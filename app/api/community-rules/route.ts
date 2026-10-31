import { friendRouteError } from "@/lib/friends/route";
import { NextRequest } from "next/server";
import { noStoreJson } from "@/lib/api/responses";
import { assertAuthMutationRequest } from "@/lib/auth/credentialRequest";
import { assertExpectedPlayer } from "@/lib/auth/playerBindingServer";
import { resolvePlayerKey } from "@/lib/auth/requestAuth";
import { consumeEphemeralIpPolicyRateLimit, RATE_LIMIT_POLICIES } from "@/lib/auth/rateLimit";
import { COMMUNITY_RULES_HEADER, COMMUNITY_RULES_VERSION } from "@/lib/moderation/communityContract";
import { acceptCommunityRules, hasAcceptedCommunityRules } from "@/lib/moderation/communityService";
import { GameServiceError } from "@/lib/game/gameService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    const actor = await resolvePlayerKey(request);
    assertExpectedPlayer(request, actor);
    return noStoreJson({ ok: true, actor, accepted: await hasAcceptedCommunityRules(actor), version: COMMUNITY_RULES_VERSION });
  } catch (error) { return friendRouteError(error); }
}
export async function POST(request: NextRequest) {
  try {
    assertAuthMutationRequest(request, { requireJson: true });
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    if (request.headers.get(COMMUNITY_RULES_HEADER) !== COMMUNITY_RULES_VERSION) throw new GameServiceError("Accept the current rules.", 400, "community_rules_required");
    const actor = await resolvePlayerKey(request);
    assertExpectedPlayer(request, actor);
    await acceptCommunityRules(actor);
    return noStoreJson({ ok: true, actor, accepted: true });
  } catch (error) { return friendRouteError(error); }
}
