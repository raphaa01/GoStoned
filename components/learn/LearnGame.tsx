"use client";

import { RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getGroup } from "@/lib/game/goEngine";
import { scoreJapaneseTerritory, type JapaneseTerritoryScore } from "@/lib/game/japaneseScoring";
import type { Position, Stone } from "@/lib/game/types";
import { formatLearn, learnUiCopy } from "@/lib/learn/curriculum";
import {
  allGroups,
  chooseLearnBotMove,
  createLearnGame,
  groupLiberties,
  passLearnMove,
  playLearnMove,
  pointKey,
  type LearnGamePosition,
} from "@/lib/learn/lessonEngine";
import { InteractiveLearnBoard } from "./InteractiveLearnBoard";

type LearnGameProps = Readonly<{
  mode: "capture" | "guided" | "beginner";
  locale: string;
  onComplete: (outcome: "won" | "lost" | "completed") => void;
}>;

type GamePhase = "playing" | "scoring" | "finished";

function initialPosition(mode: LearnGameProps["mode"]): LearnGamePosition {
  if (mode === "capture") {
    return createLearnGame(5, [
      { x: 1, y: 1, color: "black" },
      { x: 3, y: 3, color: "white" },
    ]);
  }
  return createLearnGame(9);
}

function lastPoint(position: LearnGamePosition): Position | null {
  return position.moves.at(-1)?.position ?? null;
}

function weakestBlackGroup(position: LearnGamePosition): Position[] {
  return allGroups(position.board, "black").toSorted((left, right) => (
    groupLiberties(position.board, left[0]).length - groupLiberties(position.board, right[0]).length
  ))[0] ?? [];
}

