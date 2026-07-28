import { NextRequest } from "next/server";
import { apiError, noStoreJson } from "@/lib/api/responses";
import {
  AuthError,
  authenticateAccount,
} from "@/lib/auth/accountService";
import {
  assertAuthMutationRequest,
  readCredentialRequest,
} from "@/lib/auth/credentialRequest";
import {
  clearRateLimit,
  consumeIpPolicyRateLimit,
  consumeRateLimit,
  RATE_LIMIT_POLICIES,
  RateLimitError,
  reserveLoginAccountAttempt,
} from "@/lib/auth/rateLimit";
import {
  createSession,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertAuthMutationRequest(request, { requireJson: true });
    await consumeIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.loginAddress);
    const credentials = await readCredentialRequest(request);
    const targetRateLimitKey = await consumeRateLimit(
      request,
      RATE_LIMIT_POLICIES.loginTarget.scope,
      credentials.username,
      RATE_LIMIT_POLICIES.loginTarget.limit,
      RATE_LIMIT_POLICIES.loginTarget.windowMinutes,
    );
    const accountRateLimitKeys = await reserveLoginAccountAttempt(credentials.username);
    const user = await authenticateAccount(credentials.username, credentials.password);
    await Promise.all([targetRateLimitKey, ...accountRateLimitKeys].map(
      (key) => clearRateLimit(key),
    ));
    const token = await createSession(user.id);
    const response = noStoreJson({ ok: true, user });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
      priority: "high",
    });
    return response;
  } catch (error) {
    if (error instanceof AuthError) {
      return noStoreJson(
        { ok: false, error: error.message, code: error.code },
        { status: error.status },
      );
    }
    if (error instanceof RateLimitError) {
      return apiError(error);
    }
    console.error("Login failed:", error);
    return noStoreJson(
      { ok: false, error: "Could not log in.", code: "login_failed" },
      { status: 500 },
    );
  }
}
