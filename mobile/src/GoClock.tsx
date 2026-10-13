import { ArrowLeft, Pause, Play, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { TimeControlSelector } from "@/components/game/TimeControlSelector";
import { useI18n } from "@/components/i18n/I18nProvider";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { createLocalClock, expireLocalClock, formatLocalClock, localClockReading, pauseLocalClock, resumeLocalClock, switchLocalClock } from "@/lib/game/localClock";
import { getTimeControl } from "@/lib/game/timeControls";
import type { Stone, TimeControlId } from "@/lib/game/types";
import { getLocalPlayCopy } from "@/lib/i18n/localPlay";
import { setNativeGoClockActive } from "./nativeGoClock";
import { useNativeBack } from "./useNativeBack";

export function GoClock() {
  const { dictionary, href, locale } = useI18n();
  const copy = getLocalPlayCopy(locale);
  const [control, setControl] = useState<TimeControlId>("blitz");
  const [started, setStarted] = useState(false);
  if (started) return <ClockFace control={control} onExit={() => setStarted(false)} />;
  return <main className="local-play-screen local-clock-setup" id="main-content">
    <Link className="local-back" href={href("/play/local")}><ArrowLeft aria-hidden="true" size={20} />{copy.back}</Link>
    <header><h1>{copy.clock}</h1></header>
    <section><h2>{dictionary.play.timeControl}</h2><TimeControlSelector value={control} onChange={setControl} /></section>
    <button className="button button--primary local-start" onClick={() => setStarted(true)} type="button">{copy.startClock}</button>
  </main>;
}

function ClockFace({ control, onExit }: { control: TimeControlId; onExit: () => void }) {
  const { dictionary, locale } = useI18n();
  const copy = getLocalPlayCopy(locale);
  const [clock, setClock] = useState(() => createLocalClock(control, Date.now()));
  const [now, setNow] = useState(Date.now);
  const [confirm, setConfirm] = useState<"reset" | "exit" | null>(null);
  useNativeBack(() => {
    if (confirm) setConfirm(null);
    else if (!clock.started || clock.winner) onExit();
    else { setClock((value) => pauseLocalClock(value, Date.now())); setConfirm("exit"); }
  });

  useEffect(() => {
    const tick = () => { const time = Date.now(); setNow(time); setClock((current) => expireLocalClock(current, time)); };
    const timer = window.setInterval(tick, 100);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("pageshow", tick);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.dataset.goClock = "true";
    void setNativeGoClockActive(true).catch(() => undefined);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("pageshow", tick);
      document.body.style.overflow = overflow;
      delete document.documentElement.dataset.goClock;
      void setNativeGoClockActive(false).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    if (!clock.running || !navigator.wakeLock) return;
    let disposed = false;
    let lock: WakeLockSentinel | undefined;
    const acquire = async () => {
      if (document.hidden || disposed) return;
      try {
        const next = await navigator.wakeLock.request("screen");
        if (disposed) await next.release();
        else { await lock?.release(); lock = next; }
      } catch { /* Some WebViews do not support screen wake locks. */ }
    };
    void acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => { disposed = true; document.removeEventListener("visibilitychange", acquire); void lock?.release(); };
  }, [clock.running]);

  const colorName = (color: Stone) => color === "black" ? dictionary.game.black : dictionary.game.white;
  const current = localClockReading(clock, clock.turn, now);
  const winner = clock.winner;
  const paused = clock.started && !clock.running && !winner;
  return <>
    <main className={`go-clock-face go-clock-face--${winner ?? clock.turn}${paused ? " is-paused" : ""}`} id="main-content">
      <button className="go-clock-tap" disabled={Boolean(winner) || paused || Boolean(confirm)}
        aria-label={!clock.started ? copy.tapStart : copy.tapSwitch}
        onClick={() => setClock((value) => switchLocalClock(value, Date.now()))} type="button">
        <div className="go-clock-totals">{(["black", "white"] as const).map((color) => {
          const reading = localClockReading(clock, color, now);
          return <div key={color} className={clock.turn === color ? "is-active" : ""}>
            <span className={`player-stone player-stone--${color}`} /><span>{colorName(color)}</span>
            <strong>{formatLocalClock(reading.displayTimeMs)}</strong>
            <small>{reading.periodsRemaining} × {getTimeControl(control).byoYomiSeconds}s</small>
          </div>;
        })}</div>
        <div className="go-clock-current">
          <span className="go-clock-color"><span className={`player-stone player-stone--${winner ?? clock.turn}`} />{colorName(winner ?? clock.turn)} {winner ? copy.wins : copy.toPlay}</span>
          <strong>{formatLocalClock(current.displayTimeMs)}</strong>
          <span className="go-clock-instruction">{winner ? dictionary.game.winsTime : paused ? copy.paused : !clock.started ? copy.tapStart : copy.tapSwitch}</span>
        </div>
      </button>
      <div className="go-clock-controls">
        <button aria-label={copy.back} onClick={() => {
          if (!clock.started || winner) onExit();
          else { setClock((value) => pauseLocalClock(value, Date.now())); setConfirm("exit"); }
        }} type="button"><ArrowLeft aria-hidden="true" size={20} />{copy.back}</button>
        <button disabled={Boolean(winner) || !clock.started} onClick={() => setClock((value) => value.running ? pauseLocalClock(value, Date.now()) : resumeLocalClock(value, Date.now()))} type="button">
          {clock.running ? <Pause aria-hidden="true" size={20} /> : <Play aria-hidden="true" size={20} />}{clock.running ? copy.pause : copy.resume}
        </button>
        <button onClick={() => { setClock((value) => pauseLocalClock(value, Date.now())); setConfirm("reset"); }} type="button"><RotateCcw aria-hidden="true" size={19} />{copy.reset}</button>
      </div>
      <span className="sr-only" role="status">{winner ? `${colorName(winner)} ${copy.wins}` : paused ? copy.paused : `${colorName(clock.turn)} ${copy.toPlay}`}</span>
    </main>
    <ConfirmModal open={confirm !== null} title={confirm === "reset" ? copy.resetTitle : copy.exitTitle}
      description={confirm === "reset" ? copy.resetDescription : copy.exitDescription}
      confirmLabel={confirm === "reset" ? copy.reset : copy.back} onCancel={() => setConfirm(null)}
      onConfirm={() => { if (confirm === "reset") { setClock(createLocalClock(control, Date.now())); setConfirm(null); } else onExit(); }} />
  </>;
}
