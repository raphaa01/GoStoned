import type { NextRequest } from "next/server";
import { readBoundedJsonObject } from "@/lib/api/boundedJson";
import { noStoreJson } from "@/lib/api/responses";
import { assertAuthMutationRequest } from "@/lib/auth/credentialRequest";
import {
  consumeEphemeralIpPolicyRateLimit,
  RATE_LIMIT_POLICIES,
} from "@/lib/auth/rateLimit";
import { assertExpectedPlayer } from "@/lib/auth/playerBindingServer";
import { resolvePlayerKey } from "@/lib/auth/requestAuth";
import { GameServiceError } from "@/lib/game/gameService";
import type { JapanesePersistedMove } from "@/lib/game/japaneseKo";
import type { BoardSize, Position, Stone } from "@/lib/game/types";
import { gameMutationRouteError } from "@/lib/game/gameMutationRequest";
import {
  scoreTrainingSettlement,
  type TrainingSettlementInput,
} from "@/lib/learn/trainingGameScoring";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_TRAINING_SCORE_BYTES = 192_000;

function invalidRequest(): GameServiceError {
  return new GameServiceError(
    "The training score request is invalid.",
    400,
    "invalid_training_score",
  );
}

function exactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === fields.length
    && fields.every((field) => Object.prototype.hasOwnProperty.call(value, field));
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function position(value: unknown): Position | null {
  const candidate = record(value);
  return candidate
    && exactFields(candidate, ["x", "y"])
    && Number.isInteger(candidate.x)
    && Number.isInteger(candidate.y)
      ? { x: Number(candidate.x), y: Number(candidate.y) }
      : null;
}

function positions(value: unknown, maximum: number): Position[] | null {
  if (!Array.isArray(value) || value.length > maximum) return null;
  const parsed = value.map(position);
  return parsed.every((candidate): candidate is Position => candidate !== null) ? parsed : null;
}

function move(value: unknown): JapanesePersistedMove | null {
  const candidate = record(value);
  if (
    !candidate
    || !exactFields(candidate, [
      "moveNumber",
      "color",
      "x",
      "y",
      "isPass",
      "createdAt",
      "boardHash",
    ])
    || !Number.isSafeInteger(candidate.moveNumber)
    || (candidate.color !== "black" && candidate.color !== "white")
    || typeof candidate.isPass !== "boolean"
    || typeof candidate.createdAt !== "string"
    || candidate.createdAt.length > 40
    || typeof candidate.boardHash !== "string"
    || candidate.boardHash.length > 400
  ) return null;
  const color = candidate.color as Stone;
  if (candidate.isPass) {
    if (candidate.x !== null || candidate.y !== null) return null;
  } else if (!Number.isInteger(candidate.x) || !Number.isInteger(candidate.y)) {
    return null;
  }
  return {
    moveNumber: Number(candidate.moveNumber),
    color,
    x: candidate.x === null ? null : Number(candidate.x),
    y: candidate.y === null ? null : Number(candidate.y),
    isPass: candidate.isPass,
    createdAt: candidate.createdAt,
    boardHash: candidate.boardHash,
  };
}

function parseInput(body: Record<string, unknown>): TrainingSettlementInput {
  if (!exactFields(body, ["boardSize", "moves", "proposal"])) throw invalidRequest();
  if (body.boardSize !== 9 && body.boardSize !== 13 && body.boardSize !== 19) {
    throw invalidRequest();
  }
  if (!Array.isArray(body.moves) || body.moves.length > 1_500) throw invalidRequest();
  const parsedMoves = body.moves.map(move);
  if (!parsedMoves.every((candidate): candidate is JapanesePersistedMove => candidate !== null)) {
    throw invalidRequest();
  }
  const rawProposal = record(body.proposal);
  if (!rawProposal || !exactFields(rawProposal, [
    "contractVersion",
    "modelVersion",
    "modelSha256",
    "authority",
    "stoppedMoveNumber",
    "deadStones",
    "uncertainStones",
    "neutralRegionSeeds",
  ])) throw invalidRequest();
  const boardSize = body.boardSize as BoardSize;
  const maximumPoints = boardSize * boardSize;
  const deadStones = positions(rawProposal.deadStones, maximumPoints);
  const uncertainStones = positions(rawProposal.uncertainStones, maximumPoints);
  const neutralRegionSeeds = positions(rawProposal.neutralRegionSeeds, maximumPoints);
  if (
    rawProposal.contractVersion !== "gostone-japanese-settlement-v1"
    || rawProposal.authority !== "proposal-only"
    || typeof rawProposal.modelVersion !== "string"
    || typeof rawProposal.modelSha256 !== "string"
    || !Number.isSafeInteger(rawProposal.stoppedMoveNumber)
    || !deadStones
    || !uncertainStones
    || !neutralRegionSeeds
  ) throw invalidRequest();

  return {
    boardSize,
    moves: parsedMoves,
    proposal: {
      contractVersion: rawProposal.contractVersion,
      modelVersion: rawProposal.modelVersion,
      modelSha256: rawProposal.modelSha256,
      authority: rawProposal.authority,
      stoppedMoveNumber: Number(rawProposal.stoppedMoveNumber),
      deadStones,
      uncertainStones,
      neutralRegionSeeds,
    },
  };
}

export async function POST(request: NextRequest) {
  try {
    assertAuthMutationRequest(request, { requireJson: true });
    if (request.nextUrl.search !== "") throw invalidRequest();
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    const playerKey = await resolvePlayerKey(request);
    assertExpectedPlayer(request, playerKey);
    const body = await readBoundedJsonObject(request, {
      maxBytes: MAX_TRAINING_SCORE_BYTES,
      maxChunks: 2_048,
      idleTimeoutMs: 1_000,
      totalTimeoutMs: 3_000,
      invalidJson: invalidRequest,
      invalidObject: invalidRequest,
    });
    return noStoreJson({
      ok: true,
      actor: playerKey,
      result: scoreTrainingSettlement(parseInput(body)),
    });
  } catch (error) {
    return gameMutationRouteError(error);
  }
}
