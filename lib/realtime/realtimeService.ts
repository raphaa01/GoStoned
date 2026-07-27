/**
 * Boundary for a future WebSocket or managed realtime provider.
 * Durable game state remains in PostgreSQL; implementations only distribute events.
 */
export interface RealtimePublisher {
  publishGameEvent(gameId: string, event: unknown): Promise<void>;
}

export class RealtimeNotConfigured implements RealtimePublisher {
  async publishGameEvent(): Promise<void> {
    throw new Error("A realtime provider has not been configured.");
  }
}
