import { NextRequest } from "next/server";
import { apiError, noStoreJson } from "@/lib/api/responses";
import {
  consumeIpPolicyRateLimit,
  RATE_LIMIT_POLICIES,
  RateLimitError,
} from "@/lib/auth/rateLimit";
import { getRequestUser } from "@/lib/auth/requestAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    await consumeIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.accountSessionLookup);
    const user = await getRequestUser(request);
    return noStoreJson({ ok: true, user });
  } catch (error) {
    if (error instanceof RateLimitError) return apiError(error);
    console.error("Session lookup failed:", error);
    return noStoreJson({ ok: false, error: "Could not read the session." }, { status: 500 });
  }
}
