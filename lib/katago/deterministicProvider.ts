import type {
  CanonicalKataGoScoringRequest,
  KataGoScoringProvider,
} from "./contracts";
import { kataGoError } from "./errors";

export type DeterministicKataGoResolver = (
  request: CanonicalKataGoScoringRequest,
) => unknown | Promise<unknown>;

export function deterministicAliveResponse(request: CanonicalKataGoScoringRequest) {
  const ownership = request.board.map((row) => row.map(() => 0));
  const stones = request.board.flatMap((row, y) => row.flatMap((point, x) =>
    point ? [{ x, y, status: "alive" as const, confidence: 1 }] : []
  ));
  return {
    contractVersion: request.contractVersion,
    requestIdentity: request.requestIdentity,
    gameId: request.gameId,
    stoppedBoardHash: request.stoppedBoardHash,
    stoppedMoveNumber: request.stoppedMoveNumber,
    scoringRevision: request.scoringRevision,
    boardSize: request.boardSize,
    rules: request.rules,
    playerToMove: request.playerToMove,
    engine: {
      name: "KataGo",
      ...request.engine,
      visits: Math.min(1, request.maxVisits),
    },
    ownership,
    stones,
  };
}

/** A zero-network deterministic provider for CI, unit tests, and local fixtures. */
export class DeterministicKataGoScoringProvider implements KataGoScoringProvider {
  readonly kind = "deterministic" as const;
  private readonly resolver: DeterministicKataGoResolver;

  constructor(resolver: DeterministicKataGoResolver = deterministicAliveResponse) {
    this.resolver = resolver;
  }

  async analyze(
    request: CanonicalKataGoScoringRequest,
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<unknown> {
    if (options.signal.aborted) {
      throw kataGoError("request_aborted", "KataGo scoring was cancelled.");
    }
    return this.resolver(request);
  }
}
