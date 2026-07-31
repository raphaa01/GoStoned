import { NextRequest } from "next/server";
import { apiError, noStoreJson } from "@/lib/api/responses";
import { AuthError } from "@/lib/auth/accountService";
import { assertAuthMutationRequest } from "@/lib/auth/credentialRequest";
import { assertExpectedPlayer } from "@/lib/auth/playerBindingServer";
import {
  consumeEphemeralIpPolicyRateLimit,
  consumePolicyRateLimit,
  RATE_LIMIT_POLICIES,
} from "@/lib/auth/rateLimit";
import { resolvePlayerKey } from "@/lib/auth/requestAuth";
import { GameServiceError } from "@/lib/game/gameService";
import { isPlayerReportCategory } from "@/lib/moderation/playerReportContract";
import { isPlayerReportingEnabled } from "@/lib/moderation/playerReportGate";
import { reportGameOpponent } from "@/lib/moderation/playerReportService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CANONICAL_GAME_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_REPORT_BODY_BYTES = 256;

function invalidRequest() {
  return new GameServiceError(
    "The report request is invalid.",
    400,
    "invalid_report_request",
  );
}

function assertCanonicalGameId(gameId: string): void {
  if (!CANONICAL_GAME_ID.test(gameId)) {
    throw new GameServiceError("Game not found.", 404, "game_not_found");
  }
}

async function readBoundedCategory(request: NextRequest) {
  if (request.body === null) throw invalidRequest();
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (
      !Number.isSafeInteger(declaredLength)
      || declaredLength < 1
      || declaredLength > MAX_REPORT_BODY_BYTES
    ) {
      throw invalidRequest();
    }
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let body = "";
  let bytesRead = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytesRead += chunk.value.byteLength;
      if (bytesRead > MAX_REPORT_BODY_BYTES) {
        await reader.cancel();
        throw invalidRequest();
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
  } catch (error) {
    if (error instanceof GameServiceError) throw error;
    throw invalidRequest();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw invalidRequest();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw invalidRequest();
  }
  const entries = Object.entries(parsed);
  if (
    entries.length !== 1
    || entries[0][0] !== "category"
    || !isPlayerReportCategory(entries[0][1])
  ) {
    throw invalidRequest();
  }
  return entries[0][1];
}

function routeError(error: unknown) {
  if (error instanceof AuthError) {
    return noStoreJson(
      { ok: false, error: error.message, code: error.code },
      { status: error.status },
    );
  }
  return apiError(error);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ gameId: string }> },
) {
  try {
    if (!isPlayerReportingEnabled()) {
      throw new GameServiceError("Game not found.", 404, "game_not_found");
    }
    assertAuthMutationRequest(request, { requireJson: true });
    if (request.nextUrl.search !== "") throw invalidRequest();
    const { gameId } = await context.params;
    assertCanonicalGameId(gameId);
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    const playerKey = await resolvePlayerKey(request);
    assertExpectedPlayer(request, playerKey);
    await consumePolicyRateLimit(
      request,
      RATE_LIMIT_POLICIES.playerReportBurst,
      playerKey,
    );
    await consumePolicyRateLimit(
      request,
      RATE_LIMIT_POLICIES.playerReportSubmit,
      playerKey,
    );
    const category = await readBoundedCategory(request);
    const receipt = await reportGameOpponent(gameId, playerKey, category);
    return noStoreJson({ ok: true, actor: playerKey, ...receipt });
  } catch (error) {
    return routeError(error);
  }
}
