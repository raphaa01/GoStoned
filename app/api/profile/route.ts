import { NextRequest } from "next/server";
import { apiError, noStoreJson } from "@/lib/api/responses";
import { query } from "@/lib/db";
import { requireRequestUser } from "@/lib/auth/requestAuth";
import type { BoardSize } from "@/lib/game/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ProfileStatRow = {
  board_size: BoardSize;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  rating: number;
  highest_rating: number;
};

export async function GET(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    const stats = await query<ProfileStatRow>(
      `SELECT board_size, games, wins, losses, draws, rating, highest_rating
         FROM player_stats
        WHERE player_key = $1
        ORDER BY board_size`,
      [user.playerKey],
    );
    return noStoreJson({ ok: true, user, stats: stats.rows });
  } catch (error) {
    return apiError(error);
  }
}
