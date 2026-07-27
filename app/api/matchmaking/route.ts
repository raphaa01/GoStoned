import { NextRequest, NextResponse } from "next/server";
import type { BoardSize } from "@/lib/game/types";
import { getMatchmakingDescriptor } from "@/lib/matchmaking/matchmakingService";

export const dynamic = "force-dynamic";

function parseBoardSize(value: string | null): BoardSize {
  const size = Number(value);
  return size === 13 || size === 19 ? size : 9;
}

export async function GET(request: NextRequest) {
  const boardSize = parseBoardSize(request.nextUrl.searchParams.get("boardSize"));
  return NextResponse.json({
    ok: true,
    matchmaking: getMatchmakingDescriptor(boardSize),
  });
}
