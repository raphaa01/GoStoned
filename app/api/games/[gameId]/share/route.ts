import { NextRequest } from "next/server";
import { apiError, noStoreJson } from "@/lib/api/responses";
import { assertExpectedPlayer } from "@/lib/auth/playerBindingServer";
import { resolvePlayerKey } from "@/lib/auth/requestAuth";
import { createFinishedGameShare } from "@/lib/game/sharedGameService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function POST(request: NextRequest, context: { params: Promise<{ gameId: string }> }) {
  try {
    const { gameId } = await context.params;
    if (!ID.test(gameId)) return noStoreJson({ error: "Game not found." }, { status: 404 });
    const playerKey = await resolvePlayerKey(request);
    assertExpectedPlayer(request, playerKey);
    const token = await createFinishedGameShare(gameId, playerKey);
    const path = `/shared-game/${token}`;
    return noStoreJson({ ok: true, token, path, url: new URL(path, request.nextUrl.origin).toString() });
  } catch (error) {
    return apiError(error);
  }
}
