import { query } from "@/lib/db";
import { getGroup } from "@/lib/game/goEngine";
import {
  confirmScore,
  getGameState,
  setDeadGroup,
  submitMove,
} from "@/lib/game/gameService";
import { GameServiceError } from "@/lib/game/gameServiceError";
import type { GameState, Position } from "@/lib/game/types";
import { GOSTONE_BOT_MODEL, type GoStoneBotMove } from "./modelV1";

type BrowserBotBindingRow = {
  bot_player_key: string;
  human_player_key: string;
  bot_color: "black" | "white";
  model_contract_version: "gostone-browser-bot-v1";
  model_version: string;
  model_sha256: string;
};

function conflict(message: string, code = "invalid_browser_bot_action"): never {
  throw new GameServiceError(message, 409, code);
}

async function bindingForHuman(
  gameId: string,
  humanPlayerKey: string,
): Promise<BrowserBotBindingRow> {
  const result = await query<BrowserBotBindingRow>(
    `SELECT binding.bot_player_key,binding.human_player_key,binding.bot_color,
            binding.model_contract_version,binding.model_version,binding.model_sha256
       FROM game_browser_bot_bindings binding
       JOIN games game_record ON game_record.id = binding.game_id
       JOIN game_bots bot ON bot.game_id = binding.game_id
      WHERE binding.game_id = $1 AND binding.human_player_key = $2
        AND binding.bot_player_key = bot.bot_player_key
        AND bot.rating_mode = 'browser-v1'
        AND (game_record.black_player_key = $2 OR game_record.white_player_key = $2)`,
    [gameId, humanPlayerKey],
  );
  const binding = result.rows[0];
  if (!binding) conflict("This game has no browser-controlled bot opponent.", "bot_not_found");
  if (
    binding.model_contract_version !== GOSTONE_BOT_MODEL.contractVersion
    || binding.model_version !== GOSTONE_BOT_MODEL.modelVersion
    || binding.model_sha256 !== GOSTONE_BOT_MODEL.artifactSha256
  ) conflict("This game is bound to another browser bot artifact.", "bot_model_mismatch");
  return binding;
}

function assertModelIdentity(modelVersion: unknown, modelSha256: unknown): void {
  if (
    modelVersion !== GOSTONE_BOT_MODEL.modelVersion
    || modelSha256 !== GOSTONE_BOT_MODEL.artifactSha256
  ) {
    conflict("The browser bot model identity is not supported.", "bot_model_mismatch");
  }
}

function actionIdentity(gameId: string, version: number): string {
  return `browser:${GOSTONE_BOT_MODEL.modelVersion}:${gameId}:${version}`;
}

export async function submitBrowserBotMove(input: {
  gameId: string;
  humanPlayerKey: string;
  modelVersion: unknown;
  modelSha256: unknown;
  expectedVersion: number;
  move: GoStoneBotMove;
}): Promise<GameState> {
  assertModelIdentity(input.modelVersion, input.modelSha256);
  const binding = await bindingForHuman(input.gameId, input.humanPlayerKey);
  const updated = await submitMove(
    input.gameId,
    binding.bot_player_key,
    {
      ...(input.move.kind === "pass"
        ? { isPass: true }
        : { x: input.move.x, y: input.move.y }),
      expectedVersion: input.expectedVersion,
    },
    {
      executionAudit: {
        requestIdentity: actionIdentity(input.gameId, input.expectedVersion),
        modelContractVersion: binding.model_contract_version,
        modelVersion: GOSTONE_BOT_MODEL.modelVersion,
        modelSha256: GOSTONE_BOT_MODEL.artifactSha256,
        workerId: "browser",
      },
    },
  );
  const persisted = updated.moves.at(-1);
  if (!persisted || persisted.moveNumber !== updated.moveCount) {
    conflict("The browser bot move was not persisted.");
  }
  return updated;
}

function exactPosition(value: unknown, boardSize: number): Position | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes("x") || !keys.includes("y")) return null;
  const { x, y } = value as Record<string, unknown>;
  return Number.isInteger(x) && Number.isInteger(y)
    && Number(x) >= 0 && Number(y) >= 0
    && Number(x) < boardSize && Number(y) < boardSize
    ? { x: Number(x), y: Number(y) }
    : null;
}

function validateDeadStoneProposal(game: GameState, value: unknown): Position[] {
  if (!Array.isArray(value) || value.length > game.boardSize * game.boardSize) {
    conflict("The settlement proposal is invalid.");
  }
  const positions = value.map((candidate) => exactPosition(candidate, game.boardSize));
  if (positions.some((position) => position === null)) conflict("The settlement proposal is invalid.");
  const dead = positions as Position[];
  const keys = new Set(dead.map(({ x, y }) => `${x}:${y}`));
  if (keys.size !== dead.length) conflict("The settlement proposal contains duplicates.");
  for (const position of dead) {
    if (!game.board[position.y][position.x]) conflict("A proposed dead point is empty.");
    if (getGroup(game.board, position).some(({ x, y }) => !keys.has(`${x}:${y}`))) {
      conflict("The settlement proposal must contain complete connected groups.");
    }
  }
  return dead;
}

export async function applyBrowserBotSettlement(input: {
  gameId: string;
  humanPlayerKey: string;
  modelVersion: unknown;
  modelSha256: unknown;
  expectedRevision: number;
  deadStones: unknown;
}): Promise<GameState> {
  assertModelIdentity(input.modelVersion, input.modelSha256);
  const binding = await bindingForHuman(input.gameId, input.humanPlayerKey);
  let game = await getGameState(input.gameId, binding.bot_player_key);
  if (!game.scoring || game.scoring.revision !== input.expectedRevision) {
    conflict("The scoring proposal changed.", "scoring_revision_conflict");
  }
  const desired = validateDeadStoneProposal(game, input.deadStones);
  const desiredKeys = new Set(desired.map(({ x, y }) => `${x}:${y}`));
  const currentKeys = new Set(game.scoring.deadStones.map(({ x, y }) => `${x}:${y}`));

  for (const stone of game.scoring.deadStones) {
    if (desiredKeys.has(`${stone.x}:${stone.y}`)) continue;
    game = await setDeadGroup(input.gameId, binding.bot_player_key, {
      ...stone,
      dead: false,
      expectedRevision: game.scoring!.revision,
    });
    getGroup(game.board, stone).forEach(({ x, y }) => currentKeys.delete(`${x}:${y}`));
  }
  for (const stone of desired) {
    if (currentKeys.has(`${stone.x}:${stone.y}`)) continue;
    game = await setDeadGroup(input.gameId, binding.bot_player_key, {
      ...stone,
      dead: true,
      expectedRevision: game.scoring!.revision,
    });
    getGroup(game.board, stone).forEach(({ x, y }) => currentKeys.add(`${x}:${y}`));
  }
  return game;
}

export async function confirmBrowserBotScore(input: {
  gameId: string;
  humanPlayerKey: string;
  modelVersion: unknown;
  modelSha256: unknown;
  expectedRevision: number;
}): Promise<GameState> {
  assertModelIdentity(input.modelVersion, input.modelSha256);
  const binding = await bindingForHuman(input.gameId, input.humanPlayerKey);
  return confirmScore(input.gameId, binding.bot_player_key, input.expectedRevision);
}
