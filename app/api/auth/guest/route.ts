import { NextRequest } from "next/server";
import { noStoreJson } from "@/lib/api/responses";
import { consumeRateLimit, RateLimitError } from "@/lib/auth/rateLimit";
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
    const current = await getGuestSessionIdentity(
      request.cookies.get(GUEST_SESSION_COOKIE)?.value,
    );
    if (current) return noStoreJson({ ok: true, identity: current });

    await consumeRateLimit(request, "guest-session", "all-guests", 20, 60);
    const { identity, token } = await createGuestSession();
    const response = noStoreJson({ ok: true, identity }, { status: 201 });
    response.cookies.set(GUEST_SESSION_COOKIE, token, guestSessionCookieOptions());
    return response;
  } catch (error) {
    if (error instanceof RateLimitError) {
      return noStoreJson({ ok: false, error: error.message }, { status: 429 });
    }
    console.error("Guest session creation failed:", error);
    return noStoreJson(
      { ok: false, error: "Could not prepare a secure guest session." },
      { status: 500 },
    );
  }
}
