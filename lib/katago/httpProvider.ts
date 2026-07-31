import type {
  CanonicalKataGoScoringRequest,
  KataGoProviderKind,
  KataGoScoringProvider,
} from "./contracts";
import { kataGoError, KataGoScoringError, normalizeKataGoError } from "./errors";

const SCORING_PATH = "/v1/scoring-proposal";
const DEFAULT_MAX_RESPONSE_BYTES = 1_000_000;

type FetchImplementation = typeof fetch;

type HttpProviderOptions = Readonly<{
  baseUrl: string;
  token?: string;
  fetchImplementation?: FetchImplementation;
  maxResponseBytes?: number;
}>;

function cleanBaseUrl(value: string, kind: KataGoProviderKind): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw kataGoError("provider_not_configured", "The KataGo provider URL is invalid.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw kataGoError(
      "provider_not_configured",
      "The KataGo provider URL may not contain credentials, query parameters, or fragments.",
    );
  }
  if (url.pathname !== "/") {
    throw kataGoError("provider_not_configured", "The KataGo provider URL must be an origin only.");
  }
  if (kind === "hosted-http" && url.protocol !== "https:") {
    throw kataGoError("provider_not_configured", "Hosted KataGo requires HTTPS.");
  }
  if (kind === "local-http") {
    const host = url.hostname.toLowerCase();
    if (
      (url.protocol !== "http:" && url.protocol !== "https:")
      || (host !== "localhost" && host !== "127.0.0.1" && host !== "[::1]" && host !== "::1")
    ) {
      throw kataGoError(
        "provider_not_configured",
        "Local KataGo must use an HTTP(S) loopback origin.",
      );
    }
  }
  return url.origin;
}

function cleanToken(token: string | undefined): string | undefined {
  if (token === undefined) return undefined;
  if (token.length < 1 || token.length > 4_096 || /[\r\n]/.test(token)) {
    throw kataGoError("provider_not_configured", "The KataGo provider token is invalid.");
  }
  return token;
}

async function readBoundedBody(response: Response, maximumBytes: number): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > maximumBytes) {
      throw kataGoError("response_too_large", "The KataGo provider response exceeded its size limit.");
    }
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let body = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel();
        throw kataGoError("response_too_large", "The KataGo provider response exceeded its size limit.");
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
    return body;
  } catch (error) {
    if (error instanceof TypeError) {
      throw kataGoError("invalid_response_json", "The KataGo provider response was not valid UTF-8.", {
        cause: error,
      });
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}

class HttpKataGoScoringProvider implements KataGoScoringProvider {
  readonly kind: "hosted-http" | "local-http";
  private readonly baseUrl: string;
  private readonly token: string | undefined;
  private readonly fetchImplementation: FetchImplementation;
  private readonly maxResponseBytes: number;

  constructor(kind: "hosted-http" | "local-http", options: HttpProviderOptions) {
    this.kind = kind;
    this.baseUrl = cleanBaseUrl(options.baseUrl, kind);
    this.token = cleanToken(options.token);
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 5_000_000) {
      throw kataGoError(
        "provider_not_configured",
        "The KataGo response-size bound must be from 1 through 5000000 bytes.",
      );
    }
    this.maxResponseBytes = maxResponseBytes;
  }

  async analyze(
    request: CanonicalKataGoScoringRequest,
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImplementation(`${this.baseUrl}${SCORING_PATH}`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: JSON.stringify(request),
        cache: "no-store",
        redirect: "error",
        signal: options.signal,
      });
    } catch (error) {
      if (options.signal.aborted) {
        throw kataGoError("request_aborted", "KataGo scoring was cancelled.", { cause: error });
      }
      throw kataGoError(
        "provider_unavailable",
        "The KataGo provider could not be reached.",
        { retryable: true, cause: error },
      );
    }
    if (!response.ok) {
      throw kataGoError(
        "provider_http_error",
        `The KataGo provider returned HTTP ${response.status}.`,
        { retryable: response.status === 408 || response.status === 429 || response.status >= 500 },
      );
    }
    const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (contentType !== "application/json") {
      throw kataGoError("invalid_response", "The KataGo provider response must be application/json.");
    }
    let body: string;
    try {
      body = await readBoundedBody(response, this.maxResponseBytes);
    } catch (error) {
      if (error instanceof KataGoScoringError) throw error;
      if (options.signal.aborted) {
        throw kataGoError("request_aborted", "KataGo scoring was cancelled.", { cause: error });
      }
      throw normalizeKataGoError(error);
    }
    try {
      return JSON.parse(body) as unknown;
    } catch (error) {
      throw kataGoError(
        "invalid_response_json",
        "The KataGo provider response was not valid JSON.",
        { cause: error },
      );
    }
  }
}

export class HostedKataGoHttpProvider extends HttpKataGoScoringProvider {
  constructor(options: HttpProviderOptions) {
    super("hosted-http", options);
  }
}

export class LocalKataGoHttpProvider extends HttpKataGoScoringProvider {
  constructor(options: Omit<HttpProviderOptions, "token">) {
    super("local-http", options);
  }
}

export function hostedKataGoProviderFromEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  fetchImplementation?: FetchImplementation,
): HostedKataGoHttpProvider {
  const baseUrl = environment.KATAGO_HOSTED_URL;
  const token = environment.KATAGO_HOSTED_TOKEN;
  if (!baseUrl || !token) {
    throw kataGoError(
      "provider_not_configured",
      "Hosted KataGo environment variables are not configured.",
    );
  }
  return new HostedKataGoHttpProvider({ baseUrl, token, fetchImplementation });
}

export function localKataGoProviderFromEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  fetchImplementation?: FetchImplementation,
): LocalKataGoHttpProvider {
  const baseUrl = environment.KATAGO_LOCAL_URL;
  if (!baseUrl) {
    throw kataGoError("provider_not_configured", "Local KataGo environment variables are not configured.");
  }
  return new LocalKataGoHttpProvider({ baseUrl, fetchImplementation });
}
