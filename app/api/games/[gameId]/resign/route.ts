import { NextRequest } from "next/server";
import { apiError, noStoreJson } from "@/lib/api/responses";
import { resolvePlayerKey } from "@/lib/auth/requestAuth";
import { resignGame } from "@/lib/game/gameService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ gameId: string }> },
) {
  try {
    const body = (await request.json()) as { playerKey?: unknown };
    const playerKey = await resolvePlayerKey(request, body.playerKey);
    const { gameId } = await context.params;
    const game = await resignGame(gameId, playerKey);
    return noStoreJson({ ok: true, game });
  } catch (error) {
    return apiError(error);
  }
}
