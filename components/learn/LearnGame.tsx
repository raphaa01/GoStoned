"use client";

import { RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { generateBrowserBotMove, generateCaptureGoMove } from "@/lib/bot/browserBotClient";
import { GOSTONE_BOT_MODEL } from "@/lib/bot/modelV1";
import { getGroup } from "@/lib/game/goEngine";
import type { Position, Stone } from "@/lib/game/types";
import { formatLearn, learnUiCopy } from "@/lib/learn/curriculum";
import { allGroups, createLearnGame, groupLiberties, passLearnMove, playLearnMove, pointKey, storedLearnMoves, learnReviewMoments, type LearnGamePosition } from "@/lib/learn/lessonEngine";
import type { scoreLearnGame } from "@/lib/learn/gameScoring";
import { InteractiveLearnBoard } from "./InteractiveLearnBoard";

type LearnGameProps = Readonly<{
  mode: "capture" | "guided" | "beginner";
  locale: string;
  onComplete: (outcome: "won" | "lost" | "completed") => void;
}>;
type GamePhase = "playing" | "scoring" | "finished";
type ScoredGame = ReturnType<typeof scoreLearnGame>;

function initialPosition(mode: LearnGameProps["mode"]): LearnGamePosition {
  return mode === "capture" ? createLearnGame(5, [
    { x: 1, y: 1, color: "black" }, { x: 3, y: 3, color: "white" },
  ]) : createLearnGame(9);
}

export function LearnGame({ mode, locale, onComplete }: LearnGameProps) {
  const copy = learnUiCopy(locale);
  const [gameId, setGameId] = useState(() => crypto.randomUUID());
  const [position, setPosition] = useState(() => initialPosition(mode));
  const [phase, setPhase] = useState<GamePhase>("playing");
  const [message, setMessage] = useState<string | null>(null);
  const [winner, setWinner] = useState<Stone | null>(null);
  const [deadStones, setDeadStones] = useState<Position[]>([]);
  const [neutralSeeds, setNeutralSeeds] = useState<Position[]>([]);
  const [marking, setMarking] = useState<"dead" | "neutral">("dead");
  const [result, setResult] = useState<ScoredGame | null>(null);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [botFailed, setBotFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [scoringBusy, setScoringBusy] = useState(false);
  const earlyPassSeen = useRef(false);
  const completionSent = useRef(false);

  const reset = () => {
    setGameId(crypto.randomUUID());
    setPosition(initialPosition(mode));
    setPhase("playing");
    setMessage(null);
    setWinner(null);
    setDeadStones([]);
    setNeutralSeeds([]);
    setResult(null);
    setReviewIndex(0);
    setBotFailed(false);
    earlyPassSeen.current = false;
    completionSent.current = false;
  };

  useEffect(() => {
    if (phase !== "playing" || position.turn !== "white") return;
    let cancelled = false;
    void (async () => {
      let advanced: LearnGamePosition | null = null;
      let captured: readonly Position[] = [];
      if (mode === "capture") {
        const point = await generateCaptureGoMove(position);
        const next = point ? playLearnMove(position, point) : null;
        if (point && !next?.ok) throw new Error("Illegal Capture Go reply");
        advanced = next?.ok ? next.position : passLearnMove(position);
        captured = next?.ok ? next.captured : [];
      } else {
        const excludedMoves: Position[] = [];
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const action = await generateBrowserBotMove({
            gameId, boardSize: 9, board: position.board, moves: storedLearnMoves(position),
            toMove: "white", komi: GOSTONE_BOT_MODEL.komi, targetRating: 600,
            gameVersion: position.moves.length, excludedMoves,
          });
          if (cancelled) return;
          if (action.kind === "pass") { advanced = passLearnMove(position); break; }
          const next = playLearnMove(position, action);
          if (next.ok) { advanced = next.position; break; }
          excludedMoves.push({ x: action.x, y: action.y });
        }
      }
      if (cancelled) return;
      if (!advanced) throw new Error("The bot could not find a legal move");
      setBotFailed(false);
      setPosition(advanced);
      if (mode === "capture" && captured.length > 0) {
        setWinner("white");
        setPhase("finished");
        setMessage(copy.botCapturedFirst);
        return;
      }
      if (mode !== "capture" && advanced.consecutivePasses >= 2) {
        setPhase("scoring");
        setMessage(copy.bothPassed);
        return;
      }
      const atari = mode === "guided" && allGroups(advanced.board, "black")
        .some((group) => groupLiberties(advanced.board, group[0]).length === 1);
      setMessage(atari ? copy.groupInAtari : null);
    })().catch(() => {
      if (!cancelled) { setBotFailed(true); setMessage(copy.modelFailed); }
    });
    return () => { cancelled = true; };
  }, [copy, gameId, mode, phase, position, retry]);

  const play = (point: Position) => {
    if (phase !== "playing" || position.turn !== "black") return;
    const next = playLearnMove(position, point);
    if (!next.ok) {
      setMessage(next.error === "suicide" ? copy.suicideMove : next.error === "ko" ? copy.koImmediate : copy.pointOccupied);
      return;
    }
    earlyPassSeen.current = false;
    setPosition(next.position);
    setMessage(null);
    if (mode === "capture" && next.captured.length > 0) {
      setWinner("black");
      setPhase("finished");
      setMessage(copy.captureLearned);
      if (!completionSent.current) { completionSent.current = true; onComplete("won"); }
    }
  };

  const pass = () => {
    if (phase !== "playing" || mode === "capture" || position.turn !== "black") return;
    if (mode === "guided" && position.moves.length < 24 && !earlyPassSeen.current) {
      earlyPassSeen.current = true;
      setMessage(copy.openAreas);
      return;
    }
    const next = passLearnMove(position);
    setPosition(next);
    setMessage(null);
    if (next.consecutivePasses >= 2) {
      setPhase("scoring");
      setMessage(copy.bothPassed);
    }
  };

  const markPoint = (point: Position) => {
    if (phase !== "scoring" || scoringBusy) return;
    if (marking === "neutral") {
      if (position.board[point.y][point.x]) return;
      setNeutralSeeds((current) => current.some((p) => pointKey(p) === pointKey(point))
        ? current.filter((p) => pointKey(p) !== pointKey(point)) : [...current, point]);
    } else {
      if (!position.board[point.y][point.x]) return;
      const group = getGroup(position.board, point);
      const keys = new Set(deadStones.map(pointKey));
      const removing = group.every((p) => keys.has(pointKey(p)));
      setDeadStones(removing ? deadStones.filter((p) => !group.some((g) => pointKey(g) === pointKey(p)))
        : [...deadStones, ...group.filter((p) => !keys.has(pointKey(p)))]);
    }
    setMessage(null);
  };

  const finishScoring = async () => {
    if (scoringBusy) return;
    setScoringBusy(true);
    try {
      const response = await fetch("/api/learn/game/score", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moves: position.moves.map((move) => move.position), deadStones, neutralRegionSeeds: neutralSeeds, agreed: true }),
      });
      if (!response.ok) throw new Error("Settlement failed");
      const body = await response.json() as { result: ScoredGame };
      setResult(body.result);
      const outcome = body.result.score.outcome;
      setWinner(outcome.kind === "points" ? outcome.winner : null);
      setPhase("finished");
      setMessage(null);
      if (!completionSent.current) { completionSent.current = true; onComplete("completed"); }
    } catch { setMessage(copy.invalidDead); }
    finally { setScoringBusy(false); }
  };

  const reviews = useMemo(() => mode === "beginner" && phase === "finished" ? learnReviewMoments(position) : [], [mode, phase, position]);
  const review = phase === "finished" ? reviews[reviewIndex] : null;
  const score = result?.score;
  const resultText = score?.outcome.kind === "points"
    ? `${score.outcome.winner === "black" ? copy.black : copy.white} +${score.outcome.margin}`
    : score ? copy.draw : null;

  return (
    <div className="learn-game">
      <div className="learn-game__status" aria-live="polite">
        <span className={`learn-game__stone is-${position.turn}`} aria-hidden="true" />
        <strong>{phase === "playing" ? position.turn === "black" ? copy.yourTurn : copy.botTurn
          : phase === "scoring" ? copy.markDead : resultText ?? (winner === "black" ? copy.won : copy.gameFinished)}</strong>
        {mode !== "capture" ? <small>{position.moves.length} {copy.moves}</small> : null}
      </div>
      <InteractiveLearnBoard
        board={review?.board ?? result?.board ?? position.board}
        disabled={phase === "finished" || scoringBusy || (phase === "playing" && position.turn !== "black")}
        group={review?.group}
        emphasis={review?.emphasis ?? neutralSeeds}
        interaction={phase === "scoring" ? marking === "dead" ? "stone" : "empty" : "empty"}
        lastMove={review?.lastMove ?? position.moves.at(-1)?.position ?? null}
        locale={locale} onPoint={phase === "scoring" ? markPoint : play} previewColor="black"
        selected={phase === "scoring" ? deadStones : []}
        blackTerritory={review ? [] : result?.blackTerritory}
        whiteTerritory={review ? [] : result?.whiteTerritory}
      />
      {message ? <p className="learn-game__message" role="status">{message}</p> : null}
      {botFailed ? <button className="button button--secondary" onClick={() => setRetry((current) => current + 1)} type="button">{copy.retryBot}</button> : null}
      {phase === "playing" && mode !== "capture" ? <div className="learn-game__actions"><button className="button button--secondary" onClick={pass} disabled={position.turn !== "black"} type="button">{copy.pass}</button></div> : null}
      {phase === "scoring" ? (
        <div className="learn-game__settlement">
          <p>{copy.settlementHelp}</p>
          <div className="learn-game__actions">
            <button aria-pressed={marking === "dead"} className="button button--secondary" onClick={() => setMarking("dead")} type="button">{copy.markDead}</button>
            <button aria-pressed={marking === "neutral"} className="button button--secondary" onClick={() => setMarking("neutral")} type="button">{copy.neutralPoints}</button>
          </div>
          <button className="button button--primary" disabled={scoringBusy} onClick={() => void finishScoring()} type="button">{copy.confirmScore}</button>
          <button className="learn-text-button" disabled={scoringBusy} onClick={() => { setPhase("playing"); setMessage(null); setDeadStones([]); setNeutralSeeds([]); }} type="button">{copy.resumeGame}</button>
        </div>
      ) : null}
      {score ? <div className="learn-game__score"><span><small>{copy.black}</small><strong>{score.blackTotal}</strong></span><span><small>{copy.whiteWithKomi}</small><strong>{score.whiteTotal}</strong></span><p>{resultText}</p></div> : null}
      {review ? <div className="learn-game__review">
        <strong>{formatLearn(copy.learningMoment, { current: reviewIndex + 1, total: reviews.length })}</strong>
        <p>{formatLearn(copy[review.kind], { count: review.count, coordinate: review.coordinate })}</p>
        {reviews.length > 1 ? <button className="button button--secondary" onClick={() => setReviewIndex((current) => (current + 1) % reviews.length)} type="button">{copy.nextMoment}</button> : null}
      </div> : null}
      {mode === "capture" && winner !== "black" ? <button className="learn-text-button" onClick={reset} type="button"><RotateCcw aria-hidden="true" size={16} /> {copy.tryAgain}</button> : null}
    </div>
  );
}
