import { NextRequest } from "next/server";
import { noStoreJson } from "@/lib/api/responses";
import { readGameAnalysis, queueGameAnalysis } from "@/lib/analysis/analysisService";
import {
  consumeEphemeralIpPolicyRateLimit,
  consumePolicyRateLimit,
  RATE_LIMIT_POLICIES,
} from "@/lib/auth/rateLimit";
import { assertExpectedPlayer } from "@/lib/auth/playerBindingServer";
import { resolvePlayerKey } from "@/lib/auth/requestAuth";
import {
  assertEmptyGameMutationBody,
  assertGameMutationMetadata,
  gameMutationRouteError,
} from "@/lib/game/gameMutationRequest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ gameId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const { gameId } = await context.params;
    assertGameMutationMetadata(request, gameId, "none");
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    const playerKey = await resolvePlayerKey(request);
    assertExpectedPlayer(request, playerKey);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.analysisRead, playerKey);
    return noStoreJson({ ok: true, actor: playerKey, ...await readGameAnalysis(gameId, playerKey) });
  } catch (error) {
    return gameMutationRouteError(error);
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const { gameId } = await context.params;
    assertGameMutationMetadata(request, gameId, "none");
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    await assertEmptyGameMutationBody(request);
    const playerKey = await resolvePlayerKey(request);
    assertExpectedPlayer(request, playerKey);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.analysisRequest, playerKey);
    return noStoreJson({ ok: true, actor: playerKey, ...await queueGameAnalysis(gameId, playerKey) }, { status: 202 });
  } catch (error) {
    return gameMutationRouteError(error);
  }
}
