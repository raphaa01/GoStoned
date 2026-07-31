import { NextRequest } from "next/server";
import { apiError, noStoreJson } from "@/lib/api/responses";
import {
  consumeEphemeralIpPolicyRateLimit,
  consumePolicyRateLimit,
  RATE_LIMIT_POLICIES,
} from "@/lib/auth/rateLimit";
import { requireRequestUser } from "@/lib/auth/requestAuth";
import { getPlayerProfileStats } from "@/lib/stats/statsService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    const user = await requireRequestUser(request);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.profileRead, user.playerKey);
    const profile = await getPlayerProfileStats(user.playerKey);
    return noStoreJson({ ok: true, user, ...profile });
  } catch (error) {
    return apiError(error);
  }
}
