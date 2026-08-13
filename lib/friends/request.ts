import { readBoundedJsonObject } from "@/lib/api/boundedJson";
import type { NextRequest } from "next/server";
import { GameServiceError } from "@/lib/game/gameServiceError";
import { isTimeControlId } from "@/lib/game/timeControls";
import type { BoardSize, TimeControlId } from "@/lib/game/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function friendRequestError() {
  return new GameServiceError("The friends request is invalid.", 400, "invalid_friends_request");
}

export function assertUuid(value: string): void {
  if (!UUID.test(value)) throw new GameServiceError("Friendship not found.", 404, "friendship_not_found");
}

export async function readFriendJson(request: NextRequest): Promise<Record<string, unknown>> {
  return readBoundedJsonObject(request, {
    maxBytes: 4_096,
    maxChunks: 4_096,
    idleTimeoutMs: 1_000,
    totalTimeoutMs: 2_000,
    invalidJson: friendRequestError,
  });
}

export function exactFields(body: Record<string, unknown>, fields: readonly string[]): void {
  const actual = Object.keys(body).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    throw friendRequestError();
  }
}

export function parsePlayerSearch(request: NextRequest): string {
  const entries = [...request.nextUrl.searchParams.entries()];
  if (entries.length !== 1 || entries[0][0] !== "q") throw friendRequestError();
  const value = entries[0][1].trim();
  if (value.length < 2 || value.length > 20 || !/^[\p{L}\p{N}_-]+$/u.test(value)) {
    throw friendRequestError();
  }
  return value;
}

export function parseMessageCursor(request: NextRequest): number {
  const entries = [...request.nextUrl.searchParams.entries()];
  if (entries.length === 0) return 0;
  if (entries.length !== 1 || entries[0][0] !== "after" || !/^(0|[1-9]\d*)$/.test(entries[0][1])) {
    throw friendRequestError();
  }
  const cursor = Number(entries[0][1]);
  if (!Number.isSafeInteger(cursor)) throw friendRequestError();
  return cursor;
}

export function parseBoardSize(value: unknown): BoardSize {
  if (value !== 9 && value !== 13 && value !== 19) throw friendRequestError();
  return value;
}

export function parseTimeControl(value: unknown): TimeControlId {
  if (!isTimeControlId(value)) throw friendRequestError();
  return value;
}
