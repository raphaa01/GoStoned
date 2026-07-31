export type RatingParticipantRow = {
  player_key: string;
  initial_rating: number;
  participant_type: "account" | "bot";
};

export function resolveRatingParticipants(
  participantKeys: readonly [string, string],
  candidateRows: readonly RatingParticipantRow[],
): readonly RatingParticipantRow[] | null {
  const participants = new Set(participantKeys);
  const candidates = new Map(candidateRows.map((row) => [row.player_key, row]));
  if (
    participants.size !== 2
    || candidateRows.length !== 2
    || candidates.size !== 2
    || [...participants].some((playerKey) => !candidates.has(playerKey))
    || candidateRows.some(({ initial_rating: rating }) => (
      !Number.isInteger(rating) || rating < 100 || rating > 3_000
    ))
  ) return null;

  const accounts = candidateRows.filter(({ participant_type: type }) => type === "account").length;
  const bots = candidateRows.filter(({ participant_type: type }) => type === "bot").length;
  if (!((accounts === 2 && bots === 0) || (accounts === 1 && bots === 1))) return null;

  return participantKeys.map((playerKey) => candidates.get(playerKey)!);
}
