import type {
  GoStoneBotWorkerRequest,
  GoStoneBotWorkerResponse,
} from "./modelV1";

type Pending = {
  resolve: (value: GoStoneBotWorkerResponse) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

/** A hung/crashed worker must be replaced, including its failed model session. */
export class BotWorkerTransport {
  private worker: Worker | null = null;
  private readonly pending = new Map<string, Pending>();
  constructor(
    private readonly createWorker: () => Worker,
    private readonly timeoutMs = 60_000,
  ) {}

  private stop(active: Worker, error: Error) {
    if (this.worker !== active) return;
    this.worker = null;
    active.terminate();
    for (const request of this.pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    this.pending.clear();
  }
  private current(): Worker {
    if (this.worker) return this.worker;
    const active = this.createWorker();
    this.worker = active;
    active.addEventListener(
      "message",
      (event: MessageEvent<GoStoneBotWorkerResponse>) => {
        if (this.worker !== active) return;
        const response = event.data;
        if (!response || typeof response.id !== "string") return;
        const request = this.pending.get(response.id);
        if (!request) return;
        this.pending.delete(response.id);
        clearTimeout(request.timeout);
        request.resolve(response);
      },
    );
    active.addEventListener("error", () =>
      this.stop(
        active,
        new Error("The local GoStone bot worker stopped unexpectedly."),
      ),
    );
    active.addEventListener("messageerror", () =>
      this.stop(
        active,
        new Error("The local GoStone bot response could not be read."),
      ),
    );
    return active;
  }
  async request(
    request: GoStoneBotWorkerRequest,
  ): Promise<GoStoneBotWorkerResponse> {
    const active = this.current();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () =>
          this.stop(
            active,
            new Error("The local GoStone bot did not answer in time."),
          ),
        this.timeoutMs,
      );
      this.pending.set(request.id, { resolve, reject, timeout });
      try {
        active.postMessage(request);
      } catch (error) {
        this.stop(
          active,
          error instanceof Error
            ? error
            : new Error("Could not start the local bot."),
        );
      }
    });
  }
}
