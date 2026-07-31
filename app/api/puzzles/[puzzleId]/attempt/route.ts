import type { NextRequest } from "next/server";
import { noStoreJson } from "@/lib/api/responses";
import {
  consumeEphemeralIpPolicyRateLimit,
  consumePolicyRateLimit,
  RATE_LIMIT_POLICIES,
} from "@/lib/auth/rateLimit";
import { assertExpectedPlayer } from "@/lib/auth/playerBindingServer";
import { resolvePlayerKey } from "@/lib/auth/requestAuth";
import { gameMutationRouteError } from "@/lib/game/gameMutationRequest";
import { attemptPuzzle } from "@/lib/puzzles/puzzleService";
import {
  assertPuzzleAttemptMetadata,
  assertPuzzleId,
  readPuzzleAttemptBody,
} from "@/lib/puzzles/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ puzzleId: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const { puzzleId } = await context.params;
    assertPuzzleId(puzzleId);
    assertPuzzleAttemptMetadata(request);
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    const playerKey = await resolvePlayerKey(request);
    assertExpectedPlayer(request, playerKey);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.puzzleAttempt, playerKey);
    const selected = await readPuzzleAttemptBody(request);
    return noStoreJson({
      ok: true,
      actor: playerKey,
      attempt: await attemptPuzzle(puzzleId, playerKey, selected),
    });
  } catch (error) {
    return gameMutationRouteError(error);
  }
}
