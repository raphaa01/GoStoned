import { NextRequest } from "next/server";
import { apiError, noStoreJson } from "@/lib/api/responses";
import { AuthError } from "@/lib/auth/accountService";
import { assertAuthMutationRequest } from "@/lib/auth/credentialRequest";
import {
  consumeIpPolicyRateLimit,
  RATE_LIMIT_POLICIES,
  RateLimitError,
} from "@/lib/auth/rateLimit";
import {
  createGuestSession,
  getGuestSessionIdentity,
  GUEST_SESSION_COOKIE,
  guestSessionCookieOptions,
} from "@/lib/auth/guestSession";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertAuthMutationRequest(request, { requireJson: true });
    await consumeIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.guestSessionLookup);
    const current = await getGuestSessionIdentity(
      request.cookies.get(GUEST_SESSION_COOKIE)?.value,
    );
    if (current) return noStoreJson({ ok: true, identity: current });

    await consumeIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.guestSessionBurst);
    await consumeIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.guestSessionCreate);
    const { identity, token } = await createGuestSession();
    const response = noStoreJson({ ok: true, identity }, { status: 201 });
    response.cookies.set(GUEST_SESSION_COOKIE, token, guestSessionCookieOptions());
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
    console.error("Guest session creation failed:", error);
    return noStoreJson(
      {
        ok: false,
        error: "Could not prepare a secure guest session.",
        code: "guest_session_failed",
      },
      { status: 500 },
    );
  }
}
