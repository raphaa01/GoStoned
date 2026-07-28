import { withTransaction } from "@/lib/db";
import { GameServiceError } from "@/lib/game/gameService";
import { resolveGameOpponent } from "./playerBlockService";
import {
  isPlayerReportCategory,
  type PlayerReportCategory,
} from "./playerReportContract";

export type PlayerReportReceipt = Readonly<{
  reported: true;
}>;

export async function reportGameOpponent(
  gameId: string,
  reporterKey: string,
  categoryValue: unknown,
): Promise<PlayerReportReceipt> {
  if (!isPlayerReportCategory(categoryValue)) {
    throw new GameServiceError(
      "Choose a supported report category.",
      400,
      "invalid_report_category",
    );
  }
  const category: PlayerReportCategory = categoryValue;

  return withTransaction(async (client) => {
    // Preserve the evidence parent across participant derivation and insert.
    // A concurrent game deletion waits, then is rejected by the restrictive FK.
    const reportedKey = await resolveGameOpponent(
      client,
      gameId,
      reporterKey,
      { lockGame: true },
    );
    await client.query(
      `INSERT INTO player_reports
         (game_id, reporter_key, reported_key, category_code)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (game_id, reporter_key) DO NOTHING`,
      [gameId, reporterKey, reportedKey, category],
    );
    // The receipt deliberately does not distinguish a first submission from
    // an idempotent retry or disclose the server-derived opponent.
    return { reported: true };
  });
}
