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
import { parseRatingPreferences } from "@/lib/rating/preferences";
import { getRatingPreferences, updateRatingPreferences } from "@/lib/rating/preferenceService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    if (request.nextUrl.search !== "") {
      throw new AuthError("The preference request is invalid.", 400, "invalid_request");
    }
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    const user = await requireRequestUser(request);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.profileRead, user.playerKey);
    return noStoreJson({ ok: true, preferences: await getRatingPreferences(user.playerKey) });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    if (request.nextUrl.search !== "") {
      throw new AuthError("The preference request is invalid.", 400, "invalid_request");
    }
    assertAuthMutationRequest(request, { requireJson: true });
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    const user = await requireRequestUser(request);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.profileMutation, user.playerKey);
    const body = await readBoundedJsonObject(request, {
      maxBytes: 512,
      maxChunks: 512,
      idleTimeoutMs: 1_000,
      totalTimeoutMs: 2_000,
      invalidJson: () => new AuthError("The request body must be valid JSON.", 400, "invalid_request"),
      invalidObject: () => new AuthError("The request body must be a JSON object.", 400, "invalid_request"),
    });
    let preferences;
    try {
      preferences = parseRatingPreferences(body);
    } catch {
      throw new AuthError("The rating preferences are invalid.", 400, "invalid_request");
    }
    const saved = await updateRatingPreferences(user.playerKey, preferences);
    return noStoreJson({ ok: true, preferences: saved });
  } catch (error) {
    return apiError(error);
  }
}
