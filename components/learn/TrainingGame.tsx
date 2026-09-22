"use client";

import { ArrowLeft, Clock3, Flag, RotateCcw, SkipForward } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePlayerIdentity } from "@/components/auth/PlayerIdentityProvider";
import { GoBoard } from "@/components/game/GoBoard";
import { BoardSizeSelector } from "@/components/game/BoardSizeSelector";
import { useI18n } from "@/components/i18n/I18nProvider";
import { EXPECTED_PLAYER_HEADER } from "@/lib/auth/playerBinding";
import {
  generateBrowserBotMove,
  proposeJapaneseSettlement,
} from "@/lib/bot/browserBotClient";
import {
  GOSTONE_BOT_MODEL,
  type GoStoneBotMove,
  type GoStoneJapaneseSettlementProposal,
} from "@/lib/bot/modelV1";
import { readApi } from "@/lib/client/api";
import { advanceClock, type ClockAdvance } from "@/lib/game/goClock";
import type { JapaneseTerritoryScore } from "@/lib/game/japaneseScoring";
import { getTimeControl, TIME_CONTROLS } from "@/lib/game/timeControls";
import type { BoardSize, Position, Stone, TimeControlId } from "@/lib/game/types";
import {
  applyTrainingAction,
  createTrainingPosition,
  kyuToBotRating,
  TRAINING_KYU_MAX,
  TRAINING_KYU_MIN,
  type TrainingPosition,
} from "@/lib/learn/trainingGame";
import type { TrainingSettlementResult } from "@/lib/learn/trainingGameScoring";

type TrainingTimeControl = "unlimited" | TimeControlId;
type Phase = "setup" | "playing" | "scoring" | "finished";
type TimedPlayer = Readonly<{ mainTimeMs: number; periodsRemaining: number }>;
type TrainingClocks = Readonly<Record<Stone, TimedPlayer>>;
type TrainingResult =
  | Readonly<{ kind: "score"; score: JapaneseTerritoryScore }>
  | Readonly<{ kind: "resignation"; winner: Stone }>
  | Readonly<{ kind: "timeout"; winner: Stone; timedOut: Stone }>;

const KYU_OPTIONS = Array.from(
  { length: TRAINING_KYU_MAX - TRAINING_KYU_MIN + 1 },
  (_, index) => TRAINING_KYU_MAX - index,
);

function opposite(color: Stone): Stone {
  return color === "black" ? "white" : "black";
}

