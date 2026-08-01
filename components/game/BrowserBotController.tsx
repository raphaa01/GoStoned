"use client";

import { useEffect, useRef } from "react";
import { EXPECTED_PLAYER_HEADER } from "@/lib/auth/playerBinding";
import {
  generateBrowserBotMove,
  proposeJapaneseSettlement,
} from "@/lib/bot/browserBotClient";
import { GOSTONE_BOT_MODEL } from "@/lib/bot/modelV1";
import { ApiRequestError, readApi } from "@/lib/client/api";
import type { GameState, Position, Stone } from "@/lib/game/types";

type Props = {
  game: GameState;
  playerKey: string;
  onGame: (game: GameState) => void;
  onError: (error: unknown) => void;
};

function delayFor(gameId: string, version: number): number {
  let hash = 2166136261;
  const seed = `${gameId}:${version}:think`;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return 3_000 + Math.floor(((hash >>> 0) / 0x1_0000_0000) * 6_000);
}

function botColor(game: GameState): Stone | null {
  if (game.blackPlayerIsBot) return "black";
  if (game.whitePlayerIsBot) return "white";
  return null;
}

function botRating(game: GameState, color: Stone): number {
  return Number(color === "black" ? game.blackRating : game.whiteRating) || 1_200;
}

function botConfirmed(game: GameState, color: Stone): boolean {
  if (!game.scoring) return false;
  return color === "black" ? game.scoring.blackConfirmed : game.scoring.whiteConfirmed;
}

function humanConfirmed(game: GameState, color: Stone): boolean {
  if (!game.scoring) return false;
  return color === "black" ? game.scoring.whiteConfirmed : game.scoring.blackConfirmed;
}

async function postBotAction(
  gameId: string,
  playerKey: string,
  body: Record<string, unknown>,
): Promise<GameState> {
  const response = await fetch(`/api/games/${gameId}/browser-bot`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [EXPECTED_PLAYER_HEADER]: playerKey,
    },
    body: JSON.stringify({
      ...body,
      modelVersion: GOSTONE_BOT_MODEL.modelVersion,
      modelSha256: GOSTONE_BOT_MODEL.artifactSha256,
    }),
  });
  const data = await readApi<{ actor: string; game: GameState }>(response);
  if (data.actor !== playerKey) {
    throw new ApiRequestError("The browser bot response belongs to another player.", {
      status: 409,
      code: "identity_changed",
    });
  }
  return data.game;
}

export function BrowserBotController({ game, playerKey, onGame, onError }: Props) {
  const activeAction = useRef<string | null>(null);
  const settlementBoard = useRef<string | null>(null);
  const gameRef = useRef(game);
  const currentBotColor = botColor(game);
  const moveActionKey = currentBotColor
    && game.status === "active"
    && game.phase === "play"
    && game.turn === currentBotColor
    ? `move:${game.id}:${game.version}`
    : null;
  const scoringActionKey = currentBotColor
    && game.status === "active"
    && game.phase === "scoring"
    && game.scoring
    ? humanConfirmed(game, currentBotColor) && !botConfirmed(game, currentBotColor)
      ? `confirm:${game.id}:${game.scoring.revision}`
      : `settlement:${game.id}:${game.scoring.boardHash}:${game.scoring.revision}`
    : null;

  useEffect(() => {
    gameRef.current = game;
  }, [game]);

  useEffect(() => {
    if (!moveActionKey || activeAction.current === moveActionKey) return;
    const snapshot = gameRef.current;
    const color = botColor(snapshot);
    if (!color) return;
    activeAction.current = moveActionKey;
    let cancelled = false;

    void (async () => {
      const startedAt = Date.now();
      const excludedMoves: Position[] = [];
      for (let attempt = 0; attempt < 3 && !cancelled; attempt += 1) {
        const move = await generateBrowserBotMove({
          gameId: snapshot.id,
          boardSize: snapshot.boardSize,
          board: snapshot.board,
          moves: snapshot.moves,
          toMove: color,
          komi: snapshot.komi,
          targetRating: botRating(snapshot, color),
          gameVersion: snapshot.version,
          excludedMoves,
        });
        const remainingDelay = delayFor(snapshot.id, snapshot.version) - (Date.now() - startedAt);
        if (remainingDelay > 0) {
          await new Promise((resolve) => setTimeout(resolve, remainingDelay));
        }
        if (cancelled) return;
        try {
          const updated = await postBotAction(snapshot.id, playerKey, {
            kind: "move",
            expectedVersion: snapshot.version,
            move,
          });
          if (!cancelled) onGame(updated);
          return;
        } catch (error) {
          if (
            move.kind === "play"
            && error instanceof ApiRequestError
            && ["ko", "suicide", "occupied"].includes(error.code ?? "")
          ) {
            excludedMoves.push({ x: move.x, y: move.y });
            continue;
          }
          throw error;
        }
      }
    })().catch((error) => {
      if (!cancelled) {
        activeAction.current = null;
        onError(error);
      }
    });
    return () => {
      cancelled = true;
      if (activeAction.current === moveActionKey) activeAction.current = null;
    };
  }, [moveActionKey, onError, onGame, playerKey]);

  useEffect(() => {
    if (!scoringActionKey || activeAction.current === scoringActionKey) return;
    const snapshot = gameRef.current;
    const color = botColor(snapshot);
    if (!color || !snapshot.scoring) return;
    if (
      scoringActionKey.startsWith("settlement:")
      && settlementBoard.current === snapshot.scoring.boardHash
    ) return;
    let cancelled = false;
    activeAction.current = scoringActionKey;

    if (scoringActionKey.startsWith("settlement:")) {
      void proposeJapaneseSettlement({
          gameId: snapshot.id,
          boardSize: snapshot.boardSize,
          board: snapshot.board,
          moves: snapshot.moves,
          komi: snapshot.komi,
          targetRating: botRating(snapshot, color),
          gameVersion: snapshot.version,
        }).then((proposal) => postBotAction(snapshot.id, playerKey, {
          kind: "settlement",
          expectedRevision: snapshot.scoring!.revision,
          deadStones: proposal.deadStones,
        })).then((updated) => {
          if (cancelled) return;
          settlementBoard.current = snapshot.scoring!.boardHash;
          onGame(updated);
        }).catch((error) => {
          if (!cancelled) {
            activeAction.current = null;
            onError(error);
          }
        });
      return () => {
        cancelled = true;
        if (activeAction.current === scoringActionKey) activeAction.current = null;
      };
    }

    void postBotAction(snapshot.id, playerKey, {
          kind: "confirm",
          expectedRevision: snapshot.scoring.revision,
        }).then((updated) => {
          if (!cancelled) onGame(updated);
        }).catch((error) => {
          if (!cancelled) {
            activeAction.current = null;
            onError(error);
          }
        });
    return () => {
      cancelled = true;
      if (activeAction.current === scoringActionKey) activeAction.current = null;
    };
  }, [onError, onGame, playerKey, scoringActionKey]);

  return null;
}
