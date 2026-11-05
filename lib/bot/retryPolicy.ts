import { ApiRequestError } from "@/lib/client/api";

export function browserBotRetryDelay(
  error: unknown,
  attempt: number,
): number | null {
  if (error instanceof ApiRequestError) {
    if (
      [401, 403, 404].includes(error.status) ||
      [
        "identity_changed",
        "bot_model_mismatch",
        "bot_not_found",
        "game_finished",
      ].includes(error.code ?? "")
    )
      return null;
    if (error.status === 429)
      return Math.max(2000, (error.retryAfterSeconds ?? 10) * 1000);
    if (error.status >= 400 && error.status < 500 && error.status !== 409)
      return null;
  }
  return Math.min(15_000, 1000 * 2 ** Math.min(attempt, 4));
}
