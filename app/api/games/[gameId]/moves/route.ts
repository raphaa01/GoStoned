import { NextRequest } from "next/server";
import { apiError, noStoreJson } from "@/lib/api/responses";
import { submitMove } from "@/lib/game/gameService";
import { isValidPlayerKey } from "@/lib/matchmaking/matchmakingService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ gameId: string }> },
) {
  try {
    const body = (await request.json()) as {
      playerKey?: unknown;
      x?: unknown;
      y?: unknown;
      isPass?: unknown;
    };
    if (!isValidPlayerKey(body.playerKey)) {
      return noStoreJson({ ok: false, error: "Invalid player key." }, { status: 400 });
    }
    if (body.isPass !== true && (!Number.isInteger(body.x) || !Number.isInteger(body.y))) {
      return noStoreJson({ ok: false, error: "Integer x and y are required." }, { status: 400 });
    }

    const { gameId } = await context.params;
    const game = await submitMove(gameId, body.playerKey, {
      x: body.x as number | undefined,
      y: body.y as number | undefined,
      isPass: body.isPass === true,
    });
    return noStoreJson({ ok: true, game });
  } catch (error) {
    return apiError(error);
  }
}
