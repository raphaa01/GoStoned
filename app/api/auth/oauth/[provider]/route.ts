import { NextRequest, NextResponse } from "next/server";
import { safeAuthReturnPath } from "@/lib/auth/returnPath";
import {
  createOAuthAuthorization,
  isOAuthProvider,
  OAuthConfigurationError,
  oauthTransactionCookie,
  serializeOAuthTransaction,
  type OAuthMode,
} from "@/lib/auth/oauth";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/i18n/config";
import { localizePathname } from "@/lib/i18n/routing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authPage(
  mode: OAuthMode,
  locale: Locale,
  origin: string,
  error?: string,
  returnTo?: string | null,
): URL {
  const path = localizePathname(mode === "register" ? "/register" : "/login", locale);
  const url = new URL(path, origin);
  if (error) url.searchParams.set("oauthError", error);
  if (returnTo) url.searchParams.set("returnTo", returnTo);
  return url;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: providerValue } = await params;
  if (!isOAuthProvider(providerValue)) {
    return new NextResponse("OAuth provider not found.", { status: 404 });
  }
  const mode: OAuthMode = request.nextUrl.searchParams.get("mode") === "register"
    ? "register"
    : "login";
  const localeValue = request.nextUrl.searchParams.get("locale");
  const locale = localeValue && isLocale(localeValue) ? localeValue : DEFAULT_LOCALE;
  const returnTo = safeAuthReturnPath(
    request.nextUrl.searchParams.get("returnTo") ?? undefined,
  );
  const mobileCodeChallenge = request.nextUrl.searchParams.get("mobileChallenge");
  if (mobileCodeChallenge !== null && !/^[A-Za-z0-9_-]{43}$/.test(mobileCodeChallenge)) {
    return new NextResponse("Invalid mobile OAuth challenge.", { status: 400 });
  }

  try {
    const { authorizationUrl, transaction } = createOAuthAuthorization(providerValue, {
      mode,
      locale,
      returnTo,
      ...(mobileCodeChallenge ? { mobileCodeChallenge } : {}),
    });
    const response = NextResponse.redirect(authorizationUrl);
    response.headers.set("Cache-Control", "no-store, max-age=0");
    response.cookies.set(oauthTransactionCookie(providerValue), serializeOAuthTransaction(transaction), {
      httpOnly: true,
      sameSite: providerValue === "apple" ? "none" : "lax",
      secure: providerValue === "apple" || process.env.NODE_ENV === "production",
      path: `/api/auth/oauth/${providerValue}`,
      maxAge: 10 * 60,
      priority: "high",
    });
    return response;
  } catch (error) {
    if (!(error instanceof OAuthConfigurationError)) {
      console.error(`Could not start ${providerValue} sign-in:`, error);
    }
    if (mobileCodeChallenge) {
      const callback = new URL("com.gostone.app://oauth");
      callback.searchParams.set("error", "provider_unavailable");
      return NextResponse.redirect(callback, 303);
    }
    return NextResponse.redirect(
      authPage(mode, locale, request.nextUrl.origin, "provider_unavailable", returnTo),
    );
  }
}
