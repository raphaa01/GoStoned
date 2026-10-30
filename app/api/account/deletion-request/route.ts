import { NextRequest } from "next/server";
import { readBoundedJsonObject } from "@/lib/api/boundedJson";
import { apiError, noStoreJson } from "@/lib/api/responses";
import { AuthError } from "@/lib/auth/accountService";
import { parseAccountDeletionRequest } from "@/lib/auth/accountDeletionContract";
import {
  DELETION_RECEIPT_COOKIE, getAccountDeletionReceipt,
  getAccountDeletionRequest, requestAccountDeletion,
} from "@/lib/auth/accountDeletionService";
import { assertAuthMutationRequest } from "@/lib/auth/credentialRequest";
import { consumeEphemeralIpPolicyRateLimit, consumePolicyRateLimit, RATE_LIMIT_POLICIES } from "@/lib/auth/rateLimit";
import { resolvePlayerKey } from "@/lib/auth/requestAuth";
import { GameServiceError } from "@/lib/game/gameService";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { GUEST_SESSION_COOKIE } from "@/lib/auth/guestSession";
import { OAUTH_REGISTRATION_COOKIE } from "@/lib/auth/oauthAccountService";
import { EXPECTED_PLAYER_HEADER } from "@/lib/auth/playerBinding";
import { assertExpectedPlayer } from "@/lib/auth/playerBindingServer";

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
    let playerKey: string | null = null;
    try {
      playerKey = await resolvePlayerKey(request, undefined, { allowIncomplete: true });
    } catch (error) {
      if (!(error instanceof GameServiceError) || error.status !== 401) throw error;
    }
    if (playerKey) {
      await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.profileRead, playerKey);
      const current = await getAccountDeletionRequest(playerKey);
      return noStoreJson({ ok: true, enabled: true, hasIdentity: true, actor: playerKey,
        request: current });
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
    const playerKey = await resolvePlayerKey(request, undefined, { allowIncomplete: true });
    // Updated clients bind confirmation to the identity shown in the form.
    // Released clients without this header remain able to delete their account.
    if (request.headers.has(EXPECTED_PLAYER_HEADER)) assertExpectedPlayer(request, playerKey);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.profileMutation, playerKey);
    const body = await readBoundedJsonObject(request, {
      maxBytes: 1024, maxChunks: 1024, idleTimeoutMs: 1_000, totalTimeoutMs: 2_000,
      invalidJson: () => new AuthError("The request body must be valid JSON.", 400, "invalid_request"),
      invalidObject: () => new AuthError("The request body must be a JSON object.", 400, "invalid_request"),
    });
    try { parseAccountDeletionRequest(body); }
    catch { throw new AuthError("Confirm account deletion.", 400, "invalid_request"); }
    const saved = await requestAccountDeletion(playerKey);
    const response = noStoreJson({ ok: true, request: saved.request });
    response.cookies.set(DELETION_RECEIPT_COOKIE, saved.token, {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax",
      path: "/api/account/deletion-request", maxAge: 60 * 60 * 24 * 30,
    });
    for (const name of [SESSION_COOKIE, GUEST_SESSION_COOKIE, OAUTH_REGISTRATION_COOKIE]) {
      response.cookies.set(name, "", { httpOnly: true, secure: process.env.NODE_ENV === "production",
        sameSite: "lax", path: "/", maxAge: 0 });
    }
    return response;
  } catch (error) {
    return deletionError(error);
  }
}
