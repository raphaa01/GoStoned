export function createNativeKataGoQueue() {
  let pending: Promise<unknown> = Promise.resolve();
  return <T>(work: () => Promise<T>): Promise<T> => {
    const result = pending.then(work, work);
    pending = result.catch(() => undefined);
    return result;
  };
}

// Reviews and the trainer share one physical engine on each device.
export const queueNativeKataGo = createNativeKataGoQueue();
