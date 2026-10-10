import type { NextRequest } from "next/server";
import { readBoundedJsonObject } from "@/lib/api/boundedJson";
import { apiError, noStoreJson } from "@/lib/api/responses";
import { AuthError } from "@/lib/auth/accountService";
import { assertAuthMutationRequest } from "@/lib/auth/credentialRequest";
import { requireRequestUser } from "@/lib/auth/requestAuth";
import { consumeEphemeralIpPolicyRateLimit, RATE_LIMIT_POLICIES } from "@/lib/auth/rateLimit";
import type { BoardSize, Position } from "@/lib/game/types";
import { scoreLearnGame } from "@/lib/learn/gameScoring";

export const runtime = "nodejs";
const invalid = () => new AuthError("Invalid learning game settlement.", 400, "invalid_request");
function point(value: unknown, size: BoardSize): Position {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const p = value as Record<string, unknown>;
  if (Object.keys(p).length !== 2 || !Number.isInteger(p.x) || !Number.isInteger(p.y) || Number(p.x) < 0 || Number(p.x) >= size || Number(p.y) < 0 || Number(p.y) >= size) throw invalid();
  return { x: Number(p.x), y: Number(p.y) };
}
export async function POST(request: NextRequest) {
  try {
    assertAuthMutationRequest(request, { requireJson: true });
    if (request.nextUrl.search) throw invalid();
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    await requireRequestUser(request);
    const body = await readBoundedJsonObject(request, { maxBytes: 131_072, maxChunks: 256, idleTimeoutMs: 1_000, totalTimeoutMs: 2_000, invalidJson: invalid });
    const size = body.boardSize === undefined ? 9 : body.boardSize;
    if (size !== 9 && size !== 13 && size !== 19) throw invalid();
    const allowed = new Set(["moves", "deadStones", "neutralRegionSeeds", "agreed", "boardSize"]);
    if (Object.keys(body).some((key) => !allowed.has(key)) || body.agreed !== true || !Array.isArray(body.moves) || body.moves.length > 3000 || !Array.isArray(body.deadStones) || body.deadStones.length > size * size || !Array.isArray(body.neutralRegionSeeds) || body.neutralRegionSeeds.length > size * size) throw invalid();
    const moves = body.moves.map((p: unknown) => p === null ? null : point(p, size));
    const dead = body.deadStones.map((p: unknown) => point(p, size));
    const neutral = body.neutralRegionSeeds.map((p: unknown) => point(p, size));
    try {
      return noStoreJson({ ok: true, result: scoreLearnGame(moves, dead, neutral, size) });
    } catch {
      throw invalid();
    }
  } catch (error) {
    if (error instanceof AuthError) return noStoreJson({ok:false,error:error.message,code:error.code},{status:error.status});
    return apiError(error);
  }
}
