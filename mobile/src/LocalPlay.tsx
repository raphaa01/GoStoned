import { ArrowLeft, Check, ChevronRight, Clock3, Flag } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { BoardPreview } from "@/components/game/BoardPreview";
import { BoardSizeSelector } from "@/components/game/BoardSizeSelector";
import { GoBoard } from "@/components/game/GoBoard";
import { TimeControlSelector } from "@/components/game/TimeControlSelector";
import { useI18n } from "@/components/i18n/I18nProvider";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { ModalDialog } from "@/components/ui/ModalDialog";
import { readApi } from "@/lib/client/api";
import { localizedGameResult } from "@/lib/game/gameAccessibility";
import { getGroup } from "@/lib/game/goEngine";
import { checkLocalGameTime, createLocalGame, localWinner, playLocalTurn, resignLocalGame, resumeLocalGame } from "@/lib/game/localGame";
import { formatLocalClock, localClockReading, type LocalClock } from "@/lib/game/localClock";
import type { LocalSettlement } from "@/lib/game/localSettlement";
import type { BoardSize, Position, Stone, TimeControlId } from "@/lib/game/types";
import { getLocalPlayCopy } from "@/lib/i18n/localPlay";
import { getTimeControl } from "@/lib/game/timeControls";
import { useNativeBack } from "./useNativeBack";

export function LocalPlayEntry() {
  const { href, locale } = useI18n();
  return <Link className="local-play-entry" href={href("/play/local")}>
    <span aria-hidden="true" className="local-two-stones"><i /><i /></span>
    <strong>{getLocalPlayCopy(locale).title}</strong><ChevronRight aria-hidden="true" size={19} />
  </Link>;
}

export function LocalPlay() {
  const { dictionary, href, locale } = useI18n();
  const copy = getLocalPlayCopy(locale);
  const [boardSize, setBoardSize] = useState<BoardSize>(9);
  const [timeControl, setTimeControl] = useState<TimeControlId>("blitz");
  const [started, setStarted] = useState(false);
  const [round, setRound] = useState(0);
  if (started) return <LocalGameView key={round} boardSize={boardSize} timeControl={timeControl}
    onAgain={() => setRound((current) => current + 1)} onExit={() => setStarted(false)} />;
  return <main className="local-play-screen local-play-setup" id="main-content">
    <Link className="local-back" href={href("/play")}><ArrowLeft aria-hidden="true" size={20} />{copy.back}</Link>
    <header><h1>{copy.title}</h1><p>{copy.subtitle}</p></header>
    <BoardPreview boardSize={boardSize} />
    <section aria-label={dictionary.play.boardSize}><h2>{dictionary.play.boardSize}</h2>
      <BoardSizeSelector value={boardSize} onChange={setBoardSize} />
    </section>
    <section><h2>{dictionary.play.timeControl}</h2><TimeControlSelector value={timeControl} onChange={setTimeControl} /></section>
    <button className="button button--primary local-start" onClick={() => setStarted(true)} type="button">{copy.start}</button>
    <Link className="local-clock-entry" href={href("/play/clock")}><Clock3 aria-hidden="true" size={20} />{copy.clock}<ChevronRight aria-hidden="true" size={18} /></Link>
  </main>;
}

