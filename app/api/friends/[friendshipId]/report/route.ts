import { friendRouteError } from "@/lib/friends/route";
import { NextRequest } from "next/server";
import { noStoreJson } from "@/lib/api/responses";
import { readBoundedJsonObject } from "@/lib/api/boundedJson";
import { assertAuthMutationRequest } from "@/lib/auth/credentialRequest";
import { requireRequestUser } from "@/lib/auth/requestAuth";
import { assertExpectedPlayer } from "@/lib/auth/playerBindingServer";
import { consumeEphemeralIpPolicyRateLimit, consumePolicyRateLimit, RATE_LIMIT_POLICIES } from "@/lib/auth/rateLimit";
import { friendSafety } from "@/lib/moderation/friendSafetyService";
import { GameServiceError } from "@/lib/game/gameServiceError";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: NextRequest, context: { params: Promise<{ friendshipId: string }> }) {
  try {
    assertAuthMutationRequest(request, { requireJson: true });
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    const user = await requireRequestUser(request); assertExpectedPlayer(request, user.playerKey);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.playerReportBurst, user.playerKey);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.playerReportSubmit, user.playerKey);
    const { friendshipId } = await context.params;
    const invalid = () => new GameServiceError("Invalid safety request.", 400, "invalid_request");
    if (!/^[0-9a-f-]{36}$/.test(friendshipId)) throw invalid();
    const body = await readBoundedJsonObject(request, { maxBytes: 256, maxChunks: 256, idleTimeoutMs: 1000, totalTimeoutMs: 2000, invalidJson: invalid });
    if (Object.keys(body).length !== 1 || !("category" in body)) throw invalid();
    return noStoreJson({ ok: true, ...await friendSafety(user.id, friendshipId, { category: body.category }) });
  } catch (error) { return friendRouteError(error); }
}
