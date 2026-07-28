import { NextRequest } from "next/server";
import { apiError, noStoreJson } from "@/lib/api/responses";
import { resolvePlayerKey } from "@/lib/auth/requestAuth";
import { getGameState } from "@/lib/game/gameService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ gameId: string }> },
) {
  try {
    const playerKey = await resolvePlayerKey(request);
    const { gameId } = await context.params;
    const game = await getGameState(gameId, playerKey);
    return noStoreJson({ ok: true, game });
  } catch (error) {
    return apiError(error);
  }
}
