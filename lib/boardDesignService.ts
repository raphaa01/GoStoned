import { query } from "@/lib/db";
import { AuthError } from "@/lib/auth/accountService";
import { BOARD_DESIGNS, isBoardDesignId, isBoardDesignUnlocked, type BoardDesignId, type BoardDesignPreference } from "@/lib/boardDesign";

type DesignRow = { board_design: string; wins: number };

// All completed wins count, including friendly and browser-bot games.
// Draws, no-results and active games have no qualifying winning participant.
const WIN_COUNT = `(SELECT COUNT(*)::int FROM games
  WHERE winner_key = 'user:' || users.id::text
    AND status = 'finished' AND finished_at IS NOT NULL
    AND black_player_key <> white_player_key)`;

function preference(row: DesignRow): BoardDesignPreference {
  return {
    design: isBoardDesignId(row.board_design) && isBoardDesignUnlocked(row.board_design, row.wins)
      ? row.board_design : "default",
    wins: row.wins,
  };
}

export async function getBoardDesignPreference(userId: string): Promise<BoardDesignPreference> {
  const result = await query<DesignRow>(
    `SELECT board_design, ${WIN_COUNT} AS wins FROM users WHERE id = $1`, [userId],
  );
  if (!result.rows[0]) throw new AuthError("Account not found.", 401, "unauthorized");
  return preference(result.rows[0]);
}

export async function updateBoardDesignPreference(userId: string, design: BoardDesignId): Promise<BoardDesignPreference> {
  const requiredWins = BOARD_DESIGNS.find((entry) => entry.id === design)!.wins;
  if (requiredWins === null) throw new AuthError("This board design is not available yet.", 403, "board_design_locked");
  // The unlock check and update share one database statement and snapshot.
  const result = await query<DesignRow>(
    `UPDATE users SET board_design = $2, updated_at = statement_timestamp()
      WHERE id = $1 AND ${WIN_COUNT} >= $3
      RETURNING board_design, ${WIN_COUNT} AS wins`,
    [userId, design, requiredWins],
  );
  if (!result.rows[0]) throw new AuthError("This board design is locked.", 403, "board_design_locked");
  return preference(result.rows[0]);
}
