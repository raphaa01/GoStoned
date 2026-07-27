import { NextRequest, NextResponse } from "next/server";
import type { BoardSize } from "@/lib/game/types";
import { getLeaderboard } from "@/lib/stats/statsService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseBoardSize(value: string | null): BoardSize {
  const size = Number(value);
  return size === 9 || size === 13 ? size : 19;
}

export async function GET(request: NextRequest) {
  const boardSize = parseBoardSize(request.nextUrl.searchParams.get("boardSize"));

  try {
    const leaderboard = await getLeaderboard(boardSize);
    return NextResponse.json({ ok: true, boardSize, leaderboard });
  } catch (error) {
    console.error("Stats query failed:", error);
    return NextResponse.json(
      { ok: false, boardSize, leaderboard: [], error: "Stats are temporarily unavailable." },
      { status: 503 },
    );
  }
}