function LocalGameView({ boardSize, timeControl, onAgain, onExit }: {
  boardSize: BoardSize; timeControl: TimeControlId; onAgain: () => void; onExit: () => void;
}) {
  const { dictionary, locale } = useI18n();
  const copy = getLocalPlayCopy(locale);
  const gameCopy = dictionary.game;
  const [game, setGame] = useState(() => createLocalGame(boardSize, timeControl, Date.now()));
  const [dead, setDead] = useState<Position[]>([]);
  const [neutral, setNeutral] = useState<Position[]>([]);
  const [marking, setMarking] = useState<"dead" | "neutral">("dead");
  const [agreement, setAgreement] = useState({ black: false, white: false });
  const [settlement, setSettlement] = useState<LocalSettlement | null>(null);
  const [completedRequest, setCompletedRequest] = useState<string | null>(null);
  const [scoreError, setScoreError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [confirm, setConfirm] = useState<"exit" | "resign" | null>(null);
  const [resultVisible, setResultVisible] = useState(true);
  const resultTitle = useId();
  const resultDescription = useId();
  const requestKey = JSON.stringify([game.moves.length, dead, neutral, agreement, retry]);
  const busy = game.phase === "scoring" && completedRequest !== requestKey;
  useNativeBack(() => {
    if (confirm) setConfirm(null);
    else if (game.phase === "finished") onExit();
    else setConfirm("exit");
  });

  useEffect(() => {
    const tick = () => {
      const time = Date.now();
      setGame((current) => checkLocalGameTime(current, time));
    };
    const timer = window.setInterval(tick, 100);
    window.addEventListener("pageshow", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pageshow", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  useEffect(() => {
    if (game.phase !== "scoring") return;
    const controller = new AbortController();
    let cancelled = false;
    void (async () => {
      const response = await fetch("/api/local-game/score", {
        method: "POST", headers: { "Content-Type": "application/json" },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
        body: JSON.stringify({ boardSize, moves: game.moves.map((move) => move.isPass ? null : { x: move.x, y: move.y }),
          deadStones: dead, neutralRegionSeeds: neutral, blackAgreed: agreement.black, whiteAgreed: agreement.white }),
      });
      const data = await readApi<{ result: LocalSettlement; finalized: boolean }>(response);
      if (cancelled) return;
      setSettlement(data.result);
      setScoreError(false);
      if (data.finalized) {
        const outcome = data.result.score.outcome;
        const result = outcome.kind === "jigo" ? "Draw" : `${outcome.winner === "black" ? "B" : "W"}+${outcome.margin}`;
        setGame((current) => ({ ...current, phase: "finished", result }));
      }
    })().catch(() => { if (!cancelled) setScoreError(true); })
      .finally(() => { if (!cancelled) setCompletedRequest(requestKey); });
    return () => { cancelled = true; controller.abort(); };
  }, [agreement, boardSize, dead, game.moves, game.phase, neutral, requestKey]);

  useEffect(() => {
    if (game.phase === "finished") return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [game.phase]);

  function mark(x: number, y: number) {
    if (busy || game.phase !== "scoring") return;
    const key = (p: Position) => `${p.x}:${p.y}`;
    if (marking === "neutral") {
      if (game.board[y][x] && !dead.some((p) => p.x === x && p.y === y)) return;
      setNeutral((current) => current.some((p) => p.x === x && p.y === y)
        ? current.filter((p) => p.x !== x || p.y !== y) : [...current, { x, y }]);
    } else {
      const group = getGroup(game.board, { x, y });
      if (!group.length) return;
      const keys = new Set(group.map(key));
      const removing = group.every((p) => dead.some((d) => key(d) === key(p)));
      setDead((current) => removing ? current.filter((p) => !keys.has(key(p))) : [...current.filter((p) => !keys.has(key(p))), ...group]);
      setNeutral([]);
    }
    setAgreement({ black: false, white: false });
    setSettlement(null);
  }

  const colorName = (color: Stone) => color === "black" ? gameCopy.black : gameCopy.white;
  const winner = localWinner(game.result);
  const title = winner ? `${colorName(winner)} ${copy.wins}` : gameCopy.draw;
  const error = game.error === "move_limit" ? copy.moveLimit
    : game.error ? dictionary.apiErrors[game.error as keyof typeof dictionary.apiErrors] ?? gameCopy.moveFailed : null;
  const territory = settlement ? { black: settlement.blackTerritory, white: settlement.whiteTerritory } : undefined;

  return <main className="local-play-screen local-game-screen" id="main-content">
    <header className="local-game-header">
      <button aria-label={copy.back} className="local-icon-button" onClick={() => game.phase === "finished" ? onExit() : setConfirm("exit")} type="button"><ArrowLeft aria-hidden="true" size={22} /></button>
      <span>{copy.title}</span><small>{copy.subtitle}</small>
    </header>
    <LocalPlayerClocks clock={game.clock} />
    <div className="local-turn" role="status">{game.phase === "play" ? `${colorName(game.clock.turn)} ${copy.toPlay}` : game.phase === "scoring" ? gameCopy.scoring : title}</div>
    <div className="local-game-board"><GoBoard boardSize={boardSize} boardState={game.board}
      onIntersectionClick={(x, y) => game.phase === "scoring" ? mark(x, y) : setGame((current) => playLocalTurn(current, { x, y }, Date.now()))}
      disabled={game.phase === "finished" || busy || Boolean(confirm)} previewColor={game.clock.turn}
      interactionMode={game.phase === "scoring" && marking === "dead" ? "mark-dead" : "play"}
      deadStones={dead} markedIntersections={neutral} territory={game.phase === "play" ? undefined : territory}
      lastMove={game.moves.at(-1)?.isPass ? null : game.moves.at(-1) as Position | undefined}
      precisionRevision={`local:${game.moves.length}:${game.phase}:${marking}:${dead.length}:${neutral.length}`} />
    </div>
    {error ? <p className="local-error" role="alert">{error}</p> : null}
    {game.phase === "play" ? <div className="local-game-actions">
      <button className="button button--secondary" onClick={() => setGame((current) => playLocalTurn(current, null, Date.now()))} type="button">{gameCopy.pass}</button>
      <button className="local-resign" onClick={() => setConfirm("resign")} type="button"><Flag aria-hidden="true" size={17} />{gameCopy.resign}</button>
    </div> : null}
    {game.phase === "scoring" ? <section className="local-scoring" aria-busy={busy}>
      <p>{copy.scoringHint}</p>
      <div className="local-mark-options">
        <button aria-pressed={marking === "dead"} onClick={() => setMarking("dead")} type="button">{copy.dead}</button>
        <button aria-pressed={marking === "neutral"} onClick={() => setMarking("neutral")} type="button">{copy.neutral}</button>
      </div>
      {settlement ? <div className="local-score"><span>{gameCopy.black}<strong>{settlement.score.blackTotal}</strong></span><span>{gameCopy.white}<strong>{settlement.score.whiteTotal}</strong></span></div> : null}
      {scoreError ? <div className="local-error" role="alert"><p>{copy.scoringFailed}</p><button className="button button--secondary" onClick={() => setRetry((value) => value + 1)} type="button">{copy.retry}</button></div> : null}
      <div className="local-confirmations">{(["black", "white"] as const).map((color) => <button className="button button--primary" disabled={busy || scoreError || !settlement || agreement[color]}
        key={color} onClick={() => setAgreement((current) => ({ ...current, [color]: true }))} type="button">
        {agreement[color] ? <Check aria-hidden="true" size={17} /> : <span className={`player-stone player-stone--${color}`} />}
        {color === "black" ? copy.confirmBlack : copy.confirmWhite}
      </button>)}</div>
      <button className="local-text-button" onClick={() => {
        setAgreement({ black: false, white: false }); setDead([]); setNeutral([]); setSettlement(null);
        setGame((current) => resumeLocalGame(current, Date.now()));
      }} type="button">{copy.resume}</button>
    </section> : null}
    {game.phase === "finished" ? <button className="button button--primary local-start" onClick={onAgain} type="button">{copy.newGame}</button> : null}
    <ConfirmModal open={confirm !== null} title={confirm === "resign" ? copy.resignTitle : copy.exitTitle}
      description={confirm === "resign" ? copy.resignDescription : copy.exitDescription}
      confirmLabel={confirm === "resign" ? gameCopy.resign : copy.exit} onCancel={() => setConfirm(null)}
      onConfirm={() => {
        if (confirm === "resign") { setGame((current) => resignLocalGame(current, Date.now())); setConfirm(null); }
        else { onExit(); }
      }} />
    <ModalDialog className="result-modal local-result-modal" open={game.phase === "finished" && resultVisible}
      titleId={resultTitle} descriptionId={resultDescription} onDismiss={() => setResultVisible(false)}>
      <div className="result-modal-header"><div><h2 id={resultTitle}>{title}</h2><p id={resultDescription}>{localizedGameResult(game.result, gameCopy)}</p></div></div>
      <div className="result-player-list">{(["black", "white"] as const).map((color) => <div key={color} className={winner === color ? "is-winner" : ""}>
        <span className={`player-stone player-stone--${color}`} /><strong>{colorName(color)}</strong>{winner === color ? <b>{gameCopy.winner}</b> : null}
      </div>)}</div>
      {settlement ? <div className="local-score"><span>{gameCopy.black}<strong>{settlement.score.blackTotal}</strong></span><span>{gameCopy.white}<strong>{settlement.score.whiteTotal}</strong></span></div> : null}
      <button className="button button--primary local-start" onClick={onAgain} type="button">{copy.newGame}</button>
      <div className="result-secondary-actions"><button onClick={() => setResultVisible(false)} type="button">{gameCopy.viewBoard}</button><button onClick={onExit} type="button">{copy.back}</button></div>
    </ModalDialog>
  </main>;
}

function LocalPlayerClocks({ clock }: { clock: LocalClock }) {
  const { dictionary } = useI18n();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = window.setInterval(tick, 100);
    document.addEventListener("visibilitychange", tick);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, []);
  return <div className="local-player-clocks">{(["black", "white"] as const).map((color) => {
    const reading = localClockReading(clock, color, now);
    return <div className={clock.running && clock.turn === color ? "is-active" : ""} key={color}>
      <span className={`player-stone player-stone--${color}`} /><span>{color === "black" ? dictionary.game.black : dictionary.game.white}</span>
      <strong>{formatLocalClock(reading.displayTimeMs)}</strong>
      <small>{reading.periodsRemaining} × {getTimeControl(clock.control).byoYomiSeconds}s</small>
    </div>;
  })}</div>;
}
