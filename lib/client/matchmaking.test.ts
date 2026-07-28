import assert from "node:assert/strict";
import test from "node:test";
import { applyMatchmakingQueueState } from "./matchmaking";

test("an active match returned by cancellation enters that game", () => {
  const events: string[] = [];
  applyMatchmakingQueueState({
    status: "matched",
    gameId: "22222222-2222-4222-8222-222222222222",
    boardSize: 13,
    timeControl: "classic",
  }, true, {
    enterGame: (gameId) => events.push(`enter:${gameId}`),
    selectBoardSize: (boardSize) => events.push(`board:${boardSize}`),
    selectTimeControl: (timeControl) => events.push(`clock:${timeControl}`),
    setActiveGame: () => events.push("active"),
    setQueueStatus: (status) => events.push(`queue:${status}`),
  });

  assert.deepEqual(events, [
    "board:13",
    "clock:classic",
    "enter:22222222-2222-4222-8222-222222222222",
  ]);
});

test("waiting and idle responses clear stale active-game state", () => {
  for (const status of ["waiting", "idle"] as const) {
    let activeGame: object | null = {};
    let queueStatus: "idle" | "waiting" = status === "waiting" ? "idle" : "waiting";
    applyMatchmakingQueueState({
      status,
      gameId: null,
      boardSize: status === "waiting" ? 9 : null,
      timeControl: status === "waiting" ? "rapid" : null,
    }, true, {
      enterGame: () => assert.fail("non-matched state must not navigate"),
      selectBoardSize: () => {},
      selectTimeControl: () => {},
      setActiveGame: (game) => { activeGame = game; },
      setQueueStatus: (nextStatus) => { queueStatus = nextStatus; },
    });
    assert.equal(activeGame, null);
    assert.equal(queueStatus, status);
  }
});
