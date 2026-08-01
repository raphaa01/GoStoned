import { NextRequest } from "next/server";
import { apiError, noStoreJson } from "@/lib/api/responses";
import { AuthError } from "@/lib/auth/accountService";
import {
  consumeEphemeralIpPolicyRateLimit,
  consumePolicyRateLimit,
  RATE_LIMIT_POLICIES,
} from "@/lib/auth/rateLimit";
import { requireRequestUser } from "@/lib/auth/requestAuth";
import { getCurrentRatingIdentity } from "@/lib/stats/statsService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    if (request.nextUrl.search !== "") {
      throw new AuthError("The rating request is invalid.", 400, "invalid_request");
    }
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    const user = await requireRequestUser(request);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.profileRead, user.playerKey);
    const rating = await getCurrentRatingIdentity(user.playerKey);
    return noStoreJson({ ok: true, rating });
  } catch (error) {
    return apiError(error);
  }
}
