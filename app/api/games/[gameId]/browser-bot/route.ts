import { NextRequest } from "next/server";
import { noStoreJson } from "@/lib/api/responses";
import {
  consumeEphemeralIpPolicyRateLimit,
  consumePolicyRateLimit,
  RATE_LIMIT_POLICIES,
} from "@/lib/auth/rateLimit";
import { assertExpectedPlayer } from "@/lib/auth/playerBindingServer";
import { resolvePlayerKey } from "@/lib/auth/requestAuth";
import {
  applyBrowserBotSettlement,
  confirmBrowserBotScore,
  submitBrowserBotMove,
} from "@/lib/bot/browserBotService";
import type { GoStoneBotMove } from "@/lib/bot/modelV1";
import {
  assertGameMutationMetadata,
  gameMutationRouteError,
  invalidGameMutationRequest,
  MAX_SCORING_PROPOSAL_BODY_BYTES,
  readGameMutationJson,
} from "@/lib/game/gameMutationRequest";
import { MAX_PERSISTED_GAME_VERSION } from "@/lib/game/gamePolling";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function validMove(value: unknown): value is GoStoneBotMove {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const move = value as Record<string, unknown>;
  if (move.kind === "pass") return Object.keys(move).length === 1;
  return move.kind === "play"
    && Object.keys(move).length === 3
    && Number.isInteger(move.x)
    && Number.isInteger(move.y);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ gameId: string }> },
) {
  try {
    const { gameId } = await context.params;
    assertGameMutationMetadata(request, gameId, "json");
    consumeEphemeralIpPolicyRateLimit(request, RATE_LIMIT_POLICIES.protectedIdentityLookup);
    const playerKey = await resolvePlayerKey(request);
    assertExpectedPlayer(request, playerKey);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.moveBurst, playerKey);
    await consumePolicyRateLimit(request, RATE_LIMIT_POLICIES.move, playerKey);
    const body = await readGameMutationJson(
      request,
      [
        ["kind", "modelVersion", "modelSha256", "expectedVersion", "move"],
        ["kind", "modelVersion", "modelSha256", "expectedRevision", "suggestion"],
        ["kind", "modelVersion", "modelSha256", "expectedRevision"],
      ],
      MAX_SCORING_PROPOSAL_BODY_BYTES,
    );

    let game;
    if (body.kind === "move") {
      if (
        !Number.isSafeInteger(body.expectedVersion)
        || Number(body.expectedVersion) < 0
        || Number(body.expectedVersion) > MAX_PERSISTED_GAME_VERSION
        || !validMove(body.move)
      ) throw invalidGameMutationRequest();
      game = await submitBrowserBotMove({
        gameId,
        humanPlayerKey: playerKey,
        modelVersion: body.modelVersion,
        modelSha256: body.modelSha256,
        expectedVersion: Number(body.expectedVersion),
        move: body.move,
      });
    } else if (body.kind === "settlement") {
      if (!Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 1) {
        throw invalidGameMutationRequest();
      }
      game = await applyBrowserBotSettlement({
        gameId,
        humanPlayerKey: playerKey,
        modelVersion: body.modelVersion,
        modelSha256: body.modelSha256,
        expectedRevision: Number(body.expectedRevision),
        suggestion: body.suggestion,
      });
    } else if (body.kind === "confirm") {
      if (!Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 1) {
        throw invalidGameMutationRequest();
      }
      game = await confirmBrowserBotScore({
        gameId,
        humanPlayerKey: playerKey,
        modelVersion: body.modelVersion,
        modelSha256: body.modelSha256,
        expectedRevision: Number(body.expectedRevision),
      });
    } else {
      throw invalidGameMutationRequest();
    }
    return noStoreJson({ ok: true, actor: playerKey, game });
  } catch (error) {
    return gameMutationRouteError(error);
  }
}
