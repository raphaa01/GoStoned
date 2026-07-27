import { NextRequest } from "next/server";
import { apiError, noStoreJson } from "@/lib/api/responses";
import {
  cancelMatchmaking,
  getMatchmakingStatus,
  isBoardSize,
  isValidPlayerKey,
  joinMatchmaking,
} from "@/lib/matchmaking/matchmakingService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const playerKey = request.nextUrl.searchParams.get("playerKey");
  if (!isValidPlayerKey(playerKey)) {
    return noStoreJson({ ok: false, error: "Invalid player key." }, { status: 400 });
  }

  try {
    const matchmaking = await getMatchmakingStatus(playerKey);
    return noStoreJson({ ok: true, matchmaking });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { playerKey?: unknown; boardSize?: unknown };
    if (!isValidPlayerKey(body.playerKey) || !isBoardSize(body.boardSize)) {
      return noStoreJson(
        { ok: false, error: "A valid playerKey and boardSize are required." },
        { status: 400 },
      );
    }
    const matchmaking = await joinMatchmaking(body.playerKey, body.boardSize);
    return noStoreJson({ ok: true, matchmaking });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: NextRequest) {
  const playerKey = request.nextUrl.searchParams.get("playerKey");
  if (!isValidPlayerKey(playerKey)) {
    return noStoreJson({ ok: false, error: "Invalid player key." }, { status: 400 });
  }

  try {
    await cancelMatchmaking(playerKey);
    return noStoreJson({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
