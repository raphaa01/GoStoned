import { NextRequest } from "next/server";
import { readBoundedJsonObject } from "@/lib/api/boundedJson";
import { apiError, noStoreJson } from "@/lib/api/responses";
import { AuthError } from "@/lib/auth/accountService";
import { assertAuthMutationRequest } from "@/lib/auth/credentialRequest";
import { consumeMobileOAuthHandoff } from "@/lib/auth/mobileOAuthHandoff";
import {
  beginOAuthSignIn,
  OAUTH_REGISTRATION_COOKIE,
  OAUTH_REGISTRATION_MAX_AGE_SECONDS,
} from "@/lib/auth/oauthAccountService";
import { consumeIpPolicyRateLimit, RATE_LIMIT_POLICIES, RateLimitError } from "@/lib/auth/rateLimit";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertAuthMutationRequest(request, { requireJson: true });
    await consumeIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.loginAddress);
    const body = await readBoundedJsonObject(request, {
      maxBytes: 512,
      maxChunks: 64,
      idleTimeoutMs: 1_000,
      totalTimeoutMs: 2_000,
      invalidJson: () => new AuthError("Invalid OAuth handoff.", 400, "invalid_request"),
      invalidObject: () => new AuthError("Invalid OAuth handoff.", 400, "invalid_request"),
    });
    if (Object.keys(body).length !== 2
      || typeof body.code !== "string" || typeof body.verifier !== "string") {
      throw new AuthError("Invalid OAuth handoff.", 400, "invalid_request");
    }
    const identity = await consumeMobileOAuthHandoff(body.code, body.verifier);
    if (!identity) throw new AuthError("OAuth handoff expired or was already used.", 401, "oauth_handoff_expired");
    const login = await beginOAuthSignIn(identity);
    const response = noStoreJson({ ok: true, kind: login.kind,
      ...(login.kind === "authenticated" ? { user: login.user } : {}) });
    if (login.kind === "authenticated") {
      response.cookies.set(SESSION_COOKIE, login.token, {
        httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
        path: "/", maxAge: SESSION_MAX_AGE_SECONDS, priority: "high",
      });
      response.cookies.set(OAUTH_REGISTRATION_COOKIE, "", {
        httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
        path: "/", maxAge: 0, priority: "high",
      });
    } else {
      response.cookies.set(SESSION_COOKIE, "", {
        httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
        path: "/", maxAge: 0, priority: "high",
      });
      response.cookies.set(OAUTH_REGISTRATION_COOKIE, login.token, {
        httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
        path: "/", maxAge: OAUTH_REGISTRATION_MAX_AGE_SECONDS, priority: "high",
      });
    }
    return response;
  } catch (error) {
    if (error instanceof AuthError) {
      return noStoreJson({ ok: false, code: error.code, error: error.message }, { status: error.status });
    }
    if (error instanceof RateLimitError) return apiError(error);
    console.error("Mobile OAuth handoff failed:", error);
    return noStoreJson({ ok: false, code: "oauth_handoff_failed" }, { status: 500 });
  }
}
