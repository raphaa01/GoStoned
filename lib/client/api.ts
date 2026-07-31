type ApiResponse<T> =
  | ({ ok: true } & T)
  | {
      ok: false;
      error: string;
      code?: string;
      retryAfterSeconds?: number;
    };

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
  const body = (await response.json()) as ApiResponse<T>;
  if (!response.ok || !body.ok) {
    throw new ApiRequestError("error" in body ? body.error : "Request failed.", {
      status: response.status,
      code: "code" in body ? body.code : undefined,
      retryAfterSeconds: retryAfterSeconds(
        response,
        "retryAfterSeconds" in body ? body.retryAfterSeconds : undefined,
      ),
    });
  }
  return body;
}
