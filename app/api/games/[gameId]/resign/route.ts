import { NextRequest } from "next/server";
import { apiError, noStoreJson } from "@/lib/api/responses";
import { resignGame } from "@/lib/game/gameService";
import { isValidPlayerKey } from "@/lib/matchmaking/matchmakingService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ gameId: string }> },
) {
  try {
    const body = (await request.json()) as { playerKey?: unknown };
    if (!isValidPlayerKey(body.playerKey)) {
      return noStoreJson({ ok: false, error: "Invalid player key." }, { status: 400 });
    }
    const { gameId } = await context.params;
    const game = await resignGame(gameId, body.playerKey);
    return noStoreJson({ ok: true, game });
  } catch (error) {
    return apiError(error);
  }
}
