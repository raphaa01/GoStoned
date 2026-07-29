import type { NextRequest } from "next/server";

export type BoundedJsonObjectOptions<TError extends Error> = Readonly<{
  maxBytes: number;
  maxChunks: number;
  idleTimeoutMs: number;
  totalTimeoutMs: number;
  invalidJson: () => TError;
  invalidObject?: () => TError;
}>;

function cancelBodyReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  void reader.cancel().catch(() => undefined);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
}

export async function readBoundedJsonObject<TError extends Error>(
  request: NextRequest,
  options: BoundedJsonObjectOptions<TError>,
): Promise<Record<string, unknown>> {
  assertPositiveInteger(options.maxBytes, "maxBytes");
  assertPositiveInteger(options.maxChunks, "maxChunks");
  assertPositiveInteger(options.idleTimeoutMs, "idleTimeoutMs");
  assertPositiveInteger(options.totalTimeoutMs, "totalTimeoutMs");
  if (options.totalTimeoutMs < options.idleTimeoutMs) {
    throw new RangeError("totalTimeoutMs must not be shorter than idleTimeoutMs.");
  }
  if (request.body === null) throw options.invalidJson();

  const contentLength = request.headers.get("content-length");
  const transferEncoding = request.headers.get("transfer-encoding");
  if (contentLength !== null && transferEncoding !== null) {
    throw options.invalidJson();
  }
  let declaredLength: number | null = null;
  if (contentLength !== null) {
    if (!/^[1-9]\d*$/.test(contentLength)) throw options.invalidJson();
    declaredLength = Number(contentLength);
    if (!Number.isSafeInteger(declaredLength) || declaredLength > options.maxBytes) {
      throw options.invalidJson();
    }
  }

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = request.body.getReader();
  } catch {
    throw options.invalidJson();
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  let bytesRead = 0;
  let chunksRead = 0;
  let totalTimeout: ReturnType<typeof setTimeout> | undefined;
  let abortHandler: (() => void) | undefined;
  try {
    if (request.signal.aborted) throw options.invalidJson();
    const aborted = new Promise<never>((_resolve, reject) => {
      abortHandler = () => reject(options.invalidJson());
      request.signal.addEventListener("abort", abortHandler, { once: true });
    });
    const totalDeadline = new Promise<never>((_resolve, reject) => {
      totalTimeout = setTimeout(
        () => reject(options.invalidJson()),
        options.totalTimeoutMs,
      );
    });

    while (true) {
      let idleTimeout: ReturnType<typeof setTimeout> | undefined;
      const idleDeadline = new Promise<never>((_resolve, reject) => {
        idleTimeout = setTimeout(
          () => reject(options.invalidJson()),
          options.idleTimeoutMs,
        );
      });
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await Promise.race([
          reader.read(),
          aborted,
          totalDeadline,
          idleDeadline,
        ]);
      } finally {
        if (idleTimeout !== undefined) clearTimeout(idleTimeout);
      }
      if (chunk.done) break;
      chunksRead += 1;
      bytesRead += chunk.value.byteLength;
      if (chunksRead > options.maxChunks || bytesRead > options.maxBytes) {
        throw options.invalidJson();
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    if (declaredLength !== null && bytesRead !== declaredLength) {
      throw options.invalidJson();
    }
    text += decoder.decode();
  } catch {
    cancelBodyReader(reader);
    throw options.invalidJson();
  } finally {
    if (totalTimeout !== undefined) clearTimeout(totalTimeout);
    if (abortHandler !== undefined) {
      request.signal.removeEventListener("abort", abortHandler);
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw options.invalidJson();
  }
  if (
    parsed === null
    || typeof parsed !== "object"
    || Array.isArray(parsed)
    || Object.getPrototypeOf(parsed) !== Object.prototype
  ) {
    throw (options.invalidObject ?? options.invalidJson)();
  }
  return parsed as Record<string, unknown>;
}
