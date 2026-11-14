import { withDeadline } from "./withDeadline";

const ENGINE_QUEUE_TIMEOUT_MS = 45_000;

export function createNativeKataGoQueue() {
  let pending: Promise<unknown> = Promise.resolve();
  return async <T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
    const previous = pending;
    let release!: () => void;
    const slot = new Promise<void>(resolve => { release = resolve; });
    pending = previous.then(() => slot);
    try {
      await withDeadline(previous, ENGINE_QUEUE_TIMEOUT_MS, "The local KataGo engine is still busy.", signal);
      signal?.throwIfAborted();
      return await work();
    } finally {
      release();
    }
  };
}

// Reviews and the trainer share one physical engine on each device.
export const queueNativeKataGo = createNativeKataGoQueue();
