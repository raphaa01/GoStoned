import { NextRequest, NextResponse } from "next/server";
import {
  exchangeOAuthCode,
  isOAuthProvider,
  oauthTransactionCookie,
  parseOAuthTransaction,
  type OAuthMode,
} from "@/lib/auth/oauth";
import { signInWithOAuthIdentity, type OAuthProvider } from "@/lib/auth/oauthAccountService";
import {
  consumeIpPolicyRateLimit,
  RATE_LIMIT_POLICIES,
  RateLimitError,
} from "@/lib/auth/rateLimit";
import { safeReauthenticationReturnPath } from "@/lib/auth/returnPath";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/auth/session";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/i18n/config";
import { localizePathname } from "@/lib/i18n/routing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CallbackParameters = {
  code: string | null;
  state: string | null;
  error: string | null;
  user: string | null;
};

const MAX_CALLBACK_BODY_BYTES = 16_384;
const MAX_CALLBACK_BODY_CHUNKS = 64;

function appOrigin(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").origin;
  } catch {
    return "http://localhost:3000";
  }
}

function pageUrl(mode: OAuthMode, locale: Locale, error?: string): URL {
  const path = localizePathname(mode === "register" ? "/register" : "/login", locale);
  const url = new URL(path, appOrigin());
  if (error) url.searchParams.set("oauthError", error);
  return url;
}

function clearTransactionCookie(response: NextResponse, provider: OAuthProvider) {
  response.cookies.set(oauthTransactionCookie(provider), "", {
    httpOnly: true,
    sameSite: provider === "apple" ? "none" : "lax",
    secure: provider === "apple" || process.env.NODE_ENV === "production",
    path: `/api/auth/oauth/${provider}`,
    maxAge: 0,
    priority: "high",
  });
}

function callbackRedirect(
  provider: OAuthProvider,
  url: URL,
  sessionToken?: string,
): NextResponse {
  // Apple returns to this route with a POST. A 303 intentionally converts the
  // next navigation to GET instead of replaying the provider form to /play.
  const response = NextResponse.redirect(url, 303);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  clearTransactionCookie(response, provider);
  if (sessionToken) {
    response.cookies.set(SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
      priority: "high",
    });
  }
  return response;
}

function queryParameters(request: NextRequest): CallbackParameters {
  return {
    code: request.nextUrl.searchParams.get("code"),
    state: request.nextUrl.searchParams.get("state"),
    error: request.nextUrl.searchParams.get("error"),
    user: request.nextUrl.searchParams.get("user"),
  };
}

async function formParameters(request: NextRequest): Promise<CallbackParameters> {
  const invalid = (): CallbackParameters => (
    { code: null, state: null, error: "invalid_request", user: null }
  );
  try {
    if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase()
      !== "application/x-www-form-urlencoded") return invalid();
    const contentLength = request.headers.get("content-length");
    const transferEncoding = request.headers.get("transfer-encoding");
    if (contentLength !== null && transferEncoding !== null) return invalid();
    const declaredLength = contentLength === null ? null : Number(contentLength);
    if (
      declaredLength !== null
      && (!/^\d+$/.test(contentLength as string)
        || !Number.isSafeInteger(declaredLength)
        || declaredLength > MAX_CALLBACK_BODY_BYTES)
    ) return invalid();
    if (!request.body) return invalid();

    const reader = request.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let encoded = "";
    let bytesRead = 0;
    let chunksRead = 0;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const stopped = new Promise<never>((_resolve, reject) => {
        const abort = () => reject(new Error("OAuth callback body aborted."));
        if (request.signal.aborted) abort();
        else request.signal.addEventListener("abort", abort, { once: true });
        deadline = setTimeout(() => reject(new Error("OAuth callback body timed out.")), 5_000);
      });
      while (true) {
        const chunk = await Promise.race([reader.read(), stopped]);
        if (chunk.done) break;
        chunksRead += 1;
        bytesRead += chunk.value.byteLength;
        if (chunksRead > MAX_CALLBACK_BODY_CHUNKS || bytesRead > MAX_CALLBACK_BODY_BYTES) {
          throw new Error("OAuth callback body is too large.");
        }
        encoded += decoder.decode(chunk.value, { stream: true });
      }
      encoded += decoder.decode();
    } catch {
      void reader.cancel().catch(() => undefined);
      return invalid();
    } finally {
      if (deadline !== undefined) clearTimeout(deadline);
    }
    if (declaredLength !== null && declaredLength !== bytesRead) return invalid();

    const form = new URLSearchParams(encoded);
    const supported = new Set(["code", "state", "error", "error_description", "user"]);
    const seen = new Set<string>();
    for (const [key] of form) {
      if (!supported.has(key) || seen.has(key)) return invalid();
      seen.add(key);
    }
    return {
      code: form.get("code"),
      state: form.get("state"),
      error: form.get("error"),
      user: form.get("user"),
    };
  } catch {
    return invalid();
  }
}

async function callback(
  request: NextRequest,
  providerValue: string,
  parameters: CallbackParameters,
) {
  if (!isOAuthProvider(providerValue)) {
    return new NextResponse("OAuth provider not found.", { status: 404 });
  }
  const provider = providerValue;
  const transaction = parseOAuthTransaction(
    request.cookies.get(oauthTransactionCookie(provider))?.value,
  );
  const mode = transaction?.mode ?? "login";
  const locale = transaction && isLocale(transaction.locale) ? transaction.locale : DEFAULT_LOCALE;
  const errorPage = (code: string) => callbackRedirect(provider, pageUrl(mode, locale, code));

  if (!transaction || !parameters.state || parameters.state !== transaction.state) {
    return errorPage("oauth_failed");
  }
  if (parameters.error) {
    return errorPage(parameters.error === "access_denied" ? "access_denied" : "oauth_failed");
  }
  if (!parameters.code || parameters.code.length > 4096) return errorPage("oauth_failed");

  try {
    await consumeIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.oauthCallbackAddress);
    const identity = await exchangeOAuthCode(
      provider,
      parameters.code,
      transaction,
      provider === "apple" ? parameters.user : null,
    );
    const login = await signInWithOAuthIdentity(identity);
    const safeReturnTo = safeReauthenticationReturnPath(transaction.returnTo ?? undefined);
    const logicalDestination = safeReturnTo ?? (mode === "register" ? "/profile" : "/play");
    const destination = new URL(localizePathname(logicalDestination, locale), appOrigin());
    return callbackRedirect(provider, destination, login.token);
  } catch (error) {
    if (!(error instanceof RateLimitError)) {
      console.error(`${provider} sign-in callback failed:`, error);
    }
    return errorPage("oauth_failed");
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  return callback(request, provider, queryParameters(request));
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  return callback(request, provider, await formParameters(request));
}
