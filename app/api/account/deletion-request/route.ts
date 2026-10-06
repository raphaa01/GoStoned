import { NextRequest } from "next/server";
import { readBoundedJsonObject } from "@/lib/api/boundedJson";
import { apiError, noStoreJson } from "@/lib/api/responses";
import { AuthError } from "@/lib/auth/accountService";
import { parseAccountDeletionRequest } from "@/lib/auth/accountDeletionContract";
import {
  accountDeletionEnabled, DELETION_RECEIPT_COOKIE, getAccountDeletionReceipt,
  getAccountDeletionRequest, requestAccountDeletion,
} from "@/lib/auth/accountDeletionService";
import { assertAuthMutationRequest } from "@/lib/auth/credentialRequest";
import { consumeEphemeralIpPolicyRateLimit, consumePolicyRateLimit, RATE_LIMIT_POLICIES } from "@/lib/auth/rateLimit";
import { resolvePlayerKey } from "@/lib/auth/requestAuth";
import { GameServiceError } from "@/lib/game/gameService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function validateQuery(request: NextRequest) {
  if (request.nextUrl.search !== "") throw new AuthError("The request is invalid.", 400, "invalid_request");
}

function deletionError(error: unknown) {
  if (error instanceof AuthError) {
    return noStoreJson({ ok: false, error: error.message, code: error.code }, { status: error.status });
  }
  return apiError(error);
}

export async function GET(request: NextRequest) {
  try {
    validateQuery(request);
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    if (!accountDeletionEnabled()) return noStoreJson({ ok: true, enabled: false, hasIdentity: false, request: null });
    let playerKey: string | null = null;
    try {
      playerKey = await resolvePlayerKey(request);
    } catch (error) {
      if (!(error instanceof GameServiceError) || error.status !== 401) throw error;
    }
    if (playerKey) {
      await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.profileRead, playerKey);
      const current = await getAccountDeletionRequest(playerKey);
      const previous = current ? null : await getAccountDeletionReceipt(request.cookies.get(DELETION_RECEIPT_COOKIE)?.value);
      return noStoreJson({ ok: true, enabled: true, hasIdentity: true,
        request: current ?? (previous?.status === "completed" ? previous : null) });
    }
    // The opaque receipt remains readable after sessions are revoked. It never
    // reveals a username, email, player key, or deletion evidence.
    return noStoreJson({ ok: true, enabled: true, hasIdentity: false,
      request: await getAccountDeletionReceipt(request.cookies.get(DELETION_RECEIPT_COOKIE)?.value) });
  } catch (error) {
    return deletionError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    validateQuery(request);
    assertAuthMutationRequest(request, { requireJson: true });
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    if (!accountDeletionEnabled()) throw new AuthError("Account deletion requests are temporarily unavailable.", 503, "deletion_unavailable");
    const playerKey = await resolvePlayerKey(request);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.profileMutation, playerKey);
    const body = await readBoundedJsonObject(request, {
      maxBytes: 1024, maxChunks: 1024, idleTimeoutMs: 1_000, totalTimeoutMs: 2_000,
      invalidJson: () => new AuthError("The request body must be valid JSON.", 400, "invalid_request"),
      invalidObject: () => new AuthError("The request body must be a JSON object.", 400, "invalid_request"),
    });
    let input;
    try { input = parseAccountDeletionRequest(body); }
    catch { throw new AuthError("Confirm deletion and check the optional email address.", 400, "invalid_request"); }
    const saved = await requestAccountDeletion(playerKey, input.email);
    const response = noStoreJson({ ok: true, request: saved.request });
    response.cookies.set(DELETION_RECEIPT_COOKIE, saved.token, {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax",
      path: "/api/account/deletion-request", maxAge: 60 * 60 * 24 * 37,
    });
    return response;
  } catch (error) {
    return deletionError(error);
  }
}
