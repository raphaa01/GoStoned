export function withDeadline<T>(
  work: Promise<T>,
  milliseconds: number,
  message: string,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    const fail = (cause: unknown) => {
      cleanup();
      reject(cause);
    };
    const abort = () => fail(signal?.reason);
    const timer = setTimeout(() => fail(new Error(message)), milliseconds);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    void work.then((value) => {
      cleanup();
      resolve(value);
    }, fail);
  });
}
