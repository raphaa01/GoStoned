"use client";

import type {
  GoStoneBotPosition,
  GoStoneBotWorkerRequest,
  GoStoneBotWorkerResponse,
  GoStoneJapaneseSettlementProposal,
  GoStoneSettlementPosition,
  GoStoneBotMove,
} from "./modelV1";

type PendingRequest = {
  resolve: (value: GoStoneBotWorkerResponse) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

let worker: Worker | null = null;
const pending = new Map<string, PendingRequest>();

function browserWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("../../workers/browser/gostoneBot.worker.ts", import.meta.url), {
    type: "module",
    name: "gostone-bot-v1",
  });
  worker.addEventListener("message", (event: MessageEvent<GoStoneBotWorkerResponse>) => {
    const request = pending.get(event.data.id);
    if (!request) return;
    pending.delete(event.data.id);
    clearTimeout(request.timeout);
    request.resolve(event.data);
  });
  worker.addEventListener("error", () => {
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.reject(new Error("The local GoStone bot worker stopped unexpectedly."));
    }
    pending.clear();
    worker?.terminate();
    worker = null;
  });
  return worker;
}

async function requestWorker(
  request: GoStoneBotWorkerRequest,
  timeoutMs = 20_000,
): Promise<GoStoneBotWorkerResponse> {
  const activeWorker = browserWorker();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(request.id);
      reject(new Error("The local GoStone bot did not answer in time."));
    }, timeoutMs);
    pending.set(request.id, { resolve, reject, timeout });
    activeWorker.postMessage(request);
  });
}

function requestId(kind: string): string {
  return `${kind}:${crypto.randomUUID()}`;
}

export async function generateBrowserBotMove(
  position: GoStoneBotPosition,
): Promise<GoStoneBotMove> {
  const response = await requestWorker({ id: requestId("move"), kind: "move", position });
  if (!response.ok) throw new Error(response.error);
  if (response.kind !== "move") throw new Error("The bot worker returned the wrong response type.");
  return response.move;
}

export async function proposeJapaneseSettlement(
  position: GoStoneSettlementPosition,
): Promise<GoStoneJapaneseSettlementProposal> {
  const response = await requestWorker({
    id: requestId("settlement"),
    kind: "settlement",
    position,
  });
  if (!response.ok) throw new Error(response.error);
  if (response.kind !== "settlement") {
    throw new Error("The bot worker returned the wrong response type.");
  }
  return response.proposal;
}
