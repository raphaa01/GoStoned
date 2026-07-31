import { randomUUID } from "node:crypto";
import { fromGtpCoordinate, toGtpCoordinate } from "@/lib/analysis/coordinates";
import {
  ANALYSIS_ENGINE_CONTRACT_VERSION,
  type AnalysisInput,
} from "@/lib/analysis/types";
import {
  botDifficultyForRating,
  selectBotMove,
  selectBotThinkDelayMs,
} from "@/lib/bot/difficulty";
import { deterministicUnit } from "@/lib/bot/identity";
import { query } from "@/lib/db";
import { confirmScore, getGameState, submitMove } from "@/lib/game/gameService";
import type { GameState, Stone } from "@/lib/game/types";
import type { KataGoEngine } from "./engine";

type ClaimedBot = {
  game_id: string;
  bot_player_key: string;
  color: Stone;
  target_rating: number;
  visits_per_turn: number;
  candidate_limit: number;
  temperature: number;
  scheduled_game_version: number;
  game_version: number;
};

export type BotLoopState = { activeGameId: string | null };

function inputForGame(game: GameState): AnalysisInput {
  return {
    contractVersion: ANALYSIS_ENGINE_CONTRACT_VERSION,
    gameId: game.id,
    gameVersion: game.version,
    boardSize: game.boardSize,
    komi: game.komi,
    rules: game.ruleset,
    moves: game.moves.map((move) => ({
      color: move.color,
      move: toGtpCoordinate(game.boardSize, move),
    })),
  };
}

async function claimBotTurn(workerId: string): Promise<ClaimedBot | null> {
  const result = await query<ClaimedBot>(
    `WITH candidate AS (
       SELECT bot.game_id, game.version AS game_version
         FROM game_bots bot
         JOIN games game ON game.id = bot.game_id
         LEFT JOIN game_scoring_state scoring ON scoring.game_id = game.id
        WHERE game.status = 'active'
          AND (bot.lease_expires_at IS NULL OR bot.lease_expires_at < NOW())
          AND (
            (game.phase = 'play' AND game.to_move = bot.color)
            OR (
              game.phase = 'scoring'
              AND scoring.revision = game.scoring_revision
              AND CASE bot.color
                    WHEN 'black' THEN scoring.black_confirmed_revision IS DISTINCT FROM scoring.revision
                    ELSE scoring.white_confirmed_revision IS DISTINCT FROM scoring.revision
                  END
            )
          )
          AND (
            bot.scheduled_game_version <> game.version
            OR bot.next_move_at <= NOW()
          )
        ORDER BY game.updated_at, bot.game_id
        LIMIT 1
        FOR UPDATE OF bot SKIP LOCKED
     )
     UPDATE game_bots bot
        SET worker_id = $1,
            lease_expires_at = NOW() + INTERVAL '10 minutes',
            updated_at = NOW()
       FROM candidate
      WHERE bot.game_id = candidate.game_id
      RETURNING bot.game_id, bot.bot_player_key, bot.color, bot.target_rating,
                bot.visits_per_turn, bot.candidate_limit, bot.temperature,
                bot.scheduled_game_version, candidate.game_version`,
    [workerId],
  );
  return result.rows[0] ?? null;
}

async function releaseBot(bot: ClaimedBot) {
  await query(
    `UPDATE game_bots
        SET scheduled_game_version = $3, next_move_at = NOW(),
            worker_id = NULL, lease_expires_at = NULL,
            failure_count = 0, last_error = NULL, updated_at = NOW()
      WHERE game_id = $1 AND worker_id = $2`,
    [bot.game_id, botWorkerId, bot.game_version],
  );
}

async function failBot(bot: ClaimedBot, error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown KataGo bot error.";
  await query(
    `UPDATE game_bots
        SET worker_id = NULL, lease_expires_at = NULL,
            failure_count = LEAST(failure_count + 1, 1000),
            last_error = $2,
            next_move_at = NOW() + INTERVAL '2 seconds',
            updated_at = NOW()
      WHERE game_id = $1 AND worker_id = $3`,
    [bot.game_id, message.slice(0, 1_000), botWorkerId],
  );
  console.error(`Bot move for ${bot.game_id} failed:`, message);
}

async function playBotTurn(engine: KataGoEngine, bot: ClaimedBot, visitCap: number) {
  const startedAt = performance.now();
  const game = await getGameState(bot.game_id, bot.bot_player_key);
  if (game.status !== "active") return;
  if (game.phase === "scoring" && game.scoring) {
    const alreadyConfirmed = bot.color === "black"
      ? game.scoring.blackConfirmed
      : game.scoring.whiteConfirmed;
    if (!alreadyConfirmed) {
      await confirmScore(game.id, bot.bot_player_key, game.scoring.revision);
    }
    return;
  }
  if (game.phase !== "play" || game.turn !== bot.color) return;

  const difficulty = botDifficultyForRating(bot.target_rating);
  const thinkDelayMs = selectBotThinkDelayMs(
    difficulty,
    deterministicUnit(`${bot.game_id}:${game.version}:think`),
  );

  const result = await engine.analyzeCurrent(
    `bot:${bot.game_id}:${game.version}:${randomUUID()}`,
    inputForGame(game),
    Math.max(1, Math.min(bot.visits_per_turn, visitCap)),
    {
      priority: 100,
      reportDuringSearchEvery: 0.25,
      timeoutMs: 8_000,
    },
  );
  const selected = selectBotMove(
    result.moveInfos,
    { candidateLimit: bot.candidate_limit, temperature: bot.temperature },
    deterministicUnit(`${bot.game_id}:${game.version}:move`),
    { moveNumber: game.moveCount, boardSize: game.boardSize },
  );
  const remainingThinkMs = thinkDelayMs - (performance.now() - startedAt);
  if (remainingThinkMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, remainingThinkMs));
  }
  await submitMove(game.id, bot.bot_player_key, {
    ...fromGtpCoordinate(game.boardSize, selected.move),
    expectedVersion: game.version,
  });
}

const botWorkerId = `bot:${randomUUID()}`;

export async function runBotLoop(
  engine: KataGoEngine,
  state: BotLoopState,
  shouldStop: () => boolean,
) {
  const pollMs = Math.max(250, Number(process.env.KATAGO_BOT_POLL_INTERVAL_MS) || 500);
  const visitCap = Math.max(1, Number(process.env.KATAGO_BOT_MAX_VISITS) || 160);
  while (!shouldStop()) {
    const bot = await claimBotTurn(botWorkerId);
    if (!bot) {
      await new Promise((resolve) => setTimeout(resolve, pollMs));
      continue;
    }
    state.activeGameId = bot.game_id;
    try {
      await playBotTurn(engine, bot, visitCap);
      await releaseBot(bot);
    } catch (error) {
      await failBot(bot, error);
    } finally {
      state.activeGameId = null;
    }
  }
}

export async function publishWorkerHeartbeat(input: {
  workerId: string;
  engineVersion: string;
  modelName: string;
  ready: boolean;
}) {
  await query(
    `INSERT INTO katago_workers (
       worker_id, capabilities, engine_version, model_name, ready, last_seen_at
     )
     VALUES ($1, ARRAY['analysis', 'bot', 'puzzle'], $2, $3, $4, NOW())
     ON CONFLICT (worker_id) DO UPDATE
       SET capabilities = EXCLUDED.capabilities,
           engine_version = EXCLUDED.engine_version,
           model_name = EXCLUDED.model_name,
           ready = EXCLUDED.ready,
           last_seen_at = NOW()`,
    [input.workerId, input.engineVersion, input.modelName, input.ready],
  );
}
