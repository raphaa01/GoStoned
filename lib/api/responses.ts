import { NextResponse } from "next/server";
import { GameServiceError } from "@/lib/game/gameService";

export function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}

export function apiError(error: unknown) {
  if (error instanceof GameServiceError) {
    return noStoreJson(
      { ok: false, error: error.message, code: error.code },
      { status: error.status },
    );
  }
  console.error("API request failed:", error);
  return noStoreJson(
    { ok: false, error: "The service is temporarily unavailable.", code: "internal_error" },
    { status: 500 },
  );
}
