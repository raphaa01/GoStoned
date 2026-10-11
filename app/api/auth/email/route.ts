import type { NextRequest } from "next/server";
import { noStoreJson, apiError } from "@/lib/api/responses";
import { AuthError } from "@/lib/auth/accountService";
import { completeAccountEmail } from "@/lib/auth/accountEmailService";
import { readCredentialBody, assertAuthMutationRequest } from "@/lib/auth/credentialRequest";
import { getRequestUser } from "@/lib/auth/requestAuth";
import { consumeIpPolicyRateLimit } from "@/lib/auth/rateLimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertAuthMutationRequest(request, { requireJson: true });
    await consumeIpPolicyRateLimit(request, { scope: "account-email", limit: 20, windowMinutes: 15 });
    const user = await getRequestUser(request, { allowIncomplete: true });
    if (!user) throw new AuthError("Please log in first.", 401, "authentication_required");
    const body = await readCredentialBody(request);
    if (Object.keys(body).length !== 1 || !("email" in body)) {
      throw new AuthError("Enter an email address.", 400, "invalid_request");
    }
    return noStoreJson({ ok: true, user: await completeAccountEmail(user.id, body.email) });
  } catch (error) {
    if (error instanceof AuthError) {
      return noStoreJson({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    return apiError(error);
  }
}
