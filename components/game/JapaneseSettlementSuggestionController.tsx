"use client";

import { useEffect, useRef } from "react";
import { EXPECTED_PLAYER_HEADER } from "@/lib/auth/playerBinding";
import { proposeBrowserJapaneseSettlement } from "@/lib/bot/browserJapaneseSettlementProvider";
import { ApiRequestError, readApi } from "@/lib/client/api";
import type { GameState } from "@/lib/game/types";

type Props = {
  game: GameState;
  playerKey: string;
  onGame: (game: GameState) => void;
};

function isDesignatedRequester(game: GameState, playerKey: string): boolean {
  const blackHuman = !game.blackPlayerIsBot;
  const expected = blackHuman ? game.blackPlayerKey : game.whitePlayerKey;
  return playerKey === expected;
}

export function JapaneseSettlementSuggestionController({ game, playerKey, onGame }: Props) {
  const attempted = useRef(new Set<string>());
  const scoring = game.scoring;
  // Attempt at most once per immutable pass-pass boundary. A manual edit makes
  // an in-flight response stale; it must not trigger another model run.
  const key = scoring
    ? `${game.id}:${scoring.boardHash}:${scoring.stoppedMoveNumber}`
    : null;

  useEffect(() => {
    if (!key || !scoring
      || game.status !== "active"
      || game.phase !== "scoring"
      || game.ruleset !== "japanese"
      || scoring.suggestion?.status !== "not-requested"
      || !isDesignatedRequester(game, playerKey)
      || attempted.current.has(key)) return;
    attempted.current.add(key);
    let cancelled = false;
    void proposeBrowserJapaneseSettlement(game)
      .then(async (suggestion) => {
        const response = await fetch(`/api/games/${game.id}/scoring/suggestion`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [EXPECTED_PLAYER_HEADER]: playerKey,
          },
          body: JSON.stringify({ expectedRevision: scoring.revision, suggestion }),
        });
        return readApi<{ actor: string; game: GameState }>(response);
      })
      .then((data) => {
        if (!cancelled && data.actor === playerKey) onGame(data.game);
      })
      .catch((error) => {
        // The manual scoring flow remains immediately usable. Stale/racing
        // proposals are expected when both game clients refresh together.
        if (error instanceof ApiRequestError
          && ["suggestion_already_applied", "scoring_revision_conflict"].includes(error.code ?? "")) {
          return;
        }
      });
    return () => { cancelled = true; };
  }, [game, key, onGame, playerKey, scoring]);

  return null;
}
