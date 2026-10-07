"use client";

import { SkipForward } from "lucide-react";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { GameState } from "@/lib/game/types";

export function GamePassNotice({ game }: { game: GameState }) {
  const { dictionary } = useI18n();
  const move = game.moves.at(-1);
  if (game.status !== "active" || !move?.isPass || game.consecutivePasses === 0) return null;
  const color = move.color === "black" ? dictionary.game.black : dictionary.game.white;
  const name = move.color === "black" ? game.blackPlayerName : game.whitePlayerName;
  return <p className="game-pass-notice" key={move.moveNumber} role="status">
    <SkipForward aria-hidden="true" size={17} />
    <span><strong>{name}</strong> · {dictionary.game.passAnnouncement.replace("{color}", color)}</span>
  </p>;
}
