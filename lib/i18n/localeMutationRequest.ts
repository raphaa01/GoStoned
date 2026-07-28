import type { NextRequest } from "next/server";
import { AuthError } from "@/lib/auth/accountService";
import { assertAuthMutationRequest } from "@/lib/auth/credentialRequest";
import { isLocale, type Locale } from "./config";

export const MAX_LOCALE_MUTATION_BODY_BYTES = 64;
export const MAX_LOCALE_MUTATION_BODY_CHUNKS = 64;
export const LOCALE_MUTATION_BODY_TIMEOUT_MS = 1_000;

export class LocaleMutationRequestError extends Error {
  readonly status: 400 | 403;
  readonly code: "invalid_locale" | "locale_request_rejected";

  constructor(
    message: string,
    status: 400 | 403,
    code: "invalid_locale" | "locale_request_rejected",
  ) {
    super(message);
    this.name = "LocaleMutationRequestError";
    this.status = status;
    this.code = code;
  }
}

function invalidLocaleRequest(): LocaleMutationRequestError {
  return new LocaleMutationRequestError(
    "A supported locale is required.",
    400,
    "invalid_locale",
  );
}

function rejectedLocaleRequest(): LocaleMutationRequestError {
  return new LocaleMutationRequestError(
    "The locale request is not allowed.",
    403,
    "locale_request_rejected",
  );
}

function cancelBodyReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  void reader.cancel().catch(() => undefined);
}

export function assertLocaleMutationMetadata(request: NextRequest): void {
  try {
    assertAuthMutationRequest(request, { requireJson: true });
  } catch (error) {
    if (error instanceof AuthError) throw rejectedLocaleRequest();
    throw error;
  }
  if (request.nextUrl.search !== "") throw invalidLocaleRequest();
}

export async function readLocaleMutation(request: NextRequest): Promise<Locale> {
  if (request.body === null) throw invalidLocaleRequest();

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^[1-9]\d*$/.test(contentLength)) throw invalidLocaleRequest();
    const declaredLength = Number(contentLength);
    if (
      !Number.isSafeInteger(declaredLength)
      || declaredLength > MAX_LOCALE_MUTATION_BODY_BYTES
    ) {
      throw invalidLocaleRequest();
    }
  }

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = request.body.getReader();
  } catch {
    throw invalidLocaleRequest();
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  let bytesRead = 0;
  let chunksRead = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abortHandler: (() => void) | undefined;
  try {
    if (request.signal.aborted) throw invalidLocaleRequest();
    const interrupted = new Promise<never>((_, reject) => {
      abortHandler = () => reject(invalidLocaleRequest());
      request.signal.addEventListener("abort", abortHandler, { once: true });
      timeout = setTimeout(
        () => reject(invalidLocaleRequest()),
        LOCALE_MUTATION_BODY_TIMEOUT_MS,
      );
    });

    while (true) {
      const chunk = await Promise.race([reader.read(), interrupted]);
      if (chunk.done) break;
      chunksRead += 1;
      bytesRead += chunk.value.byteLength;
      if (
        chunksRead > MAX_LOCALE_MUTATION_BODY_CHUNKS
        || bytesRead > MAX_LOCALE_MUTATION_BODY_BYTES
      ) {
        throw invalidLocaleRequest();
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    cancelBodyReader(reader);
    if (error instanceof LocaleMutationRequestError) throw error;
    throw invalidLocaleRequest();
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    if (abortHandler !== undefined) {
      request.signal.removeEventListener("abort", abortHandler);
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw invalidLocaleRequest();
  }
  if (
    parsed === null
    || typeof parsed !== "object"
    || Array.isArray(parsed)
    || Object.getPrototypeOf(parsed) !== Object.prototype
  ) {
    throw invalidLocaleRequest();
  }
  const entries = Object.entries(parsed);
  if (entries.length !== 1 || entries[0][0] !== "locale" || !isLocale(entries[0][1])) {
    throw invalidLocaleRequest();
  }
  return entries[0][1];
}
