import type { RecentGame } from "./statsService";

export type RecentGameRatingPresentation =
  | { kind: "unrated" }
  | { kind: "rated" }
  | { kind: "change"; value: number };

export function getRecentGameRatingPresentation(
  game: Pick<RecentGame, "rated" | "ratingChange">,
): RecentGameRatingPresentation {
  if (!game.rated) return { kind: "unrated" };
  if (game.ratingChange === null) return { kind: "rated" };
  return { kind: "change", value: game.ratingChange };
}
