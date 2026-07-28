import { NextRequest } from "next/server";
import { apiError, noStoreJson } from "@/lib/api/responses";
import { AuthError, registerAccount } from "@/lib/auth/accountService";
import {
  assertAuthMutationRequest,
  readCredentialRequest,
} from "@/lib/auth/credentialRequest";
import {
  consumeIpPolicyRateLimit,
  consumeRateLimit,
  RATE_LIMIT_POLICIES,
  RateLimitError,
} from "@/lib/auth/rateLimit";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertAuthMutationRequest(request, { requireJson: true });
    await consumeIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.registerAddress);
    const credentials = await readCredentialRequest(request);
    await consumeRateLimit(
      request,
      RATE_LIMIT_POLICIES.registerTarget.scope,
      credentials.username,
      RATE_LIMIT_POLICIES.registerTarget.limit,
      RATE_LIMIT_POLICIES.registerTarget.windowMinutes,
    );
    const { user, token } = await registerAccount(credentials.username, credentials.password);
    const response = noStoreJson({ ok: true, user }, { status: 201 });
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
    console.error("Registration failed:", error);
    return noStoreJson(
      { ok: false, error: "Could not create the account.", code: "register_failed" },
      { status: 500 },
    );
  }
}
