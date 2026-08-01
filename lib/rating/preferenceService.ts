import { query } from "@/lib/db";
import type { RatingPreferences } from "./preferences";

type PreferenceRow = {
  display_preference: RatingPreferences["displayPreference"];
  bot_match_preference: RatingPreferences["botMatchPreference"];
  preference_revision: number;
};

export async function getRatingPreferences(playerKey: string) {
  const result = await query<PreferenceRow>(
    `SELECT display_preference,bot_match_preference,preference_revision
       FROM player_rating_preferences
      WHERE player_key = $1`,
    [playerKey],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Rating preferences are unavailable for this account.");
  return {
    displayPreference: row.display_preference,
    botMatchPreference: row.bot_match_preference,
    preferenceRevision: row.preference_revision,
  };
}

export async function updateRatingPreferences(
  playerKey: string,
  preferences: RatingPreferences,
) {
  const result = await query<PreferenceRow>(
    `UPDATE player_rating_preferences
        SET display_preference = $2,
            bot_match_preference = $3,
            preference_revision = preference_revision + 1,
            updated_at = statement_timestamp()
      WHERE player_key = $1
      RETURNING display_preference,bot_match_preference,preference_revision`,
    [playerKey, preferences.displayPreference, preferences.botMatchPreference],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Rating preferences are unavailable for this account.");
  return {
    displayPreference: row.display_preference,
    botMatchPreference: row.bot_match_preference,
    preferenceRevision: row.preference_revision,
  };
}
