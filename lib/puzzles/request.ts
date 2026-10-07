import type { NextRequest } from "next/server";
import { readBoundedJsonObject } from "@/lib/api/boundedJson";
import { assertAuthMutationRequest } from "@/lib/auth/credentialRequest";
import { GameServiceError } from "@/lib/game/gameService";
import type { PuzzleAttemptInput } from "./types";

const CANONICAL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function invalidPuzzleRequest(): GameServiceError {
  return new GameServiceError("The puzzle request is invalid.", 400, "invalid_puzzle_request");
}

export function parsePuzzleMode(request: NextRequest): "daily" | "practice" {
  if (request.nextUrl.search === "?mode=daily") return "daily";
  if (request.nextUrl.search === "?mode=practice") return "practice";
  throw invalidPuzzleRequest();
}

export function assertPuzzleId(puzzleId: string): void {
  if (!CANONICAL_ID.test(puzzleId)) {
    throw new GameServiceError("Puzzle not found.", 404, "puzzle_not_found");
  }
}

export function assertPuzzleAttemptMetadata(request: NextRequest): void {
  assertAuthMutationRequest(request, { requireJson: true });
  if (request.nextUrl.search !== "") throw invalidPuzzleRequest();
}

export async function readPuzzleAttemptBody(
  request: NextRequest,
): Promise<PuzzleAttemptInput> {
  const body = await readBoundedJsonObject(request, {
    maxBytes: 128,
    maxChunks: 16,
    idleTimeoutMs: 1_000,
    totalTimeoutMs: 2_000,
    invalidJson: invalidPuzzleRequest,
  });
  const fields = Object.keys(body);
  if (
    (fields.length !== 3 && fields.length !== 4)
    || fields.some((field) => !["x", "y", "revision", "action"].includes(field))
    || (body.action !== undefined && !["play", "pass", "undo", "restart"].includes(body.action as string))
    || !Object.prototype.hasOwnProperty.call(body, "x")
    || !Object.prototype.hasOwnProperty.call(body, "y")
    || !Object.prototype.hasOwnProperty.call(body, "revision")
    || !Number.isInteger(body.x)
    || !Number.isInteger(body.y)
    || !Number.isInteger(body.revision)
    || (body.revision as number) < 0
    || (body.revision as number) > 1_000
  ) {
    throw invalidPuzzleRequest();
  }
  return { x: body.x as number, y: body.y as number, revision: body.revision as number, ...(body.action === undefined ? {} : { action: body.action as PuzzleAttemptInput["action"] }) };
}
