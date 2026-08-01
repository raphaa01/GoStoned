import { NextRequest } from "next/server";
import { readBoundedJsonObject } from "@/lib/api/boundedJson";
import { apiError, noStoreJson } from "@/lib/api/responses";
import { AuthError } from "@/lib/auth/accountService";
import { assertAuthMutationRequest } from "@/lib/auth/credentialRequest";
import {
  consumeEphemeralIpPolicyRateLimit,
  consumePolicyRateLimit,
  RATE_LIMIT_POLICIES,
} from "@/lib/auth/rateLimit";
import { requireRequestUser } from "@/lib/auth/requestAuth";
import { parseProfileAvatarUpdate } from "@/lib/profileAvatar";
import { updateProfileAvatarStyle } from "@/lib/profileAvatarService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(request: NextRequest) {
  try {
    if (request.nextUrl.search !== "") {
      throw new AuthError("The profile symbol request is invalid.", 400, "invalid_request");
    }
    assertAuthMutationRequest(request, { requireJson: true });
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    const user = await requireRequestUser(request);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.profileMutation, user.playerKey);
    const body = await readBoundedJsonObject(request, {
      maxBytes: 256,
      maxChunks: 256,
      idleTimeoutMs: 1_000,
      totalTimeoutMs: 2_000,
      invalidJson: () => new AuthError("The request body must be valid JSON.", 400, "invalid_request"),
      invalidObject: () => new AuthError("The request body must be a JSON object.", 400, "invalid_request"),
    });
    let update;
    try {
      update = parseProfileAvatarUpdate(body);
    } catch {
      throw new AuthError("The profile symbol is invalid.", 400, "invalid_request");
    }
    const avatarStyle = await updateProfileAvatarStyle(user.id, update.avatarStyle);
    return noStoreJson({ ok: true, avatarStyle });
  } catch (error) {
    return apiError(error);
  }
}
