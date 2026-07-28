import { NextRequest } from "next/server";
import { noStoreJson } from "@/lib/api/responses";
import {
  isLocale,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE_SECONDS,
} from "@/lib/i18n/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  const requestOrigin = request.headers.get("origin");
  if (
    contentType !== "application/json"
    || request.headers.get("sec-fetch-site") === "cross-site"
    || (requestOrigin && requestOrigin !== request.nextUrl.origin)
  ) {
    return noStoreJson(
      { ok: false, error: "The locale request is not allowed.", code: "locale_request_rejected" },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return noStoreJson(
      { ok: false, error: "A supported locale is required.", code: "invalid_locale" },
      { status: 400 },
    );
  }
  if (
    !body
    || typeof body !== "object"
    || Array.isArray(body)
    || !isLocale((body as { locale?: unknown }).locale)
  ) {
    return noStoreJson(
      { ok: false, error: "A supported locale is required.", code: "invalid_locale" },
      { status: 400 },
    );
  }
  const locale = (body as { locale: "en" | "de" }).locale;
  const response = noStoreJson({ ok: true, locale });
  response.cookies.set(LOCALE_COOKIE, locale, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE_SECONDS,
    priority: "low",
  });
  return response;
}
