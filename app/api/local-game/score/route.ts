import type { NextRequest } from "next/server";
import { readBoundedJsonObject } from "@/lib/api/boundedJson";
import { apiError, noStoreJson } from "@/lib/api/responses";
import { AuthError } from "@/lib/auth/accountService";
import { assertAuthMutationRequest } from "@/lib/auth/credentialRequest";
import { consumeEphemeralIpPolicyRateLimit, RATE_LIMIT_POLICIES } from "@/lib/auth/rateLimit";
import { scoreLocalSettlement } from "@/lib/game/localSettlement";

export const runtime = "nodejs";
const invalid = () => new AuthError("Invalid local settlement.", 400, "invalid_request");

// Stateless rulebook scoring: no player, game, rating or history rows are created.
export async function POST(request: NextRequest) {
  try {
    assertAuthMutationRequest(request, { requireJson: true });
    if (request.nextUrl.search) throw invalid();
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    const body = await readBoundedJsonObject(request, { maxBytes: 131_072, maxChunks: 256,
      idleTimeoutMs: 1_000, totalTimeoutMs: 2_000, invalidJson: invalid, invalidObject: invalid });
    let settlement;
    try { settlement = scoreLocalSettlement(body); }
    catch { throw invalid(); }
    return noStoreJson({ ok: true, ...settlement });
  } catch (error) {
    if (error instanceof AuthError) return noStoreJson({ ok: false, error: error.message, code: error.code }, { status: error.status });
    return apiError(error);
  }
}
