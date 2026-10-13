"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { readApi } from "@/lib/client/api";
import type { SharedFinishedGame } from "@/lib/game/sharedGameService";
import { getSharedGameCopy } from "@/lib/i18n/sharedGame";
import { localizedGameResult } from "@/lib/game/gameAccessibility";
import { FinishedGameBoard } from "./FinishedGameBoard";
import styles from "./SharedGameView.module.css";

export function SharedGameView({ token }: { token: string }) {
  return <SharedGameLoader key={token} token={token} />;
}

function SharedGameLoader({ token }: { token: string }) {
  const { dictionary, locale } = useI18n();
  const [game, setGame] = useState<SharedFinishedGame | null>(null);
  const [failed, setFailed] = useState(false);
  const copy = getSharedGameCopy(locale);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/shared-games/${token}`, { cache: "no-store", signal: controller.signal })
      .then((response) => readApi<{ game: SharedFinishedGame }>(response))
      .then(({ game: shared }) => setGame(shared))
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [token]);

  if (!game) {
    return <main className={styles.page}><div className={styles.status}>{failed ? copy.unavailable : copy.loading}</div></main>;
  }

  return (
    <main className={styles.page}>
      <article className={styles.shell}>
        <header className={styles.header}>
          <span className={styles.eyebrow}>{copy.brand} · {copy.eyebrow}</span>
          <h1>{localizedGameResult(game.result, dictionary.game)}</h1>
          <div className={styles.players}>
            <span className={styles.player}><span className={styles.stone} aria-hidden="true" /><span className={styles.name} title={game.blackPlayerName}>{game.blackPlayerName}</span></span>
            <span aria-hidden="true">—</span>
            <span className={styles.player}><span className={`${styles.stone} ${styles.stoneWhite}`} aria-hidden="true" /><span className={styles.name} title={game.whitePlayerName}>{game.whitePlayerName}</span></span>
          </div>
        </header>
        <div className={styles.board}>
          <FinishedGameBoard
            gameId={`shared:${token}`}
            boardSize={game.boardSize}
            board={game.board}
            moves={game.moves}
            deadStones={game.deadStones}
            territory={game.territory}
          />
        </div>
        <footer className={styles.meta}>
          <span>{game.boardSize}×{game.boardSize}</span>
          <span>{dictionary.timeControls[game.timeControl].name}</span>
          <span>{game.moveCount} {copy.moves}</span>
          <time dateTime={game.finishedAt}>{new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(game.finishedAt))}</time>
        </footer>
      </article>
    </main>
  );
}
