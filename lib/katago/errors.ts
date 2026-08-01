export const KATAGO_ERROR_CODES = Object.freeze([
  "invalid_request",
  "provider_not_configured",
  "request_aborted",
  "request_timeout",
  "provider_unavailable",
  "provider_http_error",
  "response_too_large",
  "invalid_response_json",
  "invalid_response",
  "stale_response",
  "model_mismatch",
  "circuit_open",
  "retries_exhausted",
] as const);

export type KataGoErrorCode = (typeof KATAGO_ERROR_CODES)[number];

export class KataGoScoringError extends Error {
  readonly code: KataGoErrorCode;
  readonly retryable: boolean;

  constructor(
    code: KataGoErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message);
    this.name = "KataGoScoringError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

export function kataGoError(
  code: KataGoErrorCode,
  message: string,
  options?: { retryable?: boolean; cause?: unknown },
): KataGoScoringError {
  return new KataGoScoringError(code, message, options);
}

export function normalizeKataGoError(error: unknown): KataGoScoringError {
  if (error instanceof KataGoScoringError) return error;
  if (error instanceof DOMException && error.name === "AbortError") {
    return kataGoError("request_aborted", "KataGo scoring was cancelled.", { cause: error });
  }
  return kataGoError(
    "provider_unavailable",
    "The KataGo scoring provider could not complete the request.",
    { retryable: true, cause: error },
  );
}
