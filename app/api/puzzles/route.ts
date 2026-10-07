import type { NextRequest } from "next/server";
import { apiError, noStoreJson } from "@/lib/api/responses";
import {
  consumeEphemeralIpPolicyRateLimit,
  consumePolicyRateLimit,
  RATE_LIMIT_POLICIES,
} from "@/lib/auth/rateLimit";
import { assertExpectedPlayer } from "@/lib/auth/playerBindingServer";
import { requireRequestUser, resolvePlayerKey } from "@/lib/auth/requestAuth";
import { readImportedPuzzleHub } from "@/lib/puzzles/importedService";
import { parsePuzzleMode } from "@/lib/puzzles/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const mode = parsePuzzleMode(request);
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    const playerKey = mode === "practice"
      ? (await requireRequestUser(request)).playerKey
      : await resolvePlayerKey(request);
    assertExpectedPlayer(request, playerKey);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.puzzleRead, playerKey);
    const hub = await readImportedPuzzleHub(playerKey, mode);
    return noStoreJson({ ok: true, actor: playerKey, ...hub });
  } catch (error) {
    return apiError(error);
  }
}
