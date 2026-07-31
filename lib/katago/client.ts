import type {
  CanonicalKataGoScoringRequest,
  KataGoScoringProposal,
  KataGoScoringProvider,
} from "./contracts";
import { canonicalizeKataGoScoringRequest } from "./canonical";
import { kataGoError, normalizeKataGoError } from "./errors";
import { validateKataGoScoringResponse } from "./response";

type CacheEntry = Readonly<{ proposal: KataGoScoringProposal; expiresAt: number }>;

export type KataGoScoringClientOptions = Readonly<{
  provider: KataGoScoringProvider;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  circuitFailureThreshold?: number;
  circuitCooldownMs?: number;
  cacheTtlMs?: number;
  cacheMaxEntries?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}>;

function boundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw kataGoError("provider_not_configured", `${name} is outside its supported bound.`);
  }
  return value;
}

export class KataGoScoringClient {
  private readonly provider: KataGoScoringProvider;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly circuitFailureThreshold: number;
  private readonly circuitCooldownMs: number;
  private readonly cacheTtlMs: number;
  private readonly cacheMaxEntries: number;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<KataGoScoringProposal>>();
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;

  constructor(options: KataGoScoringClientOptions) {
    this.provider = options.provider;
    this.timeoutMs = boundedInteger(options.timeoutMs ?? 5_000, 100, 30_000, "timeoutMs");
    this.maxRetries = boundedInteger(options.maxRetries ?? 1, 0, 2, "maxRetries");
    this.retryDelayMs = boundedInteger(options.retryDelayMs ?? 100, 0, 2_000, "retryDelayMs");
    this.circuitFailureThreshold = boundedInteger(
      options.circuitFailureThreshold ?? 3,
      1,
      20,
      "circuitFailureThreshold",
    );
    this.circuitCooldownMs = boundedInteger(
      options.circuitCooldownMs ?? 30_000,
      1_000,
      300_000,
      "circuitCooldownMs",
    );
    this.cacheTtlMs = boundedInteger(options.cacheTtlMs ?? 10 * 60_000, 1_000, 86_400_000, "cacheTtlMs");
    this.cacheMaxEntries = boundedInteger(options.cacheMaxEntries ?? 256, 1, 10_000, "cacheMaxEntries");
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  private cached(identity: string): KataGoScoringProposal | null {
    const entry = this.cache.get(identity);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.cache.delete(identity);
      return null;
    }
    this.cache.delete(identity);
    this.cache.set(identity, entry);
    return entry.proposal;
  }

  private store(proposal: KataGoScoringProposal): void {
    this.cache.set(proposal.requestIdentity, {
      proposal,
      expiresAt: this.now() + this.cacheTtlMs,
    });
    while (this.cache.size > this.cacheMaxEntries) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }

  private assertCircuitAvailable(): void {
    const now = this.now();
    if (this.circuitOpenUntil > now) {
      throw kataGoError("circuit_open", "KataGo scoring is temporarily unavailable.", { retryable: true });
    }
    if (this.circuitOpenUntil !== 0) this.circuitOpenUntil = 0;
  }

  private recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.circuitFailureThreshold) {
      this.circuitOpenUntil = this.now() + this.circuitCooldownMs;
    }
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.circuitOpenUntil = 0;
  }

  private async attempt(request: CanonicalKataGoScoringRequest): Promise<unknown> {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    const aborted = new Promise<never>((_, reject) => {
      controller.signal.addEventListener("abort", () => {
        reject(kataGoError(
          timedOut ? "request_timeout" : "request_aborted",
          timedOut ? "KataGo scoring exceeded its deadline." : "KataGo scoring was cancelled.",
          { retryable: timedOut },
        ));
      }, { once: true });
    });
    try {
      return await Promise.race([
        this.provider.analyze(request, { signal: controller.signal }),
        aborted,
      ]);
    } catch (error) {
      if (timedOut) {
        throw kataGoError("request_timeout", "KataGo scoring exceeded its deadline.", {
          retryable: true,
          cause: error,
        });
      }
      throw normalizeKataGoError(error);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async execute(request: CanonicalKataGoScoringRequest): Promise<KataGoScoringProposal> {
    this.assertCircuitAvailable();
    let lastError: ReturnType<typeof normalizeKataGoError> | null = null;
    for (let attemptNumber = 0; attemptNumber <= this.maxRetries; attemptNumber += 1) {
      try {
        const response = await this.attempt(request);
        const proposal = validateKataGoScoringResponse(response, request, this.provider.kind);
        this.recordSuccess();
        this.store(proposal);
        return proposal;
      } catch (error) {
        lastError = normalizeKataGoError(error);
        if (!lastError.retryable || attemptNumber >= this.maxRetries) break;
        await this.sleep(Math.min(this.retryDelayMs * (2 ** attemptNumber), 2_000));
      }
    }
    this.recordFailure();
    if (this.maxRetries > 0 && lastError?.retryable) {
      throw kataGoError(
        "retries_exhausted",
        "KataGo scoring remained unavailable after bounded retries.",
        { retryable: true, cause: lastError },
      );
    }
    throw lastError ?? kataGoError("provider_unavailable", "KataGo scoring failed.", { retryable: true });
  }

  private waitForCaller(
    operation: Promise<KataGoScoringProposal>,
    signal?: AbortSignal,
  ): Promise<KataGoScoringProposal> {
    if (!signal) return operation;
    if (signal.aborted) {
      return Promise.reject(kataGoError("request_aborted", "KataGo scoring was cancelled."));
    }
    return new Promise((resolve, reject) => {
      const abort = () => reject(kataGoError("request_aborted", "KataGo scoring was cancelled."));
      signal.addEventListener("abort", abort, { once: true });
      operation.then(
        (proposal) => {
          signal.removeEventListener("abort", abort);
          resolve(proposal);
        },
        (error: unknown) => {
          signal.removeEventListener("abort", abort);
          reject(error);
        },
      );
    });
  }

  /**
   * Canonicalizes before lookup, coalesces equal in-flight positions, and caches
   * only fully validated proposals. Caller cancellation never aborts another
   * caller sharing the same provider operation.
   */
  analyze(request: unknown, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<KataGoScoringProposal> {
    const canonical = canonicalizeKataGoScoringRequest(request);
    const cached = this.cached(canonical.requestIdentity);
    if (cached) return this.waitForCaller(Promise.resolve(cached), options.signal);
    const running = this.inFlight.get(canonical.requestIdentity);
    if (running) return this.waitForCaller(running, options.signal);
    const operation = this.execute(canonical).finally(() => {
      this.inFlight.delete(canonical.requestIdentity);
    });
    this.inFlight.set(canonical.requestIdentity, operation);
    return this.waitForCaller(operation, options.signal);
  }

  clearCache(): void {
    this.cache.clear();
  }
}
