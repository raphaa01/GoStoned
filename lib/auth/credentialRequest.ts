import type { NextRequest } from "next/server";
import { AuthError, validateCredentials } from "./accountService";

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost"
    || hostname === "[::1]"
    || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

function exactRequestOrigin(requestOrigin: string): string | null {
  const parsed = new URL(requestOrigin);
  return parsed.username === ""
    && parsed.password === ""
    && parsed.pathname === "/"
    && parsed.search === ""
    && parsed.hash === ""
      ? parsed.origin
      : null;
}

function expectedMutationOrigin(request: NextRequest): string | null {
  const normalized = new URL(request.nextUrl.origin);
  const addressedHost = request.headers.get("host");
  if (normalized.hostname !== "localhost" || !addressedHost) {
    return normalized.origin;
  }

  // Next.js canonicalizes every loopback spelling to localhost in NextURL.
  // The HTTP Host header retains the exact browser authority, so recover only
  // that loopback origin rather than equating distinct local browser origins.
  const addressed = new URL(`${normalized.protocol}//${addressedHost}`);
  return addressed.username === ""
    && addressed.password === ""
    && addressed.pathname === "/"
    && addressed.search === ""
    && addressed.hash === ""
    && isLoopbackHostname(addressed.hostname)
      ? addressed.origin
      : null;
}

export function assertAuthMutationRequest(
  request: NextRequest,
  { requireJson = false }: { requireJson?: boolean } = {},
): void {
  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  const requestOrigin = request.headers.get("origin");
  let originMatches = true;
  if (requestOrigin) {
    try {
      const actualOrigin = exactRequestOrigin(requestOrigin);
      const expectedOrigin = expectedMutationOrigin(request);
      originMatches = actualOrigin !== null
        && expectedOrigin !== null
        && actualOrigin === expectedOrigin;
    } catch {
      originMatches = false;
    }
  }

  if (
    (requireJson && contentType !== "application/json")
    || request.headers.get("sec-fetch-site") === "cross-site"
    || !originMatches
  ) {
    throw new AuthError(
      "The authentication request is not allowed.",
      403,
      "request_rejected",
    );
  }
}

export async function readCredentialRequest(request: NextRequest) {
  assertAuthMutationRequest(request, { requireJson: true });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AuthError("The request body must be valid JSON.", 400, "invalid_request");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AuthError("The request body must be a JSON object.", 400, "invalid_request");
  }
  const input = body as { username?: unknown; password?: unknown };
  return validateCredentials(input.username, input.password);
}
