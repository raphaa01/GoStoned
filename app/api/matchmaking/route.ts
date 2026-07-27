import { NextRequest } from "next/server";
import { apiError, noStoreJson } from "@/lib/api/responses";
import { resolvePlayerKey } from "@/lib/auth/requestAuth";
import { isTimeControlId } from "@/lib/game/timeControls";
import {
  cancelMatchmaking,
  getMatchmakingStatus,
  isBoardSize,
  joinMatchmaking,
} from "@/lib/matchmaking/matchmakingService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const playerKey = await resolvePlayerKey(
      request,
      request.nextUrl.searchParams.get("playerKey"),
    );
    const matchmaking = await getMatchmakingStatus(playerKey);
    return noStoreJson({ ok: true, matchmaking });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      playerKey?: unknown;
      boardSize?: unknown;
      timeControl?: unknown;
    };
    if (!isBoardSize(body.boardSize) || !isTimeControlId(body.timeControl)) {
      return noStoreJson(
        { ok: false, error: "A valid board size and time control are required." },
        { status: 400 },
      );
    }
    const playerKey = await resolvePlayerKey(request, body.playerKey);
    const matchmaking = await joinMatchmaking(playerKey, body.boardSize, body.timeControl);
    return noStoreJson({ ok: true, matchmaking });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const playerKey = await resolvePlayerKey(
      request,
      request.nextUrl.searchParams.get("playerKey"),
    );
    await cancelMatchmaking(playerKey);
    return noStoreJson({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
