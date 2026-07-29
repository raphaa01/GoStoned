import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { readBoundedJsonObject } from "./api/boundedJson";

class InvalidBodyError extends Error {}

function request(
  body: BodyInit | null,
  options: { contentLength?: string; signal?: AbortSignal } = {},
): NextRequest {
  return new NextRequest("https://gostone.test/api/test", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options.contentLength === undefined
        ? {}
        : { "Content-Length": options.contentLength }),
    },
    ...(body === null ? {} : { body }),
    ...(body instanceof ReadableStream ? { duplex: "half" as const } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

function read(
  candidate: NextRequest,
  overrides: Partial<{
    maxBytes: number;
    maxChunks: number;
    idleTimeoutMs: number;
    totalTimeoutMs: number;
  }> = {},
) {
  return readBoundedJsonObject(candidate, {
    maxBytes: overrides.maxBytes ?? 128,
    maxChunks: overrides.maxChunks ?? 128,
    idleTimeoutMs: overrides.idleTimeoutMs ?? 100,
    totalTimeoutMs: overrides.totalTimeoutMs ?? 200,
    invalidJson: () => new InvalidBodyError("invalid body"),
  });
}

function invalidBody(error: unknown): boolean {
  return error instanceof InvalidBodyError;
}

test("bounded JSON preserves split multibyte UTF-8", async () => {
  const encoded = new TextEncoder().encode(JSON.stringify({ message: "Grüße 界" }));
  let offset = 0;
  const fragmented = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset === encoded.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoded.subarray(offset, offset + 1));
      offset += 1;
    },
  });

  assert.deepEqual(await read(request(fragmented)), { message: "Grüße 界" });
});

test("declared body limits reject before consuming the stream", async () => {
  for (const contentLength of ["", "0", "00", "+1", "1.0", "1e2", "129"]) {
    const stalled = new ReadableStream<Uint8Array>({
      pull() {
        return new Promise<void>(() => undefined);
      },
    });
    const candidate = request(stalled, { contentLength });
    await assert.rejects(read(candidate), invalidBody, contentLength);
    assert.equal(candidate.bodyUsed, false, contentLength);
  }
});

test("declared lengths must exactly frame the body and cannot conflict with transfer encoding", async () => {
  const body = JSON.stringify({ message: "exact framing" });
  const actualLength = Buffer.byteLength(body);
  for (const contentLength of [actualLength - 1, actualLength + 1]) {
    await assert.rejects(
      read(request(body, { contentLength: String(contentLength) })),
      invalidBody,
      String(contentLength),
    );
  }

  const conflicting = request(body, { contentLength: String(actualLength) });
  conflicting.headers.set("Transfer-Encoding", "chunked");
  await assert.rejects(read(conflicting), invalidBody);
  assert.equal(conflicting.bodyUsed, false);
});

test("actual byte limits reject chunked bodies without a declared length", async () => {
  let cancelled = 0;
  const oversized = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(129));
    },
    cancel() {
      cancelled += 1;
      return new Promise<void>(() => undefined);
    },
  });

  await Promise.race([
    assert.rejects(read(request(oversized)), invalidBody),
    new Promise((_, reject) => setTimeout(
      () => reject(new Error("oversized body rejection awaited cancellation")),
      50,
    )),
  ]);
  assert.equal(cancelled, 1);
});

test("strict decoding and plain-object validation reject malformed input", async () => {
  for (const body of [
    new Uint8Array([0xc3, 0x28]),
    "not-json",
    "null",
    "[]",
    "\"string\"",
  ]) {
    await assert.rejects(read(request(body)), invalidBody);
  }
});

test("chunk limits count empty chunks and cancel hostile streams", async () => {
  let cancelled = 0;
  const fragmented = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let index = 0; index < 4; index += 1) {
        controller.enqueue(new Uint8Array());
      }
    },
    cancel() {
      cancelled += 1;
      return new Promise<void>(() => undefined);
    },
  });

  await Promise.race([
    assert.rejects(read(request(fragmented), { maxChunks: 3 }), invalidBody),
    new Promise((_, reject) => setTimeout(
      () => reject(new Error("chunk-limit rejection awaited cancellation")),
      50,
    )),
  ]);
  assert.equal(cancelled, 1);
});

test("idle deadlines and request aborts settle stalled readers", async () => {
  for (const fixture of ["idle", "abort"] as const) {
    const abortController = new AbortController();
    let cancelled = 0;
    const stalled = new ReadableStream<Uint8Array>({
      pull() {
        return new Promise<void>(() => undefined);
      },
      cancel() {
        cancelled += 1;
        return new Promise<void>(() => undefined);
      },
    });
    const reading = read(
      request(stalled, { signal: abortController.signal }),
      { idleTimeoutMs: 20, totalTimeoutMs: 100 },
    );
    if (fixture === "abort") {
      await Promise.resolve();
      abortController.abort();
    }
    await Promise.race([
      assert.rejects(reading, invalidBody),
      new Promise((_, reject) => setTimeout(
        () => reject(new Error(`${fixture} did not settle the body reader`)),
        150,
      )),
    ]);
    assert.equal(cancelled, 1, fixture);
  }
});

test("a total deadline terminates a stream that stays below the idle deadline", async () => {
  let cancelled = false;
  const trickle = new ReadableStream<Uint8Array>({
    async pull(controller) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (!cancelled) controller.enqueue(new Uint8Array());
    },
    cancel() {
      cancelled = true;
      return new Promise<void>(() => undefined);
    },
  });

  await Promise.race([
    assert.rejects(read(request(trickle), {
      maxChunks: 1_000,
      idleTimeoutMs: 25,
      totalTimeoutMs: 50,
    }), invalidBody),
    new Promise((_, reject) => setTimeout(
      () => reject(new Error("total deadline did not settle the body reader")),
      150,
    )),
  ]);
  assert.equal(cancelled, true);
});
