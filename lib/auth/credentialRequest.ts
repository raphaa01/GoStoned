import type { NextRequest } from "next/server";
import { AuthError, validateCredentials } from "./accountService";

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
      originMatches = new URL(requestOrigin).origin === request.nextUrl.origin;
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