function format(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (copy, [key, value]) => copy.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

function formatTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function initialClocks(controlId: TrainingTimeControl): TrainingClocks | null {
  if (controlId === "unlimited") return null;
  const control = getTimeControl(controlId);
  const player = Object.freeze({
    mainTimeMs: control.mainTimeSeconds * 1_000,
    periodsRemaining: control.byoYomiPeriods,
  });
  return Object.freeze({ black: player, white: player });
}

function advancePlayer(
  player: TimedPlayer,
  controlId: Exclude<TrainingTimeControl, "unlimited">,
  elapsedMs: number,
): ClockAdvance {
  const control = getTimeControl(controlId);
  return advanceClock({
    mainTimeMs: player.mainTimeMs,
    periodsRemaining: player.periodsRemaining,
    periodTimeMs: control.byoYomiSeconds * 1_000,
    elapsedMs,
  });
}

function lastPlayedMove(position: TrainingPosition): Position | null {
  const move = [...position.moves].reverse().find((candidate) => !candidate.isPass);
  return move && move.x !== null && move.y !== null ? { x: move.x, y: move.y } : null;
}

export function TrainingGame() {
  const { dictionary, href } = useI18n();
  const copy = dictionary.trainingGame;
  const gameCopy = dictionary.game;
  const { playerKey } = usePlayerIdentity();
  const [boardSize, setBoardSize] = useState<BoardSize>(9);
  const [timeControl, setTimeControl] = useState<TrainingTimeControl>("unlimited");
  const [kyu, setKyu] = useState(15);
  const [phase, setPhase] = useState<Phase>("setup");
  const [gameId, setGameId] = useState("");
  const [position, setPosition] = useState(() => createTrainingPosition(9));
  const [clocks, setClocks] = useState<TrainingClocks | null>(null);
  const [turnStartedAt, setTurnStartedAt] = useState(() => Date.now());
  const [proposal, setProposal] = useState<GoStoneJapaneseSettlementProposal | null>(null);
  const [result, setResult] = useState<TrainingResult | null>(null);
  const [evaluationBusy, setEvaluationBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localNow, setLocalNow] = useState(() => Date.now());
  const botRequest = useRef<string | null>(null);
  const turnStatus = useRef<HTMLDivElement>(null);

  const finishOnTimeout = useCallback((timedOut: Stone, advanced: ClockAdvance) => {
    setClocks((current) => current && Object.freeze({
      ...current,
      [timedOut]: Object.freeze({
        mainTimeMs: advanced.mainTimeMs,
        periodsRemaining: advanced.periodsRemaining,
      }),
    }));
    setResult({ kind: "timeout", winner: opposite(timedOut), timedOut });
    setPhase("finished");
  }, []);

  useEffect(() => {
    if (phase !== "playing" || !clocks || timeControl === "unlimited") return;
    const update = () => {
      const now = Date.now();
      setLocalNow(now);
      const advanced = advancePlayer(
        clocks[position.turn],
        timeControl,
        now - turnStartedAt,
      );
      if (advanced.timedOut) finishOnTimeout(position.turn, advanced);
    };
    const interval = window.setInterval(update, 250);
    return () => window.clearInterval(interval);
  }, [clocks, finishOnTimeout, phase, position.turn, timeControl, turnStartedAt]);

  useEffect(() => {
    if (phase !== "playing" || position.moves.length !== 0) return;
    window.scrollTo({ top: 0, behavior: "auto" });
    turnStatus.current?.focus({ preventScroll: true });
  }, [phase, position.moves.length]);

  const beginSettlement = useCallback(async (stopped: TrainingPosition) => {
    setPhase("scoring");
    setEvaluationBusy(true);
    setProposal(null);
    setError(null);
    try {
      const nextProposal = await proposeJapaneseSettlement({
        gameId,
        boardSize: stopped.boardSize,
        board: stopped.board,
        moves: stopped.moves,
        komi: GOSTONE_BOT_MODEL.komi,
        targetRating: kyuToBotRating(kyu),
        gameVersion: stopped.moves.length,
      });
      setProposal(nextProposal);
    } catch {
      setError(copy.modelFailed);
    } finally {
      setEvaluationBusy(false);
    }
  }, [copy.modelFailed, gameId, kyu]);

  const commitAction = useCallback((
    snapshot: TrainingPosition,
    action: GoStoneBotMove,
  ): TrainingPosition | null => {
    const now = Date.now();
    if (clocks && timeControl !== "unlimited") {
      const advanced = advancePlayer(
        clocks[snapshot.turn],
        timeControl,
        now - turnStartedAt,
      );
      if (advanced.timedOut) {
        finishOnTimeout(snapshot.turn, advanced);
        return null;
      }
      setClocks(Object.freeze({
        ...clocks,
        [snapshot.turn]: Object.freeze({
          mainTimeMs: advanced.mainTimeMs,
          periodsRemaining: advanced.periodsRemaining,
        }),
      }));
    }

    const applied = applyTrainingAction(snapshot, action, new Date(now).toISOString());
    if (!applied.ok) {
      const message = applied.error === "occupied" ? copy.occupied
        : applied.error === "suicide" ? copy.suicide
          : applied.error === "ko" ? copy.ko : copy.invalidMove;
      setError(message);
      setTurnStartedAt(now);
      return null;
    }
    setError(null);
    setPosition(applied.position);
    setTurnStartedAt(now);
    setLocalNow(now);
    return applied.position;
  }, [clocks, copy.invalidMove, copy.ko, copy.occupied, copy.suicide, finishOnTimeout, timeControl, turnStartedAt]);

  useEffect(() => {
    if (phase !== "playing" || position.turn !== "white") return;
    const requestKey = `${gameId}:${position.moves.length}`;
    if (botRequest.current === requestKey) return;
    botRequest.current = requestKey;
    const snapshot = position;
    let cancelled = false;

    void (async () => {
      const excludedMoves: Position[] = [];
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const move = await generateBrowserBotMove({
          gameId,
          boardSize: snapshot.boardSize,
          board: snapshot.board,
          moves: snapshot.moves,
          toMove: "white",
          komi: GOSTONE_BOT_MODEL.komi,
          targetRating: kyuToBotRating(kyu),
          gameVersion: snapshot.moves.length,
          excludedMoves,
        });
        if (cancelled) return;
        const next = commitAction(snapshot, move);
        if (next) {
          if (next.consecutivePasses >= 2) await beginSettlement(next);
          return;
        }
        if (move.kind === "play") {
          excludedMoves.push({ x: move.x, y: move.y });
          continue;
        }
        return;
      }
      throw new Error("browser model exhausted its legal move retries");
    })().catch(() => {
      if (!cancelled) setError(copy.modelFailed);
    });
    return () => {
      cancelled = true;
    };
  }, [beginSettlement, commitAction, copy.modelFailed, gameId, kyu, phase, position]);

  function startGame() {
    const now = Date.now();
    setGameId(crypto.randomUUID());
    setPosition(createTrainingPosition(boardSize));
    setClocks(initialClocks(timeControl));
    setTurnStartedAt(now);
    setLocalNow(now);
    setProposal(null);
    setResult(null);
    setError(null);
    botRequest.current = null;
    setPhase("playing");
  }

  function playAt(x: number, y: number) {
    if (phase !== "playing" || position.turn !== "black") return;
    const next = commitAction(position, { kind: "play", x, y });
    if (next?.consecutivePasses && next.consecutivePasses >= 2) {
      void beginSettlement(next);
    }
  }

  function pass() {
    if (phase !== "playing" || position.turn !== "black") return;
    const next = commitAction(position, { kind: "pass" });
    if (next && next.consecutivePasses >= 2) void beginSettlement(next);
  }

  function resign() {
    if (phase !== "playing") return;
    setResult({ kind: "resignation", winner: "white" });
    setPhase("finished");
  }

  function continuePlaying() {
    const now = Date.now();
    setProposal(null);
    setError(null);
    setPosition((current) => Object.freeze({ ...current, consecutivePasses: 0 }));
    setTurnStartedAt(now);
    setLocalNow(now);
    setPhase("playing");
  }

  async function acceptScore() {
    if (!proposal || proposal.uncertainStones.length > 0 || !playerKey) return;
    setEvaluationBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/training-game/score", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [EXPECTED_PLAYER_HEADER]: playerKey,
        },
        body: JSON.stringify({
          boardSize: position.boardSize,
          moves: position.moves,
          proposal: {
            contractVersion: proposal.contractVersion,
            modelVersion: proposal.modelVersion,
            modelSha256: proposal.modelSha256,
            authority: proposal.authority,
            stoppedMoveNumber: proposal.stoppedMoveNumber,
            deadStones: proposal.deadStones,
            uncertainStones: proposal.uncertainStones,
            neutralRegionSeeds: proposal.neutralRegionSeeds,
          },
        }),
      });
      const body = await readApi<{
        actor: string;
        result: TrainingSettlementResult;
      }>(response);
      if (body.actor !== playerKey) throw new Error("training score identity changed");
      setResult({ kind: "score", score: body.result.score });
      setPhase("finished");
    } catch {
      setError(copy.scoreFailed);
    } finally {
      setEvaluationBusy(false);
    }
  }

  const visibleClock = (color: Stone): ClockAdvance | null => {
    if (!clocks || timeControl === "unlimited") return null;
    return advancePlayer(
      clocks[color],
      timeControl,
      phase === "playing" && position.turn === color ? localNow - turnStartedAt : 0,
    );
  };
  const blackClock = visibleClock("black");
  const whiteClock = visibleClock("white");
  const botThinking = phase === "playing" && position.turn === "white";
  const scoreWinner = result?.kind === "score" && result.score.outcome.kind === "points"
    ? result.score.outcome.winner : null;
  const youWon = result
    ? result.kind === "score" ? scoreWinner === "black"
      : result.winner === "black"
    : false;
  const resultHeading = result?.kind === "score" && result.score.outcome.kind === "jigo"
    ? gameCopy.draw
    : youWon ? copy.youWon : copy.youLost;

  if (phase === "setup") {
    return (
      <div className="content-page training-game training-game--setup">
        <Link className="training-game__back" href={href("/learn")}>
          <ArrowLeft aria-hidden="true" size={15} /> {copy.backToLearn}
        </Link>
        <header className="training-game__hero">
          <span>{copy.kicker}</span>
          <h1>{copy.title}</h1>
          <p>{copy.description}</p>
        </header>
        <section className="training-setup-card">
          <h2>{copy.settingsTitle}</h2>
          <div className="training-setting">
            <label>{copy.boardSize}</label>
            <BoardSizeSelector onChange={setBoardSize} value={boardSize} />
          </div>
          <div className="training-setting">
            <label>{copy.timeLimit}</label>
            <div aria-label={copy.timeLimit} className="training-time-selector" role="group">
              <button
                aria-pressed={timeControl === "unlimited"}
                className={timeControl === "unlimited" ? "is-selected" : ""}
                onClick={() => setTimeControl("unlimited")}
                type="button"
              >
                <Clock3 aria-hidden="true" size={16} />
                <span><strong>{copy.unlimited}</strong><small>{copy.unlimitedDetail}</small></span>
              </button>
              {TIME_CONTROLS.map((control) => (
                <button
                  aria-pressed={timeControl === control.id}
                  className={timeControl === control.id ? "is-selected" : ""}
                  key={control.id}
                  onClick={() => setTimeControl(control.id)}
                  type="button"
                >
                  <Clock3 aria-hidden="true" size={16} />
                  <span>
                    <strong>{dictionary.timeControls[control.id].name}</strong>
                    <small>{dictionary.timeControls[control.id].shortLabel}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="training-setting">
            <label htmlFor="training-kyu">{copy.strength}</label>
            <select
              id="training-kyu"
              onChange={(event) => setKyu(Number(event.target.value))}
              value={kyu}
            >
              {KYU_OPTIONS.map((rank) => (
                <option key={rank} value={rank}>{format(copy.kyuLabel, { rank })}</option>
              ))}
            </select>
            <small>{copy.strengthHint}</small>
          </div>
          <button className="button button--primary button--lg training-start" onClick={startGame} type="button">
            {copy.start}
          </button>
          <p className="training-privacy-note">{copy.privacyNote}</p>
          <span className="training-model-note">
            {format(copy.modelLabel, {
              name: GOSTONE_BOT_MODEL.modelName,
              version: GOSTONE_BOT_MODEL.modelVersion,
            })}
          </span>
        </section>
      </div>
    );
  }

  return (
    <div className="content-page training-game training-game--board">
      <header className="training-board-header">
        <Link className="training-game__back" href={href("/learn")}>
          <ArrowLeft aria-hidden="true" size={15} /> {copy.backToLearn}
        </Link>
        <span>{format(copy.modelLabel, { name: GOSTONE_BOT_MODEL.modelName, version: GOSTONE_BOT_MODEL.modelVersion })}</span>
      </header>
      <div className="training-board-layout">
        <section className="training-board-panel">
          <div className="training-turn-status" aria-live="polite" ref={turnStatus} tabIndex={-1}>
            <strong>{botThinking ? copy.botThinking : copy.yourTurn}</strong>
            <span>{format(copy.moveNumber, { number: position.moves.length + 1 })}</span>
          </div>
          <GoBoard
            boardSize={position.boardSize}
            boardState={position.board}
            deadStones={proposal ? [...proposal.deadStones] : []}
            disabled={phase !== "playing" || position.turn !== "black"}
            lastMove={lastPlayedMove(position)}
            onIntersectionClick={playAt}
            precisionRevision={`${gameId}:${position.moves.length}:${phase}`}
          />
        </section>
        <aside className="training-side-panel">
          <div className={`training-player${position.turn === "white" && phase === "playing" ? " is-active" : ""}`}>
            <i className="training-stone training-stone--white" />
            <div><strong>{copy.opponent}</strong><span>{format(copy.kyuLabel, { rank: kyu })}</span></div>
            <b>{whiteClock ? formatTime(whiteClock.displayTimeMs) : copy.unlimited}</b>
          </div>
          <div className={`training-player${position.turn === "black" && phase === "playing" ? " is-active" : ""}`}>
            <i className="training-stone training-stone--black" />
            <div><strong>{copy.you}</strong><span>{copy.black}</span></div>
            <b>{blackClock ? formatTime(blackClock.displayTimeMs) : copy.unlimited}</b>
          </div>

          {error ? <p className="training-error" role="alert">{error}</p> : null}

          {phase === "playing" ? (
            <div className="training-actions">
              <button disabled={botThinking} onClick={pass} type="button">
                <SkipForward aria-hidden="true" size={17} /> {copy.pass}
              </button>
              <button disabled={botThinking} onClick={resign} type="button">
                <Flag aria-hidden="true" size={16} /> {copy.resign}
              </button>
            </div>
          ) : null}

          {phase === "scoring" ? (
            <section className="training-settlement">
              <h2>{copy.settlementTitle}</h2>
              <p>{evaluationBusy ? copy.evaluating : copy.settlementDescription}</p>
              {proposal?.uncertainStones.length ? (
                <p className="training-settlement__uncertain">
                  {format(copy.uncertainGroups, {
                    count: proposal.groups.filter((group) => group.status === "uncertain").length,
                  })}
                </p>
              ) : null}
              {proposal?.score ? (
                <div className="training-score-preview">
                  <span>{copy.black}<strong>{proposal.score.blackTotal}</strong></span>
                  <span>{copy.white}<strong>{proposal.score.whiteTotal}</strong></span>
                </div>
              ) : null}
              <div className="training-actions">
                <button disabled={evaluationBusy} onClick={continuePlaying} type="button">
                  {copy.continuePlay}
                </button>
                <button
                  className="is-primary"
                  disabled={evaluationBusy || !proposal || proposal.uncertainStones.length > 0 || !proposal.score || !playerKey}
                  onClick={() => void acceptScore()}
                  type="button"
                >
                  {copy.acceptScore}
                </button>
              </div>
            </section>
          ) : null}

          {phase === "finished" && result ? (
            <section className="training-result">
              <span>{copy.resultTitle}</span>
              <h2>{resultHeading}</h2>
              <p>
                {result.kind === "score" && result.score.outcome.kind === "points"
                  ? format(copy.pointsResult, {
                      winner: result.score.outcome.winner === "black" ? copy.black : copy.white,
                      margin: result.score.outcome.margin,
                    })
                  : result.kind === "score"
                    ? gameCopy.draw
                    : result.kind === "resignation"
                      ? copy.resignationResult
                      : format(copy.timeoutResult, {
                          player: result.timedOut === "black" ? copy.you : copy.opponent,
                        })}
              </p>
              <button className="button button--primary" onClick={() => setPhase("setup")} type="button">
                <RotateCcw aria-hidden="true" size={16} /> {copy.newGame}
              </button>
            </section>
          ) : null}

          <p className="training-side-note">{copy.privacyNote}</p>
        </aside>
      </div>
    </div>
  );
}
