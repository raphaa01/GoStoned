import { query } from "@/lib/db";
import {
  applyJapaneseSettlementSuggestion,
  confirmScore,
  submitMove,
} from "@/lib/game/gameService";
import { GameServiceError } from "@/lib/game/gameServiceError";
import type { GameState } from "@/lib/game/types";
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

function assertBoundSettlementSuggestion(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    conflict("The settlement proposal is invalid.");
  }
  const provider = (value as Record<string, unknown>).provider;
  if (!provider || typeof provider !== "object" || Array.isArray(provider)) {
    conflict("The settlement proposal has no model identity.");
  }
  const identity = provider as Record<string, unknown>;
  if (identity.id !== `browser-worker:${GOSTONE_BOT_MODEL.contractVersion}`
    || identity.modelVersion !== GOSTONE_BOT_MODEL.modelVersion
    || identity.artifactSha256 !== GOSTONE_BOT_MODEL.artifactSha256) {
    conflict("The settlement proposal belongs to another model.", "bot_model_mismatch");
  }
}

export async function applyBrowserBotSettlement(input: {
  gameId: string;
  humanPlayerKey: string;
  modelVersion: unknown;
  modelSha256: unknown;
  expectedRevision: number;
  suggestion: unknown;
}): Promise<GameState> {
  assertModelIdentity(input.modelVersion, input.modelSha256);
  const binding = await bindingForHuman(input.gameId, input.humanPlayerKey);
  assertBoundSettlementSuggestion(input.suggestion);
  return applyJapaneseSettlementSuggestion(
    input.gameId,
    binding.bot_player_key,
    input.expectedRevision,
    input.suggestion,
  );
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
