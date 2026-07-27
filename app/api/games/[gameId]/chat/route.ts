import { NextRequest } from "next/server";
import { apiError, noStoreJson } from "@/lib/api/responses";
import { resolvePlayerKey } from "@/lib/auth/requestAuth";
import { getGameMessages, sendGameMessage } from "@/lib/game/chatService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ gameId: string }> },
) {
  try {
    const playerKey = await resolvePlayerKey(
      request,
      request.nextUrl.searchParams.get("playerKey"),
    );
    const afterId = Number(request.nextUrl.searchParams.get("after") ?? 0);
    const { gameId } = await context.params;
    const messages = await getGameMessages(
      gameId,
      playerKey,
      Number.isSafeInteger(afterId) ? afterId : 0,
    );
    return noStoreJson({ ok: true, messages });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ gameId: string }> },
) {
  try {
    const body = (await request.json()) as { playerKey?: unknown; message?: unknown };
    const playerKey = await resolvePlayerKey(request, body.playerKey);
    const { gameId } = await context.params;
    const message = await sendGameMessage(gameId, playerKey, body.message);
    return noStoreJson({ ok: true, message }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
