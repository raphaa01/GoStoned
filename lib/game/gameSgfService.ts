import type { PoolClient, QueryResultRow } from "pg";
import { withReadOnlyTransaction } from "../db";
import { GameServiceError } from "./gameServiceError";
import {
  exportGameToSgf,
  type SgfExportInput,
  type SgfExportMove,
  type SgfTerminalResult,
} from "./sgfExport";
import type { BoardSize, Stone } from "./types";

type ExportGameRow = QueryResultRow & {
  id: string;
  board_size: number;
  black_player_key: string;
  white_player_key: string;
  winner_key: string | null;
  status: string;
  result: string | null;
  finish_reason: string | null;
  rules: string;
  rules_profile: string;
  scoring_method: string;
  komi: string | number;
  handicap: number;
  black_player_name: string;
  white_player_name: string;
};

type ExportMoveRow = QueryResultRow & {
  move_number: number;
  color: Stone;
  x: number | null;
  y: number | null;
  is_pass: boolean;
};

type JapaneseTerminalRow = QueryResultRow & { outcome_kind: string };
type JapaneseRepetitionRow = QueryResultRow & {
  move_number: number;
  claimant_count: number;
};

function corrupt(message: string): never {
  throw new GameServiceError(
    `This game cannot be exported because its persisted ${message} is inconsistent.`,
    409,
    "sgf_export_evidence_invalid",
  );
}

function winner(game: ExportGameRow): Stone {
  if (game.winner_key === game.black_player_key) return "black";
  if (game.winner_key === game.white_player_key) return "white";
  return corrupt("winner evidence");
}

function scoreResult(game: ExportGameRow): SgfTerminalResult {
  if (game.result === "0") return { kind: "draw" };
  const match = /^([BW])\+(0|[1-9]\d*)(?:\.(5))?$/.exec(game.result ?? "");
  if (!match) return corrupt("score result");
  const persistedWinner: Stone = match[1] === "B" ? "black" : "white";
  if (winner(game) !== persistedWinner) return corrupt("score winner");
  const margin = Number(`${match[2]}${match[3] === undefined ? "" : ".5"}`);
  if (margin <= 0) return corrupt("score margin");
  return { kind: "score", winner: persistedWinner, margin };
}

function noResultReason(outcomeKind: string | undefined): Extract<SgfTerminalResult, { kind: "no-result" }>["reason"] {
  switch (outcomeKind) {
    case "no_participation": return "no-participation";
    case "katago_low_confidence": return "adjudication-low-confidence";
    case "katago_unavailable": return "adjudication-unavailable";
    default: return corrupt("no-result evidence");
  }
}

function terminalResult(
  game: ExportGameRow,
  japaneseTerminal: JapaneseTerminalRow | undefined,
  repetition: JapaneseRepetitionRow | undefined,
): SgfTerminalResult {
  switch (game.finish_reason) {
    case "score":
    case "legacy_score":
    case "japanese_adjudication":
      return scoreResult(game);
    case "resignation":
      return { kind: "resignation", winner: winner(game) };
    case "timeout":
      return { kind: "timeout", winner: winner(game) };
    case "japanese_abandonment":
      if (japaneseTerminal?.outcome_kind !== "abandonment") return corrupt("abandonment evidence");
      return { kind: "forfeit", winner: winner(game) };
    case "japanese_no_result":
      return { kind: "no-result", reason: noResultReason(japaneseTerminal?.outcome_kind) };
    case "japanese_repetition":
      if (repetition?.claimant_count !== 2) return corrupt("repetition evidence");
      return { kind: "no-result", reason: "cyclic-repetition" };
    default:
      return corrupt("finish reason");
  }
}

function boardSize(value: number): BoardSize {
  if (value === 9 || value === 13 || value === 19) return value;
  return corrupt("board size");
}

async function loadSgfInput(
  client: PoolClient,
  gameId: string,
  playerKey: string,
): Promise<SgfExportInput> {
  const gameResult = await client.query<ExportGameRow>(
    `SELECT g.id,g.board_size,g.black_player_key,g.white_player_key,g.winner_key,
            g.status,g.result,g.finish_reason,g.rules,g.rules_profile,
            g.scoring_method,g.komi,g.handicap,
            COALESCE(NULLIF(BTRIM(black_user.display_name), ''),black_user.username,
              'Guest ' || UPPER(RIGHT(g.black_player_key, 6))) AS black_player_name,
            COALESCE(NULLIF(BTRIM(white_user.display_name), ''),white_user.username,
              'Guest ' || UPPER(RIGHT(g.white_player_key, 6))) AS white_player_name
       FROM games g
       LEFT JOIN users black_user ON g.black_player_key='user:' || black_user.id::text
       LEFT JOIN users white_user ON g.white_player_key='user:' || white_user.id::text
      WHERE g.id=$1`,
    [gameId],
  );
  const game = gameResult.rows[0];
  if (!game) throw new GameServiceError("Game not found.", 404, "game_not_found");
  if (playerKey !== game.black_player_key && playerKey !== game.white_player_key) {
    throw new GameServiceError("You are not a participant in this game.", 403, "not_a_participant");
  }
  if (game.status !== "finished") {
    throw new GameServiceError("Only finished games can be exported.", 409, "game_not_finished");
  }
  const movesResult = await client.query<ExportMoveRow>(
    `SELECT move_number,color,x,y,is_pass FROM moves
      WHERE game_id=$1 ORDER BY move_number`,
    [gameId],
  );
  const terminalResultRows = await client.query<JapaneseTerminalRow>(
    `SELECT outcome_kind FROM game_japanese_scoring_terminal_events WHERE game_id=$1`,
    [gameId],
  );
  const repetitionRows = await client.query<JapaneseRepetitionRow>(
    `SELECT move_number,COUNT(DISTINCT claimant_color)::int AS claimant_count
       FROM game_japanese_repetition_claims WHERE game_id=$1
      GROUP BY move_number ORDER BY move_number DESC LIMIT 1`,
    [gameId],
  );
  const moves: SgfExportMove[] = movesResult.rows.map((move) => ({
    moveNumber: move.move_number,
    color: move.color,
    x: move.x,
    y: move.y,
    isPass: move.is_pass,
  }));
  if (
    game.finish_reason === "japanese_repetition"
    && repetitionRows.rows[0]?.move_number !== moves.at(-1)?.moveNumber
  ) return corrupt("repetition move evidence");
  return {
    gameId: game.id,
    boardSize: boardSize(game.board_size),
    rules: {
      ruleset: game.rules as SgfExportInput["rules"]["ruleset"],
      rulesProfile: game.rules_profile as SgfExportInput["rules"]["rulesProfile"],
      scoringMethod: game.scoring_method as SgfExportInput["rules"]["scoringMethod"],
      komi: Number(game.komi),
      handicap: game.handicap,
    },
    moves,
    result: terminalResult(game, terminalResultRows.rows[0], repetitionRows.rows[0]),
    players: { blackName: game.black_player_name, whiteName: game.white_player_name },
  };
}

export async function exportPersistedGameToSgf(gameId: string, playerKey: string): Promise<string> {
  return withReadOnlyTransaction(async (client) =>
    exportGameToSgf(await loadSgfInput(client, gameId, playerKey))
  );
}
