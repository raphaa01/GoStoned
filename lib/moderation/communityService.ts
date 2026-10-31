import type { PoolClient } from "pg";
import { query } from "@/lib/db";
import { GameServiceError } from "@/lib/game/gameServiceError";
import { COMMUNITY_RULES_VERSION } from "./communityContract";

export async function acceptCommunityRules(playerKey: string, client?: PoolClient): Promise<void> {
  const execute = client ? client.query.bind(client) : query;
  await execute(`INSERT INTO community_acceptances (player_key, rules_version)
    VALUES ($1, $2) ON CONFLICT (player_key) DO UPDATE
    SET rules_version = EXCLUDED.rules_version, accepted_at = statement_timestamp()`, [playerKey, COMMUNITY_RULES_VERSION]);
}

export async function hasAcceptedCommunityRules(playerKey: string): Promise<boolean> {
  const result = await query<{ accepted: boolean }>(`SELECT EXISTS (
    SELECT 1 FROM community_acceptances WHERE player_key = $1 AND rules_version = $2
  ) AS accepted`, [playerKey, COMMUNITY_RULES_VERSION]);
  return result.rows[0]?.accepted === true;
}

export async function assertCommunityParticipation(playerKey: string, client: PoolClient): Promise<void> {
  const result = await client.query<{ accepted: boolean; restricted: boolean }>(`SELECT
    EXISTS (SELECT 1 FROM community_acceptances WHERE player_key = $1 AND rules_version = $2) AS accepted,
    EXISTS (SELECT 1 FROM player_restrictions WHERE player_key = $1 AND restricted_until > statement_timestamp()) AS restricted`,
  [playerKey, COMMUNITY_RULES_VERSION]);
  if (result.rows[0]?.restricted) throw new GameServiceError("Community access is temporarily suspended.", 403, "community_suspended");
  if (!result.rows[0]?.accepted) throw new GameServiceError("Accept the community rules first.", 403, "community_rules_required");
}

export async function assertNotRestricted(playerKey: string, client: PoolClient): Promise<void> {
  const result = await client.query("SELECT 1 FROM player_restrictions WHERE player_key = $1 AND restricted_until > statement_timestamp()", [playerKey]);
  if (result.rowCount) throw new GameServiceError("Community access is temporarily suspended.", 403, "community_suspended");
}
