/// <reference lib="webworker" />

import { chooseLocalBotMove, type LocalBotInput } from "./localBot";

type Request = { requestId: string; input: LocalBotInput };
type Response =
  | { requestId: string; ok: true; move: ReturnType<typeof chooseLocalBotMove> }
  | { requestId: string; ok: false; error: string };

const workerScope = self as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<Request>) => {
  try {
    workerScope.postMessage({
      requestId: event.data.requestId,
      ok: true,
      move: chooseLocalBotMove(event.data.input),
    } satisfies Response);
  } catch (error) {
    workerScope.postMessage({
      requestId: event.data.requestId,
      ok: false,
      error: error instanceof Error ? error.message : "Local bot failed.",
    } satisfies Response);
  }
};

export {};
