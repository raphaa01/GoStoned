import { type NextRequest, NextResponse } from "next/server";
import { isLocale, LOCALE_COOKIE, preferredLocale } from "@/lib/i18n/config";
import { localizePathname } from "@/lib/i18n/routing";

export function proxy(request: NextRequest) {
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
    "/impressum/:path*",
    "/game/:path*",
  ],
};
