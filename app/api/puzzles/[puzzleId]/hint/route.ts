import type { NextRequest } from "next/server";
import { noStoreJson } from "@/lib/api/responses";
import {
  consumeEphemeralIpPolicyRateLimit,
  consumePolicyRateLimit,
  RATE_LIMIT_POLICIES,
} from "@/lib/auth/rateLimit";
import { assertExpectedPlayer } from "@/lib/auth/playerBindingServer";
import { getRequestUser, resolvePlayerKey } from "@/lib/auth/requestAuth";
import { gameMutationRouteError } from "@/lib/game/gameMutationRequest";
import { GameServiceError } from "@/lib/game/gameService";
import { readPuzzleHint } from "@/lib/puzzles/puzzleService";
import { assertPuzzleId } from "@/lib/puzzles/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ puzzleId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const { puzzleId } = await context.params;
    assertPuzzleId(puzzleId);
    if (request.nextUrl.search !== "") {
      throw new GameServiceError("The puzzle request is invalid.", 400, "invalid_puzzle_request");
    }
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    const account = await getRequestUser(request);
    const playerKey = account?.playerKey ?? await resolvePlayerKey(request);
    assertExpectedPlayer(request, playerKey);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.puzzleAttempt, playerKey);
    return noStoreJson({
      ok: true,
      actor: playerKey,
      hint: await readPuzzleHint(puzzleId, playerKey, Boolean(account)),
    });
  } catch (error) {
    return gameMutationRouteError(error);
  }
}
