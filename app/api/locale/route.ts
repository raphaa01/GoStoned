import { NextRequest } from "next/server";
import { apiError, noStoreJson } from "@/lib/api/responses";
import {
  consumeEphemeralIpPolicyRateLimit,
  RATE_LIMIT_POLICIES,
} from "@/lib/auth/rateLimit";
import {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE_SECONDS,
} from "@/lib/i18n/config";
import {
  assertLocaleMutationMetadata,
  LocaleMutationRequestError,
  readLocaleMutation,
} from "@/lib/i18n/localeMutationRequest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertLocaleMutationMetadata(request);
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.localePreference);
    const locale = await readLocaleMutation(request);
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
  } catch (error) {
    if (error instanceof LocaleMutationRequestError) {
      return noStoreJson(
        { ok: false, error: error.message, code: error.code },
        { status: error.status },
      );
    }
    return apiError(error);
  }
}
