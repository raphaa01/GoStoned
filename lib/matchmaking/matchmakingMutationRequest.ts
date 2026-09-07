import type { NextRequest } from "next/server";
import { apiError, noStoreJson } from "@/lib/api/responses";
import { AuthError } from "@/lib/auth/accountService";
import { assertAuthMutationRequest } from "@/lib/auth/credentialRequest";
import { GameServiceError } from "@/lib/game/gameService";

export const MAX_MATCHMAKING_MUTATION_BODY_BYTES = 256;
const MAX_EMPTY_BODY_CHUNKS = 8;
export const EMPTY_MATCHMAKING_BODY_TIMEOUT_MS = 1_000;

export function invalidMatchmakingRequest(): GameServiceError {
  return new GameServiceError(
    "A valid board size and time control are required.",
    400,
    "invalid_matchmaking_request",
  );
}

export function assertMatchmakingMutationMetadata(
  request: NextRequest,
  bodyKind: "json" | "none",
): void {
  assertAuthMutationRequest(request, { requireJson: bodyKind === "json" });
  if (request.nextUrl.search !== "") throw invalidMatchmakingRequest();
}

function cancelBodyReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  void reader.cancel().catch(() => undefined);
}

export async function assertEmptyMatchmakingMutationBody(
  request: NextRequest,
): Promise<void> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && !/^0+$/.test(contentLength)) {
    throw invalidMatchmakingRequest();
  }
  if (request.body === null) return;

  const reader = request.body.getReader();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abortHandler: (() => void) | undefined;
  let emptyChunks = 0;
  try {
    if (request.signal.aborted) throw invalidMatchmakingRequest();
    const interrupted = new Promise<never>((_, reject) => {
      abortHandler = () => reject(invalidMatchmakingRequest());
      request.signal.addEventListener("abort", abortHandler, { once: true });
      timeout = setTimeout(
        () => reject(invalidMatchmakingRequest()),
        EMPTY_MATCHMAKING_BODY_TIMEOUT_MS,
      );
    });
    while (true) {
      const chunk = await Promise.race([reader.read(), interrupted]);
      if (chunk.done) return;
      if (chunk.value.byteLength !== 0 || emptyChunks >= MAX_EMPTY_BODY_CHUNKS) {
        throw invalidMatchmakingRequest();
      }
      emptyChunks += 1;
    }
  } catch (error) {
    cancelBodyReader(reader);
    if (error instanceof GameServiceError) throw error;
    throw invalidMatchmakingRequest();
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    if (abortHandler !== undefined) {
      request.signal.removeEventListener("abort", abortHandler);
    }
  }
}

export async function readMatchmakingJoinRequest(
  request: NextRequest,
): Promise<{ boardSize: unknown; timeControl: unknown }> {
  if (request.body === null) throw invalidMatchmakingRequest();

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (
      !Number.isSafeInteger(declaredLength)
      || declaredLength < 1
      || declaredLength > MAX_MATCHMAKING_MUTATION_BODY_BYTES
    ) {
      throw invalidMatchmakingRequest();
    }
  }

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = request.body.getReader();
  } catch {
    throw invalidMatchmakingRequest();
  }
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  let bytesRead = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytesRead += chunk.value.byteLength;
      if (bytesRead > MAX_MATCHMAKING_MUTATION_BODY_BYTES) {
        await reader.cancel();
        throw invalidMatchmakingRequest();
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (error instanceof GameServiceError) throw error;
    throw invalidMatchmakingRequest();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw invalidMatchmakingRequest();
  }
  if (
    parsed === null
    || typeof parsed !== "object"
    || Array.isArray(parsed)
    || Object.getPrototypeOf(parsed) !== Object.prototype
  ) {
    throw invalidMatchmakingRequest();
  }
  const fields = Object.keys(parsed);
  if (
    fields.length !== 2
    || !Object.prototype.hasOwnProperty.call(parsed, "boardSize")
    || !Object.prototype.hasOwnProperty.call(parsed, "timeControl")
  ) {
    throw invalidMatchmakingRequest();
  }
  return parsed as { boardSize: unknown; timeControl: unknown };
}

export function matchmakingMutationRouteError(error: unknown) {
  if (error instanceof AuthError) {
    return noStoreJson(
      { ok: false, error: error.message, code: error.code },
      { status: error.status },
    );
  }
  return apiError(error);
}
