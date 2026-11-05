"use client";

import { goStoneSettlementPosition } from "./modelV1";
import { BotWorkerTransport } from "./workerTransport";

import type {
  GoStoneBotPosition,
  GoStoneBotWorkerRequest,
  GoStoneBotWorkerResponse,
  GoStoneJapaneseSettlementProposal,
  GoStoneBotMove,
} from "./modelV1";

const transport = new BotWorkerTransport(() => new Worker(new URL("../../workers/browser/gostoneBot.worker.ts", import.meta.url), {
    type: "module",
    name: "gostone-bot-v1",
  }));

async function requestWorker(
  request: GoStoneBotWorkerRequest,
): Promise<GoStoneBotWorkerResponse> {
  return transport.request(request);
}

function requestId(kind: string): string {
  return `${kind}:${crypto.randomUUID()}`;
}

export async function generateCaptureGoMove(position: import("@/lib/learn/lessonEngine").LearnGamePosition) {
  const response = await requestWorker({ id: requestId("capture-go"), kind: "capture-go", position });
  if (!response.ok) throw new Error(response.error);
  if (response.kind !== "capture-go") throw new Error("The bot worker returned the wrong response type.");
  return response.point;
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
  position: Omit<GoStoneBotPosition, "toMove" | "excludedMoves">,
): Promise<GoStoneJapaneseSettlementProposal> {
  const response = await requestWorker({
    id: requestId("settlement"),
    kind: "settlement",
    position: goStoneSettlementPosition(position),
  });
  if (!response.ok) throw new Error(response.error);
  if (response.kind !== "settlement") {
    throw new Error("The bot worker returned the wrong response type.");
  }
  return response.proposal;
}
