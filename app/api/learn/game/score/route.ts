import type { NextRequest } from "next/server";
import { readBoundedJsonObject } from "@/lib/api/boundedJson";
import { apiError, noStoreJson } from "@/lib/api/responses";
import { AuthError } from "@/lib/auth/accountService";
import { assertAuthMutationRequest } from "@/lib/auth/credentialRequest";
import { requireRequestUser } from "@/lib/auth/requestAuth";
import { consumeEphemeralIpPolicyRateLimit, RATE_LIMIT_POLICIES } from "@/lib/auth/rateLimit";
import type { Position } from "@/lib/game/types";
import { scoreLearnGame } from "@/lib/learn/gameScoring";

export const runtime = "nodejs";
const invalid = () => new AuthError("Invalid learning game settlement.", 400, "invalid_request");
function point(value: unknown): Position {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const p = value as Record<string, unknown>;
  if (Object.keys(p).length !== 2 || !Number.isInteger(p.x) || !Number.isInteger(p.y) || Number(p.x) < 0 || Number(p.x) > 8 || Number(p.y) < 0 || Number(p.y) > 8) throw invalid();
  return { x: Number(p.x), y: Number(p.y) };
}
export async function POST(request: NextRequest) {
  try {
    assertAuthMutationRequest(request, { requireJson: true });
    if (request.nextUrl.search) throw invalid();
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    await requireRequestUser(request);
    const body = await readBoundedJsonObject(request, { maxBytes: 32_768, maxChunks: 256, idleTimeoutMs: 1_000, totalTimeoutMs: 2_000, invalidJson: invalid });
    if (Object.keys(body).length !== 4 || body.agreed !== true || !Array.isArray(body.moves) || body.moves.length > 600 || !Array.isArray(body.deadStones) || body.deadStones.length > 81 || !Array.isArray(body.neutralRegionSeeds) || body.neutralRegionSeeds.length > 81) throw invalid();
    const moves = body.moves.map((p: unknown) => p === null ? null : point(p));
    const dead = body.deadStones.map(point);
    const neutral = body.neutralRegionSeeds.map(point);
    try {
      return noStoreJson({ ok: true, result: scoreLearnGame(moves, dead, neutral) });
    } catch {
      throw invalid();
    }
  } catch (error) {
    if (error instanceof AuthError) return noStoreJson({ok:false,error:error.message,code:error.code},{status:error.status});
    return apiError(error);
  }
}
