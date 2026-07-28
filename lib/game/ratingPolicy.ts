export type RegisteredPlayerRow = {
  player_key: string;
};

export function hasExactlyRegisteredParticipants(
  participantKeys: readonly [string, string],
  registeredRows: readonly RegisteredPlayerRow[],
): boolean {
  const participants = new Set(participantKeys);
  const registered = new Set(registeredRows.map(({ player_key }) => player_key));
  return participants.size === 2
    && registeredRows.length === 2
    && registered.size === 2
    && [...participants].every((playerKey) => registered.has(playerKey));
}
