import { query } from "@/lib/db";
import {
  confirmScore,
  setBrowserBotScoringProposal,
  submitMove,
} from "@/lib/game/gameService";
import { GameServiceError } from "@/lib/game/gameServiceError";
import type { GameState } from "@/lib/game/types";
import {
  GOSTONE_BOT_MODEL,
  goStoneBotModelForIdentity,
  type GoStoneBotMove,
} from "./modelV1";

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
  ) conflict("This game is bound to another browser bot contract.", "bot_model_mismatch");
  try {
    goStoneBotModelForIdentity(binding.model_version, binding.model_sha256);
  } catch {
    conflict("This game is bound to an unsupported browser bot artifact.", "bot_model_mismatch");
  }
  return binding;
}

function assertModelIdentity(
  binding: BrowserBotBindingRow,
  modelVersion: unknown,
  modelSha256: unknown,
): void {
  if (
    modelVersion !== binding.model_version
    || modelSha256 !== binding.model_sha256
  ) {
    conflict("The browser bot model identity is not supported.", "bot_model_mismatch");
  }
}

function actionIdentity(gameId: string, version: number, modelVersion: string): string {
  return `browser:${modelVersion}:${gameId}:${version}`;
}

export async function submitBrowserBotMove(input: {
  gameId: string;
  humanPlayerKey: string;
  modelVersion: unknown;
  modelSha256: unknown;
  expectedVersion: number;
  move: GoStoneBotMove;
}): Promise<GameState> {
  const binding = await bindingForHuman(input.gameId, input.humanPlayerKey);
  assertModelIdentity(binding, input.modelVersion, input.modelSha256);
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
        requestIdentity: actionIdentity(input.gameId, input.expectedVersion, binding.model_version),
        modelContractVersion: binding.model_contract_version,
        modelVersion: binding.model_version,
        modelSha256: binding.model_sha256,
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

export async function applyBrowserBotSettlement(input: {
  gameId: string;
  humanPlayerKey: string;
  modelVersion: unknown;
  modelSha256: unknown;
  expectedRevision: number;
  deadStones: unknown;
  neutralRegionSeeds?: unknown;
  uncertainStones?: unknown;
}): Promise<GameState> {
  const binding = await bindingForHuman(input.gameId, input.humanPlayerKey);
  assertModelIdentity(binding, input.modelVersion, input.modelSha256);
  return setBrowserBotScoringProposal(input.gameId, binding.bot_player_key, {
    expectedRevision: input.expectedRevision,
    deadStones: input.deadStones,
    neutralRegionSeeds: input.neutralRegionSeeds ?? [],
    uncertainStones: input.uncertainStones ?? [],
  });
}

export async function confirmBrowserBotScore(input: {
  gameId: string;
  humanPlayerKey: string;
  modelVersion: unknown;
  modelSha256: unknown;
  expectedRevision: number;
}): Promise<GameState> {
  const binding = await bindingForHuman(input.gameId, input.humanPlayerKey);
  assertModelIdentity(binding, input.modelVersion, input.modelSha256);
  return confirmScore(input.gameId, binding.bot_player_key, input.expectedRevision);
}
