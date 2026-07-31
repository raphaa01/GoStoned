import type { NextRequest } from "next/server";
import { after } from "next/server";
import { apiError, noStoreJson } from "@/lib/api/responses";
import {
  consumeEphemeralIpPolicyRateLimit,
  consumePolicyRateLimit,
  RATE_LIMIT_POLICIES,
} from "@/lib/auth/rateLimit";
import { assertExpectedPlayer } from "@/lib/auth/playerBindingServer";
import { resolvePlayerKey } from "@/lib/auth/requestAuth";
import { readPuzzleHub } from "@/lib/puzzles/puzzleService";
import { parsePuzzleMode } from "@/lib/puzzles/request";
import { dispatchKataGoJob, safelyDispatch } from "@/lib/katago/dispatch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const mode = parsePuzzleMode(request);
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    const playerKey = await resolvePlayerKey(request);
    assertExpectedPlayer(request, playerKey);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.puzzleRead, playerKey);
    const hub = await readPuzzleHub(playerKey, mode);
    if (hub.status === "generating") {
      after(() => safelyDispatch(() => dispatchKataGoJob("puzzle")));
    }
    return noStoreJson({ ok: true, actor: playerKey, ...hub });
  } catch (error) {
    return apiError(error);
  }
}
