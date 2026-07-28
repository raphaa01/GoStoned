import type { NextRequest } from "next/server";
import { apiError, noStoreJson } from "@/lib/api/responses";
import { AuthError } from "@/lib/auth/accountService";
import { assertAuthMutationRequest } from "@/lib/auth/credentialRequest";
import { GameServiceError } from "./gameService";

const CANONICAL_GAME_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const MAX_GAME_MUTATION_BODY_BYTES = 512;

export function invalidGameMutationRequest(): GameServiceError {
  return new GameServiceError(
    "The game action request is invalid.",
    400,
    "invalid_game_mutation_request",
  );
}

const MAX_EMPTY_BODY_CHUNKS = 8;
export const EMPTY_GAME_MUTATION_BODY_TIMEOUT_MS = 1_000;

function cancelBodyReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  void reader.cancel().catch(() => undefined);
}

export async function assertEmptyGameMutationBody(request: NextRequest): Promise<void> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && !/^0+$/.test(contentLength)) {
    throw invalidGameMutationRequest();
  }
  if (request.body === null) return;

  const reader = request.body.getReader();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abortHandler: (() => void) | undefined;
  let emptyChunks = 0;
  try {
    if (request.signal.aborted) throw invalidGameMutationRequest();
    const interrupted = new Promise<never>((_, reject) => {
      abortHandler = () => reject(invalidGameMutationRequest());
      request.signal.addEventListener("abort", abortHandler, { once: true });
      timeout = setTimeout(
        () => reject(invalidGameMutationRequest()),
        EMPTY_GAME_MUTATION_BODY_TIMEOUT_MS,
      );
    });
    while (true) {
      const chunk = await Promise.race([reader.read(), interrupted]);
      if (chunk.done) return;
      if (chunk.value.byteLength !== 0 || emptyChunks >= MAX_EMPTY_BODY_CHUNKS) {
        throw invalidGameMutationRequest();
      }
      emptyChunks += 1;
    }
  } catch (error) {
    cancelBodyReader(reader);
    if (error instanceof GameServiceError) throw error;
    throw invalidGameMutationRequest();
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    if (abortHandler !== undefined) {
      request.signal.removeEventListener("abort", abortHandler);
    }
  }
}

export function assertGameMutationMetadata(
  request: NextRequest,
  gameId: string,
  bodyKind: "json" | "none",
): void {
  assertAuthMutationRequest(request, { requireJson: bodyKind === "json" });
  if (request.nextUrl.search !== "") throw invalidGameMutationRequest();
  if (!CANONICAL_GAME_ID.test(gameId)) {
    throw new GameServiceError("Game not found.", 404, "game_not_found");
  }
}

function hasExactFields(
  value: Record<string, unknown>,
  acceptedFields: readonly (readonly string[])[],
): boolean {
  const keys = Object.keys(value);
  return acceptedFields.some((fields) =>
    keys.length === fields.length
    && fields.every((field) => Object.prototype.hasOwnProperty.call(value, field))
  );
}

export async function readGameMutationJson(
  request: NextRequest,
  acceptedFields: readonly (readonly string[])[],
): Promise<Record<string, unknown>> {
  if (request.body === null) throw invalidGameMutationRequest();

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (
      !Number.isSafeInteger(declaredLength)
      || declaredLength < 1
      || declaredLength > MAX_GAME_MUTATION_BODY_BYTES
    ) {
      throw invalidGameMutationRequest();
    }
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  let bytesRead = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytesRead += chunk.value.byteLength;
      if (bytesRead > MAX_GAME_MUTATION_BODY_BYTES) {
        await reader.cancel();
        throw invalidGameMutationRequest();
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (error instanceof GameServiceError) throw error;
    throw invalidGameMutationRequest();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw invalidGameMutationRequest();
  }
  if (
    parsed === null
    || typeof parsed !== "object"
    || Array.isArray(parsed)
    || Object.getPrototypeOf(parsed) !== Object.prototype
    || !hasExactFields(parsed as Record<string, unknown>, acceptedFields)
  ) {
    throw invalidGameMutationRequest();
  }
  return parsed as Record<string, unknown>;
}

export function gameMutationRouteError(error: unknown) {
  if (error instanceof AuthError) {
    return noStoreJson(
      { ok: false, error: error.message, code: error.code },
      { status: error.status },
    );
  }
  return apiError(error);
}