export function LearnGame({ mode, locale, onComplete }: LearnGameProps) {
  const copy = learnUiCopy(locale);
  const [position, setPosition] = useState(() => initialPosition(mode));
  const [phase, setPhase] = useState<GamePhase>("playing");
  const [message, setMessage] = useState<string | null>(null);
  const [winner, setWinner] = useState<Stone | null>(null);
  const [deadStones, setDeadStones] = useState<Position[]>([]);
  const [score, setScore] = useState<JapaneseTerritoryScore | null>(null);
  const [reviewIndex, setReviewIndex] = useState(0);
  const completionSent = useRef(false);
  const botMode = mode === "capture" ? "capture" : mode === "guided" ? "teacher" : "beginner";

  const reset = () => {
    setPosition(initialPosition(mode));
    setPhase("playing");
    setMessage(null);
    setWinner(null);
    setDeadStones([]);
    setScore(null);
    setReviewIndex(0);
    completionSent.current = false;
  };

  useEffect(() => {
    if (phase !== "playing" || position.turn !== "white") return;
    const frame = window.requestAnimationFrame(() => {
      if (mode !== "capture" && position.consecutivePasses === 1) {
        setPosition(passLearnMove(position));
        setPhase("scoring");
        setMessage(copy.bothPassed);
        return;
      }
      const botMove = chooseLearnBotMove(position, botMode);
      const next = botMove ? playLearnMove(position, botMove) : null;
      const advanced = next?.ok ? next.position : passLearnMove(position);
      if (mode === "capture" && next?.ok && next.captured.length > 0) {
        setPosition(advanced);
        setWinner("white");
        setPhase("finished");
        setMessage(copy.botCapturedFirst);
        return;
      }
      if (advanced.consecutivePasses >= 2) {
        setPosition(advanced);
        setPhase("scoring");
        setMessage(copy.markDeadNow);
        return;
      }
      setPosition(advanced);
      if (mode === "guided") {
        const atari = allGroups(advanced.board, "black").find((group) => groupLiberties(advanced.board, group[0]).length === 1);
        setMessage(atari ? copy.groupInAtari : null);
      } else {
        setMessage(null);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [botMode, copy, mode, phase, position]);

  const play = (point: Position) => {
    if (phase !== "playing" || position.turn !== "black") return;
    const result = playLearnMove(position, point);
    if (!result.ok) {
      setMessage(result.error === "suicide"
        ? copy.suicideMove
        : result.error === "ko"
          ? copy.koImmediate
          : copy.pointOccupied);
      return;
    }
    setPosition(result.position);
    setMessage(null);
    if (mode === "capture" && result.captured.length > 0) {
      setWinner("black");
      setPhase("finished");
      if (!completionSent.current) {
        completionSent.current = true;
        onComplete("won");
      }
      setMessage(copy.captureLearned);
    }
  };

  const pass = () => {
    if (phase !== "playing" || mode === "capture" || position.turn !== "black") return;
    const minimumMoves = mode === "guided" ? 24 : 20;
    if (position.moves.length < minimumMoves) {
      setMessage(copy.openAreas);
      return;
    }
    const afterPlayer = passLearnMove(position);
    setPosition(afterPlayer);
    setMessage(null);
  };

  const toggleDeadGroup = (point: Position) => {
    if (phase !== "scoring" || !position.board[point.y]?.[point.x]) return;
    const group = getGroup(position.board, point);
    const current = new Set(deadStones.map(pointKey));
    const remove = group.every((stone) => current.has(pointKey(stone)));
    const next = remove
      ? deadStones.filter((stone) => !group.some((member) => pointKey(member) === pointKey(stone)))
      : [...deadStones, ...group.filter((stone) => !current.has(pointKey(stone)))];
    setDeadStones(next);
    setMessage(null);
  };

  const finishScoring = () => {
    try {
      const finalScore = scoreJapaneseTerritory({
        board: position.board,
        prisoners: {
          capturedWhiteByBlack: position.capturedWhiteByBlack,
          capturedBlackByWhite: position.capturedBlackByWhite,
        },
        deadStones,
        agreedNeutralRegionSeeds: [],
        komi: 6.5,
      });
      setScore(finalScore);
      setWinner(finalScore.outcome.kind === "points" ? finalScore.outcome.winner : null);
      setPhase("finished");
      setMessage(null);
      if (!completionSent.current) {
        completionSent.current = true;
        onComplete("completed");
      }
    } catch {
      setMessage(copy.invalidDead);
    }
  };

  const weakGroup = useMemo(() => weakestBlackGroup(position), [position]);
  const reviewMoments = mode === "beginner" && phase === "finished" ? [
    weakGroup.length > 0 ? {
      text: formatLearn(copy.weakGroupReview, { liberties: groupLiberties(position.board, weakGroup[0]).length }),
      group: weakGroup,
    } : null,
    {
      text: formatLearn(copy.capturesReview, {
        blackCaptures: position.capturedWhiteByBlack,
        whiteCaptures: position.capturedBlackByWhite,
      }),
      group: [] as Position[],
    },
  ].filter((moment): moment is { text: string; group: Position[] } => Boolean(moment)) : [];

  const shownGroup = reviewMoments[reviewIndex]?.group ?? [];
  const resultText = score?.outcome.kind === "points"
    ? `${score.outcome.winner === "black" ? copy.black : copy.white} +${score.outcome.margin}`
    : score ? copy.draw : null;

  return (
    <div className="learn-game">
      <div className="learn-game__status" aria-live="polite">
        <span className={`learn-game__stone is-${position.turn}`} aria-hidden="true" />
        <strong>{phase === "playing"
          ? position.turn === "black" ? copy.yourTurn : copy.botTurn
          : phase === "scoring" ? copy.markDead
            : resultText ?? (winner === "black" ? copy.won : copy.gameFinished)}</strong>
        {mode !== "capture" ? <small>{position.moves.length} {copy.moves}</small> : null}
      </div>

      <InteractiveLearnBoard
        board={position.board}
        disabled={phase === "finished" || (phase === "playing" && position.turn !== "black")}
        group={shownGroup}
        interaction={phase === "scoring" ? "stone" : "empty"}
        lastMove={lastPoint(position)}
        locale={locale}
        onPoint={phase === "scoring" ? toggleDeadGroup : play}
        previewColor="black"
        selected={deadStones}
      />

      {message ? <p className="learn-game__message" role="status">{message}</p> : null}

      {phase === "playing" && mode !== "capture" ? (
        <div className="learn-game__actions">
          <button className="button button--secondary" onClick={pass} type="button">{copy.pass}</button>
        </div>
      ) : null}

      {phase === "scoring" ? (
        <div className="learn-game__settlement">
          <p>{copy.settlementHelp}</p>
          <button className="button button--primary" onClick={finishScoring} type="button">{copy.confirmScore}</button>
        </div>
      ) : null}

      {score ? (
        <div className="learn-game__score">
          <span><small>{copy.black}</small><strong>{score.blackTotal}</strong></span>
          <span><small>{copy.whiteWithKomi}</small><strong>{score.whiteTotal}</strong></span>
          <p>{resultText}</p>
        </div>
      ) : null}

      {reviewMoments.length > 0 ? (
        <div className="learn-game__review">
          <strong>{formatLearn(copy.learningMoment, { current: reviewIndex + 1, total: reviewMoments.length })}</strong>
          <p>{reviewMoments[reviewIndex].text}</p>
          {reviewMoments.length > 1 ? (
            <button className="button button--secondary" onClick={() => setReviewIndex((current) => (current + 1) % reviewMoments.length)} type="button">
              {copy.nextMoment}
            </button>
          ) : null}
        </div>
      ) : null}

      {phase === "finished" && mode === "capture" && winner !== "black" ? (
        <button className="button button--secondary" onClick={reset} type="button"><RotateCcw aria-hidden="true" size={16} /> {copy.tryAgain}</button>
      ) : null}
    </div>
  );
}
