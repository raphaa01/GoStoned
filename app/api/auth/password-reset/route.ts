import { after, type NextRequest } from "next/server";
import { apiError, noStoreJson } from "@/lib/api/responses";
import { AuthError } from "@/lib/auth/accountService";
import { assertAuthMutationRequest, readCredentialBody } from "@/lib/auth/credentialRequest";
import { requireEmail } from "@/lib/auth/email";
import { consumeIpPolicyRateLimit, consumeSubjectPolicyRateLimit } from "@/lib/auth/rateLimit";
import { requestPasswordReset, resetAccountPassword } from "@/lib/auth/passwordResetService";
import { resetEmailConfiguration, sendPasswordResetEmail } from "@/lib/auth/resetEmail";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    assertAuthMutationRequest(request, { requireJson: true });
    await consumeIpPolicyRateLimit(request, { scope: "password-reset-address", limit: 30, windowMinutes: 15 });
    const body = await readCredentialBody(request);
    const keys = Object.keys(body).sort().join(",");
    if (body.action === "request" && keys === "action,email") {
      const email = requireEmail(body.email);
      resetEmailConfiguration();
      await consumeSubjectPolicyRateLimit({ scope: "password-reset-send", limit: 5, windowMinutes: 60 }, email);
      // Account lookup and delivery happen after the same public response for
      // every address, preventing timing-based account enumeration.
      after(async () => {
        try { await requestPasswordReset(email, sendPasswordResetEmail); }
        catch { console.error("Password reset request failed."); }
      });
      return noStoreJson({ ok: true });
    }
    if (body.action === "reset" && keys === "action,code,email,password") {
      const email = requireEmail(body.email);
      await consumeSubjectPolicyRateLimit({ scope: "password-reset-redeem", limit: 10, windowMinutes: 15 }, email);
      await resetAccountPassword(email, body.code, body.password);
      return noStoreJson({ ok: true });
    }
    throw new AuthError("Invalid request.", 400, "invalid_request");
  } catch (error) {
    if (error instanceof AuthError) {
      return noStoreJson({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    return apiError(error);
  }
}
