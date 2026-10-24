export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly retryAfterSeconds: number | null;

  constructor(
    message: string,
    options: { status: number; code?: string; retryAfterSeconds?: number },
  ) {
    super(message);
    this.name = "ApiRequestError";
    this.status = options.status;
    this.code = options.code ?? null;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

function retryAfterSeconds(response: Response, bodyValue?: number): number | undefined {
  const headerValue = Number(response.headers.get("Retry-After"));
  if (Number.isFinite(headerValue) && headerValue > 0) return Math.ceil(headerValue);
  if (Number.isFinite(bodyValue) && Number(bodyValue) > 0) return Math.ceil(Number(bodyValue));
  return undefined;
}

export async function readApi<T>(response: Response): Promise<T> {
  const payload: unknown = await response.json().catch((error: unknown) => {
    // Proxies can return HTML or an empty body. Preserve HTTP recovery and
    // backoff metadata, while letting cancellation and transport errors through.
    if (error instanceof SyntaxError) return null;
    throw error;
  });
  const body = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown> : null;
  if (!response.ok || body?.ok !== true) {
    throw new ApiRequestError(typeof body?.error === "string" ? body.error : "Request failed.", {
      status: response.status,
      code: typeof body?.code === "string" ? body.code : undefined,
      retryAfterSeconds: retryAfterSeconds(
        response,
        typeof body?.retryAfterSeconds === "number" ? body.retryAfterSeconds : undefined,
      ),
    });
  }
  return body as T;
}
