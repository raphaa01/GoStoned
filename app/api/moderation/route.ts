import { friendRouteError } from "@/lib/friends/route";
import { NextRequest } from "next/server";
import { noStoreJson } from "@/lib/api/responses";
import { readBoundedJsonObject } from "@/lib/api/boundedJson";
import { assertAuthMutationRequest } from "@/lib/auth/credentialRequest";
import { requireRequestUser } from "@/lib/auth/requestAuth";
import { consumeEphemeralIpPolicyRateLimit, RATE_LIMIT_POLICIES } from "@/lib/auth/rateLimit";
import { GameServiceError } from "@/lib/game/gameService";
import { isModerationAction } from "@/lib/moderation/communityContract";
import { decideReport, isModerator, moderationQueue } from "@/lib/moderation/moderationService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const invalid = () => new GameServiceError("Invalid moderation request.", 400, "invalid_request");
async function moderator(request: NextRequest) {
  consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
  const user = await requireRequestUser(request);
  if (!await isModerator(user.id)) throw new GameServiceError("Not found.", 404, "not_found");
  return user;
}
export async function GET(request: NextRequest) {
  try { const user = await moderator(request); return noStoreJson({ ok: true, cases: await moderationQueue(user.id, request.nextUrl.searchParams.get("status") === "closed") }); }
  catch (error) { return friendRouteError(error); }
}
export async function POST(request: NextRequest) {
  try {
    assertAuthMutationRequest(request, { requireJson: true });
    const user = await moderator(request);
    const body = await readBoundedJsonObject(request, { maxBytes: 512, maxChunks: 512, idleTimeoutMs: 1000, totalTimeoutMs: 2000, invalidJson: invalid });
    if (Object.keys(body).length !== 2 || typeof body.caseId !== "string" || !/^[0-9a-f-]{36}$/.test(body.caseId) || !isModerationAction(body.action)) throw invalid();
    await decideReport(user.id, body.caseId, body.action);
    return noStoreJson({ ok: true });
  } catch (error) { return friendRouteError(error); }
}
