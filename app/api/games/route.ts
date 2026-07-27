import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type GameRow = {
  id: string;
  board_size: number;
  black_player_key: string;
  white_player_key: string;
  winner_key: string | null;
  status: string;
  result: string | null;
  started_at: Date;
  finished_at: Date | null;
};

export async function GET() {
  try {
    const result = await query<GameRow>(
      `SELECT id, board_size, black_player_key, white_player_key, winner_key,
              status, result, started_at, finished_at
         FROM games
        ORDER BY started_at DESC
        LIMIT 20`,
    );
    return NextResponse.json({ ok: true, games: result.rows });
  } catch (error) {
    console.error("Games query failed:", error);
    return NextResponse.json(
      { ok: false, games: [], error: "Games are temporarily unavailable." },
      { status: 503 },
    );
  }
}
