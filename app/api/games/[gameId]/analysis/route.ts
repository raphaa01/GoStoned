import { after, NextRequest } from "next/server";
import { noStoreJson } from "@/lib/api/responses";
import {
  readGameAnalysis,
  queueGameAnalysis,
  WeeklyAnalysisLimitError,
} from "@/lib/analysis/analysisService";
import {
  consumeEphemeralIpPolicyRateLimit,
  consumePolicyRateLimit,
  RATE_LIMIT_POLICIES,
} from "@/lib/auth/rateLimit";
import { assertExpectedPlayer } from "@/lib/auth/playerBindingServer";
import { requireRequestUser } from "@/lib/auth/requestAuth";
import {
  assertEmptyGameMutationBody,
  assertGameMutationMetadata,
  gameMutationRouteError,
} from "@/lib/game/gameMutationRequest";
import { dispatchKataGoJob, safelyDispatch } from "@/lib/katago/dispatch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ gameId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const { gameId } = await context.params;
    assertGameMutationMetadata(request, gameId, "none");
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    const user = await requireRequestUser(request);
    const playerKey = user.playerKey;
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
    const user = await requireRequestUser(request);
    const playerKey = user.playerKey;
    assertExpectedPlayer(request, playerKey);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.analysisRequest, playerKey);
    const queued = await queueGameAnalysis(gameId, playerKey, user.id);
    after(() => safelyDispatch(() => dispatchKataGoJob("analysis", queued.analysis.id)));
    return noStoreJson({ ok: true, actor: playerKey, ...queued }, { status: 202 });
  } catch (error) {
    if (error instanceof WeeklyAnalysisLimitError) {
      return noStoreJson(
        {
          ok: false,
          error: error.message,
          code: error.code,
          retryAfterSeconds: error.retryAfterSeconds,
        },
        {
          status: error.status,
          headers: { "Retry-After": String(error.retryAfterSeconds) },
        },
      );
    }
    return gameMutationRouteError(error);
  }
}
