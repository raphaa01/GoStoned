import { NextRequest } from "next/server";
import { apiError, noStoreJson } from "@/lib/api/responses";
import { getGameState } from "@/lib/game/gameService";
import { isValidPlayerKey } from "@/lib/matchmaking/matchmakingService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ gameId: string }> },
) {
  const playerKey = request.nextUrl.searchParams.get("playerKey");
  if (!isValidPlayerKey(playerKey)) {
    return noStoreJson({ ok: false, error: "Invalid player key." }, { status: 400 });
  }

  try {
    const { gameId } = await context.params;
    const game = await getGameState(gameId, playerKey);
    return noStoreJson({ ok: true, game });
  } catch (error) {
    return apiError(error);
  }
}
