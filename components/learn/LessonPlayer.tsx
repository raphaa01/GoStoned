"use client";

import { ArrowLeft, ArrowRight, Check, Lightbulb, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { boardHash } from "@/lib/game/goEngine";
import type { Board, Position } from "@/lib/game/types";
import { formatLearn, learnUiCopy, line, type LearnLesson } from "@/lib/learn/curriculum";
import {
  boardFromStones,
  createLearnGame,
  playLearnMove,
  samePoint,
  withLearnTurn,
  type LearnGamePosition,
} from "@/lib/learn/lessonEngine";
import { LearnGame } from "./LearnGame";
import { InteractiveLearnBoard } from "./InteractiveLearnBoard";

type LessonPlayerProps = Readonly<{
  lesson: LearnLesson;
  locale: string;
  initialStep: number;
  onBack: () => void;
  onStep: (step: number) => void;
  onComplete: (outcome?: "won" | "lost" | "completed") => void;
}>;

function positionForStep(lesson: LearnLesson, stepIndex: number, previous?: LearnGamePosition | null): LearnGamePosition | null {
  const step = lesson.steps[stepIndex];
  if (!step.size) return null;
  if (step.continuePosition && previous?.board.length === step.size) {
    return withLearnTurn(previous, step.toPlay ?? previous.turn);
  }
  let position = withLearnTurn(createLearnGame(step.size, step.stones ?? []), step.toPlay ?? "black");
  if (step.koPreviousBoard) {
    const previous = boardFromStones(step.size, step.koPreviousBoard);
    position = { ...position, history: [boardHash(previous), boardHash(position.board)] };
  }
  return position;
}

export function LessonPlayer({ lesson, locale, initialStep, onBack, onStep, onComplete }: LessonPlayerProps) {
  const copy = learnUiCopy(locale);
  let safeInitial = Math.min(Math.max(initialStep, 0), lesson.steps.length - 1);
  // Free placements cannot be reconstructed from a step number alone.
  // Resume their short sequence at its first placement, never on a blank "second stone" board.
  while (safeInitial > 0 && lesson.steps[safeInitial].continuePosition) safeInitial -= 1;
  const [stepIndex, setStepIndex] = useState(safeInitial);
  const [position, setPosition] = useState<LearnGamePosition | null>(() => positionForStep(lesson, safeInitial));
  const stepStart = useRef(position);
  const [selected, setSelected] = useState<Position[]>([]);
  const [solved, setSolved] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [wrong, setWrong] = useState(false);
  const [hint, setHint] = useState(false);
  const [gameOutcome, setGameOutcome] = useState<"won" | "lost" | "completed" | undefined>();
  const step = lesson.steps[stepIndex];

  const resetStep = (nextIndex = stepIndex, previous?: LearnGamePosition | null) => {
    const nextPosition = nextIndex === stepIndex && previous === undefined
      ? stepStart.current : positionForStep(lesson, nextIndex, previous);
    stepStart.current = nextPosition;
    setPosition(nextPosition);
    setSelected([]);
    setSolved(false);
    setFeedback(null);
    setWrong(false);
    setHint(false);
    setGameOutcome(undefined);
  };

  useEffect(() => {
    onStep(stepIndex);
  }, [onStep, stepIndex]);

  const board: Board | null = position?.board ?? (step.size ? boardFromStones(step.size, step.stones ?? []) : null);
  const interactive = step.kind === "play" || step.kind === "select" || step.kind === "illegal";
  const targets = step.targets ?? [];
  const success = step.success ? line(step.success, locale) : copy.correct;

  const handlePoint = (point: Position) => {
    if (!interactive || solved || !position) return;
    const isTarget = targets.length === 0 || targets.some((target) => samePoint(target, point));
    if (!isTarget) {
      setWrong(true);
      setFeedback(step.wrong ? line(step.wrong, locale) : copy.checkAgain);
      return;
    }

    if (step.kind === "select") {
      if (selected.some((chosen) => samePoint(chosen, point))) return;
      const next = [...selected, point];
      setSelected(next);
      setWrong(false);
      if (next.length === targets.length) {
        setSolved(true);
        setFeedback(success);
      } else {
        setFeedback(formatLearn(copy.markedCount, { done: next.length, total: targets.length }));
      }
      return;
    }

    const result = playLearnMove(position, point);
    if (step.kind === "illegal") {
      if (!result.ok && result.error === step.expectedError) {
        setSolved(true);
        setWrong(false);
        setFeedback(success);
      } else {
        setWrong(true);
        setFeedback(step.wrong ? line(step.wrong, locale) : copy.ruleNotShown);
      }
      return;
    }

    if (!result.ok) {
      setWrong(true);
      setFeedback(result.error === "suicide" ? copy.noLiberty : result.error === "ko" ? copy.koBlocked : copy.pointOccupied);
      return;
    }
    let after = result.position;
    for (const reply of step.replies ?? []) {
      const played = playLearnMove(after, reply);
      if (!played.ok) throw new Error(`Invalid teaching reply in ${lesson.id}/${step.id}`);
      after = played.position;
    }
    setPosition(after);
    setSolved(true);
    setWrong(false);
    setFeedback(success);
  };

  const advance = () => {
    if (stepIndex < lesson.steps.length - 1) {
      const next = stepIndex + 1;
      setStepIndex(next);
      resetStep(next, position);
      return;
    }
    onComplete(gameOutcome);
  };

  const canAdvance = step.kind === "info" || solved;
  const stepProgress = ((stepIndex + Number(solved || step.kind === "info")) / lesson.steps.length) * 100;
  const revealTargets = wrong || hint;
  const shownEmphasis = revealTargets ? [...(step.emphasis ?? []), ...targets] : (step.emphasis ?? []);
  const boardInteraction = step.kind === "select" ? step.selectFrom ?? "any" : "empty";

  const gameMode = step.kind === "capture-game" ? "capture"
    : step.kind === "guided-game" ? "guided"
      : step.kind === "beginner-game" ? "beginner" : null;

  return (
    <article className="learn-player">
      <header className="learn-player__topbar">
        <button className="learn-text-button" onClick={onBack} type="button"><ArrowLeft aria-hidden="true" size={17} /> {copy.learningPath}</button>
        <span>{stepIndex + 1} / {lesson.steps.length}</span>
      </header>

      <div aria-hidden="true" className="learn-player__progress"><span style={{ width: `${stepProgress}%` }} /></div>

      <div className="learn-player__heading">
        <small>{formatLearn(copy.stage, { stage: lesson.stage })}</small>
        <h1>{line(lesson.title, locale)}</h1>
        <p>{line(step.body, locale)}</p>
        {step.task ? <strong>{line(step.task, locale)}</strong> : null}
      </div>

      <div className={`learn-player__workspace${gameMode ? " is-game" : ""}`}>
        {gameMode ? (
          <LearnGame
            key={`${lesson.id}:${step.id}`}
            locale={locale}
            mode={gameMode}
            onComplete={(outcome) => {
              setGameOutcome(outcome);
              setSolved(true);
              setFeedback(outcome === "won" ? copy.challengeComplete : copy.fullGameComplete);
            }}
          />
        ) : board ? (
          <InteractiveLearnBoard
            board={board}
            disabled={!interactive || solved}
            emphasis={shownEmphasis}
            group={step.group}
            interaction={boardInteraction}
            lastMove={step.lastMove ?? position?.moves.at(-1)?.position ?? null}
            liberties={step.kind === "select" && solved ? targets : []}
            locale={locale}
            onPoint={handlePoint}
            previewColor={step.toPlay ?? "black"}
            selected={selected}
            territory={step.territory}
          />
        ) : null}

        <div className="learn-player__controls">
          {step.kind === "pass" && !solved ? (
            <button
              className="button button--primary"
              onClick={() => { setSolved(true); setFeedback(success); }}
              type="button"
            >
              {copy.pass}
            </button>
          ) : null}

          {feedback ? (
            <div aria-live="polite" className={`learn-player__feedback${wrong ? " is-wrong" : solved ? " is-success" : ""}`} role="status">
              {solved ? <Check aria-hidden="true" size={17} /> : null}<p>{feedback}</p>
            </div>
          ) : null}

          {hint && step.hint && !solved ? <p className="learn-player__hint"><Lightbulb aria-hidden="true" size={16} /> {line(step.hint, locale)}</p> : null}

          <div className="learn-player__tools">
            {step.hint && !solved ? (
              <button className="learn-text-button" onClick={() => setHint((current) => !current)} type="button"><Lightbulb aria-hidden="true" size={15} /> {copy.hint}</button>
            ) : null}
            {(wrong || selected.length > 0 || solved) && !gameMode ? (
              <button className="learn-text-button" onClick={() => resetStep()} type="button"><RotateCcw aria-hidden="true" size={15} /> {copy.restart}</button>
            ) : null}
          </div>

          <button className="button button--primary learn-player__next" disabled={!canAdvance} onClick={advance} type="button">
            {stepIndex === lesson.steps.length - 1 ? copy.completeLesson : copy.continue}
            <ArrowRight aria-hidden="true" size={17} />
          </button>
        </div>
      </div>
    </article>
  );
}
