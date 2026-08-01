import { query } from "@/lib/db";
import { confirmScore, GameServiceError, getGameState, submitMove } from "@/lib/game/gameService";
import type { GameState, Stone } from "@/lib/game/types";
import { chooseLocalBotMove, type LocalBotMove } from "./localBot";

type LocalBotRow = {
  bot_player_key: string;
  color: Stone;
  target_rating: number;
};

export type LocalBotAction =
  | ({ action: "move"; expectedVersion: number } & LocalBotMove)
  | { action: "confirm-score"; expectedVersion: number };

function conflict(message: string, code: string): never {
  throw new GameServiceError(message, 409, code);
}

export function isMatchingLocalBotMove(expected: LocalBotMove, proposed: LocalBotAction): boolean {
  if (proposed.action !== "move") return false;
  if (expected.isPass === true) return proposed.isPass === true;
  return proposed.isPass !== true
    && proposed.x === expected.x
    && proposed.y === expected.y;
}

function assertHumanOpponent(game: GameState, playerKey: string, bot: LocalBotRow): void {
  const humanKey = bot.color === "black" ? game.whitePlayerKey : game.blackPlayerKey;
  const storedBotKey = bot.color === "black" ? game.blackPlayerKey : game.whitePlayerKey;
  if (storedBotKey !== bot.bot_player_key) {
    throw new GameServiceError("The stored bot identity is inconsistent.", 500, "bot_identity_mismatch");
  }
  if (playerKey !== humanKey || playerKey === bot.bot_player_key) {
    throw new GameServiceError("Only the bot's opponent can request its turn.", 403, "not_bot_opponent");
  }
}

export async function submitVerifiedLocalBotAction(
  gameId: string,
  playerKey: string,
  proposal: LocalBotAction,
): Promise<GameState> {
  const result = await query<LocalBotRow>(
    `SELECT bot_player_key, color, target_rating
       FROM game_bots
      WHERE game_id = $1`,
    [gameId],
  );
  const bot = result.rows[0];
  if (!bot) {
    throw new GameServiceError("This game has no local bot opponent.", 404, "local_bot_not_found");
  }

  const game = await getGameState(gameId, playerKey);
  assertHumanOpponent(game, playerKey, bot);
  if (game.status !== "active") conflict("This game is already finished.", "game_finished");
  if (game.version !== proposal.expectedVersion) {
    conflict("The game changed before the bot action was submitted.", "game_version_conflict");
  }

  if (proposal.action === "confirm-score") {
    if (game.phase !== "scoring" || !game.scoring) {
      conflict("The game is not awaiting score confirmation.", "game_not_in_scoring");
    }
    return confirmScore(gameId, bot.bot_player_key, game.scoring.revision);
  }

  if (game.phase !== "play" || game.turn !== bot.color) {
    conflict("It is not the bot's turn.", "not_bot_turn");
  }
  const expected = chooseLocalBotMove({ game, targetRating: bot.target_rating });
  if (!isMatchingLocalBotMove(expected, proposal)) {
    conflict("The proposed bot move did not pass server verification.", "local_bot_move_mismatch");
  }
  return submitMove(gameId, bot.bot_player_key, {
    ...expected,
    expectedVersion: proposal.expectedVersion,
  });
}
