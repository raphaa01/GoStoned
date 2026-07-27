import { NextRequest } from "next/server";
import { noStoreJson } from "@/lib/api/responses";
import { AuthError, registerAccount, validateCredentials } from "@/lib/auth/accountService";
import { consumeRateLimit, RateLimitError } from "@/lib/auth/rateLimit";
import {
  createSession,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { username?: unknown; password?: unknown };
    const credentials = validateCredentials(body.username, body.password);
    await consumeRateLimit(request, "register", "all-accounts", 5, 60);
    const user = await registerAccount(credentials.username, credentials.password);
    const token = await createSession(user.id);
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
      return noStoreJson({ ok: false, error: error.message }, { status: 429 });
    }
    console.error("Registration failed:", error);
    return noStoreJson({ ok: false, error: "Could not create the account." }, { status: 500 });
  }
}
