import { readApi } from "./api";

export async function leaveGameAndQueue(gameId: string, playerKey: string): Promise<void> {
  const resignResponse = await fetch(`/api/games/${gameId}/resign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerKey }),
  });

  // A finished game no longer needs a resignation, but its matchmaking entry
  // still has to be removed so the player can start another game.
  if (!resignResponse.ok && resignResponse.status !== 409) {
    await readApi(resignResponse);
  }

  await readApi(
    await fetch(`/api/matchmaking?playerKey=${encodeURIComponent(playerKey)}`, {
      method: "DELETE",
    }),
  );
}
