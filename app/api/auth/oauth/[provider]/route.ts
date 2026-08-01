import { NextRequest, NextResponse } from "next/server";
import { safeReauthenticationReturnPath } from "@/lib/auth/returnPath";
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

function authPage(mode: OAuthMode, locale: Locale, origin: string, error?: string): URL {
  const path = localizePathname(mode === "register" ? "/register" : "/login", locale);
  const url = new URL(path, origin);
  if (error) url.searchParams.set("oauthError", error);
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
  const returnTo = mode === "login"
    ? safeReauthenticationReturnPath(request.nextUrl.searchParams.get("returnTo") ?? undefined)
    : null;

  try {
    const { authorizationUrl, transaction } = createOAuthAuthorization(providerValue, {
      mode,
      locale,
      returnTo,
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
    return NextResponse.redirect(authPage(mode, locale, request.nextUrl.origin, "provider_unavailable"));
  }
}
