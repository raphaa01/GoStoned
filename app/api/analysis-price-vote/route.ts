import { NextRequest } from "next/server";
import { readBoundedJsonObject } from "@/lib/api/boundedJson";
import { apiError, noStoreJson } from "@/lib/api/responses";
import { parseAnalysisPriceVote } from "@/lib/analysis/priceVote";
import {
  getAnalysisPriceVote,
  saveAnalysisPriceVote,
} from "@/lib/analysis/priceVoteService";
import { assertAuthMutationRequest } from "@/lib/auth/credentialRequest";
import { assertExpectedPlayer } from "@/lib/auth/playerBindingServer";
import {
  consumeEphemeralIpPolicyRateLimit,
  consumePolicyRateLimit,
  RATE_LIMIT_POLICIES,
} from "@/lib/auth/rateLimit";
import { requireRequestUser } from "@/lib/auth/requestAuth";
import { GameServiceError } from "@/lib/game/gameService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function rejectSearch(request: NextRequest): void {
  if (request.nextUrl.search !== "") {
    throw new GameServiceError("The request is invalid.", 400, "invalid_request");
  }
}

export async function GET(request: NextRequest) {
  try {
    rejectSearch(request);
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    const user = await requireRequestUser(request);
    assertExpectedPlayer(request, user.playerKey);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.profileRead, user.playerKey);
    return noStoreJson({
      ok: true,
      actor: user.playerKey,
      monthlyPriceEur: await getAnalysisPriceVote(user.id),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    rejectSearch(request);
    assertAuthMutationRequest(request, { requireJson: true });
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    const user = await requireRequestUser(request);
    assertExpectedPlayer(request, user.playerKey);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.profileMutation, user.playerKey);
    const body = await readBoundedJsonObject(request, {
      maxBytes: 128,
      maxChunks: 32,
      idleTimeoutMs: 1_000,
      totalTimeoutMs: 2_000,
      invalidJson: () => new GameServiceError("The request body must be valid JSON.", 400, "invalid_request"),
      invalidObject: () => new GameServiceError("The request body must be a JSON object.", 400, "invalid_request"),
    });
    let monthlyPriceEur;
    try {
      monthlyPriceEur = parseAnalysisPriceVote(body);
    } catch {
      throw new GameServiceError("The analysis price vote is invalid.", 400, "invalid_request");
    }
    return noStoreJson({
      ok: true,
      actor: user.playerKey,
      monthlyPriceEur: await saveAnalysisPriceVote(user.id, monthlyPriceEur),
    });
  } catch (error) {
    return apiError(error);
  }
}
