import { type NextRequest, NextResponse } from "next/server";
import { isAnalyticsAdminAuthorized } from "@/lib/analytics/adminAuth";
import { isLocale, LOCALE_COOKIE, preferredLocale } from "@/lib/i18n/config";
import { localizePathname } from "@/lib/i18n/routing";

export function proxy(request: NextRequest) {
  const isAnalyticsPath = request.nextUrl.pathname === "/webanalytics"
    || request.nextUrl.pathname.startsWith("/webanalytics/");
  if (
    isAnalyticsPath
    && !isAnalyticsAdminAuthorized(request.headers.get("authorization"))
  ) {
    return new NextResponse("Authentication required.", {
      status: 401,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "WWW-Authenticate": 'Basic realm="GoStone Web Analytics", charset="UTF-8"',
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      },
    });
  }

  if (isAnalyticsPath) {
    const response = NextResponse.next();
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    return response;
  }

  const storedLocale = request.cookies.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(storedLocale)
    ? storedLocale
    : preferredLocale(request.headers.get("accept-language"));

  if (locale === "en") return NextResponse.next();

  const destination = request.nextUrl.clone();
  destination.pathname = localizePathname(destination.pathname, locale);
  return NextResponse.redirect(destination);
}

export const config = {
  matcher: [
    "/",
    "/play/:path*",
    "/puzzles/:path*",
    "/learn/:path*",
    "/review/:path*",
    "/leaderboard/:path*",
    "/login/:path*",
    "/register/:path*",
    "/profile/:path*",
    "/friends/:path*",
    "/impressum/:path*",
    "/game/:path*",
    "/webanalytics/:path*",
  ],
};
