import type { NextRequest } from "next/server";
import { readBoundedJsonObject } from "@/lib/api/boundedJson";
import { assertAuthMutationRequest } from "@/lib/auth/credentialRequest";
import { GameServiceError } from "@/lib/game/gameService";

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
): Promise<{ x: number; y: number }> {
  const body = await readBoundedJsonObject(request, {
    maxBytes: 128,
    maxChunks: 16,
    idleTimeoutMs: 1_000,
    totalTimeoutMs: 2_000,
    invalidJson: invalidPuzzleRequest,
  });
  const fields = Object.keys(body);
  if (
    fields.length !== 2
    || !Object.prototype.hasOwnProperty.call(body, "x")
    || !Object.prototype.hasOwnProperty.call(body, "y")
    || !Number.isInteger(body.x)
    || !Number.isInteger(body.y)
  ) {
    throw invalidPuzzleRequest();
  }
  return { x: body.x as number, y: body.y as number };
}
