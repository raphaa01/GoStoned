import { NextRequest } from "next/server";
import { apiError, noStoreJson } from "@/lib/api/responses";
import {
  consumeIpPolicyRateLimit,
  RATE_LIMIT_POLICIES,
  RateLimitError,
} from "@/lib/auth/rateLimit";
import { getRequestUser } from "@/lib/auth/requestAuth";
import { SESSION_COOKIE } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    await consumeIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.accountSessionLookup);
    const user = await getRequestUser(request);
    const response = noStoreJson({ ok: true, user });
    if (!user && request.cookies.has(SESSION_COOKIE)) {
      response.cookies.set(SESSION_COOKIE, "", {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 0,
      });
    }
    return response;
  } catch (error) {
    if (error instanceof RateLimitError) return apiError(error);
    console.error("Session lookup failed:", error);
    return noStoreJson(
      { ok: false, error: "Could not read the session.", code: "session_failed" },
      { status: 500 },
    );
  }
}
