const PLAYER_KEY_STORAGE = "gostoned.player-key";

export function getOrCreateGuestPlayerKey(): string {
  const existing = window.localStorage.getItem(PLAYER_KEY_STORAGE);
  if (existing?.startsWith("guest:")) return existing;

  const playerKey = `guest:${window.crypto.randomUUID()}`;
  window.localStorage.setItem(PLAYER_KEY_STORAGE, playerKey);
  return playerKey;
}

export function shortPlayerName(playerKey: string): string {
  return playerKey.startsWith("guest:")
    ? `Guest ${playerKey.slice(-6).toUpperCase()}`
    : `Player ${playerKey.slice(-6).toUpperCase()}`;
}
