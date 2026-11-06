import { NextRequest } from "next/server";
import { apiError, noStoreJson as rawNoStoreJson } from "@/lib/api/responses";
import { readBoundedJsonObject } from "@/lib/api/boundedJson";
import { assertAuthMutationRequest } from "@/lib/auth/credentialRequest";
import { assertExpectedPlayer } from "@/lib/auth/playerBindingServer";
import { requireRequestUser } from "@/lib/auth/requestAuth";
import {
  consumeEphemeralIpPolicyRateLimit,
  consumePolicyRateLimit,
  RATE_LIMIT_POLICIES,
} from "@/lib/auth/rateLimit";
import { GameServiceError } from "@/lib/game/gameServiceError";
import { AuthError } from "@/lib/auth/accountService";
import {
  invalidTournament,
  parseTournamentSettings,
} from "@/lib/tournaments/policy";
import * as tournaments from "@/lib/tournaments/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const noStoreJson = (body: object, init?: ResponseInit) =>
  rawNoStoreJson({ ok: true, ...body }, init);
function routeError(error: unknown) {
  return error instanceof AuthError
    ? rawNoStoreJson(
        { ok: false, error: error.message, code: error.code },
        { status: error.status },
      )
    : apiError(error);
}
function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) invalidTournament();
  return value;
}
function fields(body: Record<string, unknown>, expected: string[]) {
  if (
    Object.keys(body).length !== expected.length ||
    expected.some((k) => !(k in body))
  )
    invalidTournament();
}
async function actor(request: NextRequest, mutation: boolean) {
  consumeEphemeralIpPolicyRateLimit(
    request,
    RATE_LIMIT_POLICIES.protectedIdentityLookup,
  );
  const user = await requireRequestUser(request);
  assertExpectedPlayer(request, user.playerKey);
  await consumePolicyRateLimit(
    request,
    mutation
      ? {
          scope: "tournaments-mutation",
          limit: 40,
          ipLimit: 300,
          windowMinutes: 1,
        }
      : {
          scope: "tournaments-read",
          limit: 180,
          ipLimit: 1800,
          windowMinutes: 1,
        },
    user.playerKey,
  );
  return user;
}
export async function GET(request: NextRequest) {
  try {
    const user = await actor(request, false);
    const params = request.nextUrl.searchParams;
    const view = params.get("view");
    const expected =
      view === "trophies"
        ? ["view", ...(params.has("userId") ? ["userId"] : [])]
        : view === "game" || view === "watch"
          ? ["view", "gameId"]
          : view === "notice"
            ? ["view"]
            : params.has("id")
              ? ["id"]
              : [];
    if (
      [...params.keys()].length !== expected.length ||
      [...params.keys()].some((k) => !expected.includes(k))
    )
      invalidTournament();
    if (view === "notice")
      return noStoreJson({
        notice: await tournaments.getTournamentNotice(user.id),
      });
    if (view === "trophies") {
      const target = params.has("userId")
        ? uuid(params.get("userId"))
        : user.id;
      return noStoreJson({
        trophies: await tournaments.getTrophies(target, target === user.id),
      });
    }
    if (view === "game" || view === "watch")
      return noStoreJson(
        await tournaments.tournamentGame(
          user.id,
          uuid(params.get("gameId")),
          view === "watch",
        ),
      );
    if (view !== null) invalidTournament();
    return noStoreJson(
      params.has("id")
        ? {
            detail: await tournaments.getTournamentDetail(
              user.id,
              uuid(params.get("id")),
            ),
          }
        : { dashboard: await tournaments.getTournamentDashboard(user.id) },
    );
  } catch (error) {
    return routeError(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    assertAuthMutationRequest(request, { requireJson: true });
    if (request.nextUrl.search) invalidTournament();
    const user = await actor(request, true);
    const body = await readBoundedJsonObject(request, {
      maxBytes: 2048,
      maxChunks: 2048,
      idleTimeoutMs: 1000,
      totalTimeoutMs: 2000,
      invalidJson: () =>
        new GameServiceError(
          "Invalid tournament request.",
          400,
          "invalid_tournament_request",
        ),
    });
    const action = body.action;
    if (action === "create") {
      fields(body, [
        "action",
        "name",
        "boardSize",
        "timeControl",
        "maxPlayers",
        "format",
      ]);
      return noStoreJson(
        {
          id: await tournaments.createTournament(
            user.id,
            parseTournamentSettings(body),
          ),
        },
        { status: 201 },
      );
    }
    if (action === "joinCode") {
      fields(body, ["action", "code"]);
      if (
        typeof body.code !== "string" ||
        !/^[A-Z0-9]{10}$/.test(body.code.trim().toUpperCase())
      )
        invalidTournament();
      return noStoreJson({
        id: await tournaments.joinTournament(user.id, {
          code: body.code.trim().toUpperCase(),
        }),
      });
    }
    const id = uuid(body.id);
    switch (action) {
      case "join":
        fields(body, [
          "action",
          "id",
          ...(Object.hasOwn(body, "acceptSchedule") ? ["acceptSchedule"] : []),
        ]);
        if (
          Object.hasOwn(body, "acceptSchedule") &&
          typeof body.acceptSchedule !== "boolean"
        )
          invalidTournament();
        await tournaments.joinTournament(user.id, {
          id,
          acceptSchedule: body.acceptSchedule === true,
        });
        break;
      case "settings":
        fields(body, [
          "action",
          "id",
          "name",
          "boardSize",
          "timeControl",
          "maxPlayers",
          "format",
        ]);
        await tournaments.updateTournament(
          user.id,
          id,
          parseTournamentSettings(body),
        );
        break;
      case "start":
        fields(body, ["action", "id"]);
        await tournaments.startTournament(user.id, id);
        break;
      case "leave":
        fields(body, ["action", "id"]);
        await tournaments.leaveTournament(user.id, id);
        break;
      case "queue":
        fields(body, ["action", "id", "waiting"]);
        if (typeof body.waiting !== "boolean") invalidTournament();
        await tournaments.queueMonthly(user.id, id, body.waiting);
        break;
      case "ready":
        fields(body, ["action", "id", "matchId"]);
        return noStoreJson({
          gameId: await tournaments.readyTournamentMatch(
            user.id,
            id,
            uuid(body.matchId),
          ),
        });
      case "invite":
        fields(body, ["action", "id", "friendId"]);
        await tournaments.inviteTournamentFriend(
          user.id,
          id,
          uuid(body.friendId),
        );
        break;
      case "trophy":
        fields(body, ["action", "id", "displayed"]);
        if (typeof body.displayed !== "boolean") invalidTournament();
        await tournaments.displayTrophy(user.id, id, body.displayed);
        break;
      default:
        invalidTournament();
    }
    return noStoreJson({ ok: true, id });
  } catch (error) {
    return routeError(error);
  }
}
