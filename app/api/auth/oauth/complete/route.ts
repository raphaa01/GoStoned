import { NextRequest, NextResponse } from "next/server";
import { apiError, noStoreJson } from "@/lib/api/responses";
import { AuthError } from "@/lib/auth/accountService";
import {
  assertAuthMutationRequest,
  readOAuthRegistrationRequest,
} from "@/lib/auth/credentialRequest";
import {
  completeOAuthRegistration,
  OAUTH_REGISTRATION_COOKIE,
} from "@/lib/auth/oauthAccountService";
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

function clearRegistrationCookie(response: NextResponse) {
  response.cookies.set(OAUTH_REGISTRATION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
    priority: "high",
  });
}

export async function POST(request: NextRequest) {
  try {
    assertAuthMutationRequest(request, { requireJson: true });
    await consumeIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.registerAddress);
    const registration = await readOAuthRegistrationRequest(request);
    await consumeRateLimit(
      request,
      RATE_LIMIT_POLICIES.registerTarget.scope,
      registration.username,
      RATE_LIMIT_POLICIES.registerTarget.limit,
      RATE_LIMIT_POLICIES.registerTarget.windowMinutes,
    );
    const { user, token } = await completeOAuthRegistration(
      request.cookies.get(OAUTH_REGISTRATION_COOKIE)?.value,
      registration.username,
      registration.startingStrength,
    );
    const response = noStoreJson({ ok: true, user }, { status: 201 });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
      priority: "high",
    });
    clearRegistrationCookie(response);
    return response;
  } catch (error) {
    if (error instanceof AuthError) {
      const response = noStoreJson(
        { ok: false, error: error.message, code: error.code },
        { status: error.status },
      );
      if (error.code === "oauth_registration_expired") clearRegistrationCookie(response);
      return response;
    }
    if (error instanceof RateLimitError) return apiError(error);
    console.error("Social registration failed:", error);
    return noStoreJson(
      { ok: false, error: "Could not create the account.", code: "register_failed" },
      { status: 500 },
    );
  }
}
