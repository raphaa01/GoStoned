import type { PoolClient } from "pg";
import { withTransaction } from "@/lib/db";
import { GameServiceError } from "@/lib/game/gameService";

type ParticipantRow = {
  black_player_key: string;
  white_player_key: string;
};

type BlockStateRow = {
  blocked: boolean;
};

export type PlayerBlockState = {
  blocked: boolean;
};

export function playerPairLockSubject(firstPlayerKey: string, secondPlayerKey: string) {
  const ordered = firstPlayerKey <= secondPlayerKey
    ? [firstPlayerKey, secondPlayerKey]
    : [secondPlayerKey, firstPlayerKey];
  return `player-pair:v1:${JSON.stringify(ordered)}`;
}

export async function lockPlayerPair(
  client: PoolClient,
  firstPlayerKey: string,
  secondPlayerKey: string,
  mode: "shared" | "exclusive" = "exclusive",
): Promise<void> {
  const lockFunction = mode === "shared"
    ? "pg_advisory_xact_lock_shared"
    : "pg_advisory_xact_lock";
  await client.query(
    `SELECT ${lockFunction}(hashtextextended($1, 0))`,
    [playerPairLockSubject(firstPlayerKey, secondPlayerKey)],
  );
}

export async function isPlayerPairBlocked(
  client: PoolClient,
  firstPlayerKey: string,
  secondPlayerKey: string,
): Promise<boolean> {
  const result = await client.query<BlockStateRow>(
    `SELECT (
       EXISTS (
         SELECT 1 FROM player_blocks
          WHERE blocker_key = $1 AND blocked_key = $2
       ) OR EXISTS (
         SELECT 1 FROM player_blocks
          WHERE blocker_key = $2 AND blocked_key = $1
       )
     ) AS blocked`,
    [firstPlayerKey, secondPlayerKey],
  );
  return result.rows[0]?.blocked === true;
}

export async function resolveGameOpponent(
  client: PoolClient,
  gameId: string,
  playerKey: string,
  { lockGame = false }: { lockGame?: boolean } = {},
): Promise<string> {
  const result = await client.query<ParticipantRow>(
    `SELECT black_player_key, white_player_key
       FROM games
      WHERE id = $1
        AND $2 IN (black_player_key, white_player_key)
      ${lockGame ? "FOR KEY SHARE" : ""}`,
    [gameId, playerKey],
  );
  const game = result.rows[0];
  if (!game) {
    // Missing games and non-participants deliberately share one response so
    // the endpoint cannot be used to enumerate private game identifiers.
    throw new GameServiceError("Game not found.", 404, "game_not_found");
  }
  const opponentKey = game.black_player_key === playerKey
    ? game.white_player_key
    : game.black_player_key;
  if (opponentKey === playerKey) {
    throw new GameServiceError(
      "The opponent is unavailable for this action.",
      409,
      "opponent_unavailable",
    );
  }
  return opponentKey;
}

export async function getGameOpponentBlockState(
  gameId: string,
  playerKey: string,
): Promise<PlayerBlockState> {
  return withTransaction(async (client) => {
    const opponentKey = await resolveGameOpponent(client, gameId, playerKey);
    await lockPlayerPair(client, playerKey, opponentKey, "shared");
    const result = await client.query<BlockStateRow>(
      `SELECT EXISTS (
         SELECT 1 FROM player_blocks
          WHERE blocker_key = $1 AND blocked_key = $2
       ) AS blocked`,
      [playerKey, opponentKey],
    );
    return { blocked: result.rows[0]?.blocked === true };
  });
}

export async function setGameOpponentBlocked(
  gameId: string,
  playerKey: string,
  blocked: boolean,
): Promise<PlayerBlockState> {
  return withTransaction(async (client) => {
    const opponentKey = await resolveGameOpponent(client, gameId, playerKey);
    await lockPlayerPair(client, playerKey, opponentKey);
    if (blocked) {
      await client.query(
        `INSERT INTO player_blocks (blocker_key, blocked_key)
         VALUES ($1, $2)
         ON CONFLICT (blocker_key, blocked_key) DO NOTHING`,
        [playerKey, opponentKey],
      );
    } else {
      await client.query(
        `DELETE FROM player_blocks
          WHERE blocker_key = $1 AND blocked_key = $2`,
        [playerKey, opponentKey],
      );
    }
    return { blocked };
  });
}
