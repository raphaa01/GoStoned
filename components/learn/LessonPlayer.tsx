"use client";

import { ArrowLeft, ArrowRight, BookOpen, Check, Lightbulb, MousePointer2, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { boardHash } from "@/lib/game/goEngine";
import type { Board, Position } from "@/lib/game/types";
import { formatLearn, learnUiCopy, line, type LearnLesson } from "@/lib/learn/curriculum";
import { lessonBoardPresentation } from "@/lib/learn/presentation";
import {
  boardFromStones,
  createLearnGame,
  passLearnMove,
  playLearnMove,
  samePoint,
  withLearnTurn,
  type LearnGamePosition,
} from "@/lib/learn/lessonEngine";
import { LearnGame } from "./LearnGame";
import { InteractiveLearnBoard } from "./InteractiveLearnBoard";
import { LearnTeacher } from "./LearnTeacher";

type LessonPlayerProps = Readonly<{
  lesson: LearnLesson;
  locale: string;
  initialStep: number;
  onBack: () => void;
  onStep: (step: number) => void;
  onComplete: (outcome?: "won" | "lost" | "completed") => void;
  onAttempt?: (outcome: "lost") => void;
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

export function LessonPlayer({ lesson, locale, initialStep, onBack, onStep, onComplete, onAttempt }: LessonPlayerProps) {
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
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [gameOutcome, setGameOutcome] = useState<"won" | "lost" | "completed" | undefined>();
  const [continuation, setContinuation] = useState<{ positions: LearnGamePosition[]; shown: number } | null>(null);
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
    setFailedAttempts(0);
    setGameOutcome(undefined);
    setContinuation(null);
  };

  useEffect(() => {
    onStep(stepIndex);
  }, [onStep, stepIndex]);

  const board: Board | null = position?.board ?? (step.size ? boardFromStones(step.size, step.stones ?? []) : null);
  const interactive = step.kind === "play" || step.kind === "select" || step.kind === "illegal";
  const targets = step.targets ?? [];
  const success = step.success ? line(step.success, locale) : copy.correct;

  const handlePoint = (point: Position) => {
    if (!interactive || solved || continuation || !position) return;
    const isTarget = targets.length === 0 || targets.some((target) => samePoint(target, point));
    if (!isTarget) {
      setFailedAttempts((count) => count + 1);
      setWrong(true);
      setFeedback(step.wrong ? line(step.wrong, locale) : copy.checkAgain);
      return;
    }

    if (step.kind === "select") {
      if (selected.some((chosen) => samePoint(chosen, point))) return;
      const next = [...selected, point];
      setSelected(next);
      setWrong(false);
      if (next.length === (step.selectionCount ?? targets.length)) {
        setSolved(true);
        setFeedback(success);
      } else {
        setFeedback(formatLearn(copy.markedCount, { done: next.length, total: step.selectionCount ?? targets.length }));
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
    const positions: LearnGamePosition[] = [];
    for (const reply of step.replies ?? []) {
      if (reply === null) { after = passLearnMove(after); positions.push(after); continue; }
      const played = playLearnMove(after, reply);
      if (!played.ok) throw new Error(`Invalid teaching reply in ${lesson.id}/${step.id}`);
      after = played.position;
      positions.push(after);
    }
    setPosition(result.position);
    setContinuation(positions.length ? { positions, shown: 0 } : null);
    setSolved(positions.length === 0);
    setWrong(false);
    setFeedback(positions.length ? step.replyExplanations?.[0] ? line(step.replyExplanations[0], locale) : copy.watchContinuation : success);
  };

  const showNextMove = () => {
    if (!continuation) return;
    const shown = Math.min(continuation.positions.length, continuation.shown + (step.replyBatch ?? 1));
    setPosition(continuation.positions[shown - 1]);
    if (shown === continuation.positions.length) {
      setContinuation(null);
      setSolved(true);
      setFeedback(success);
    } else {
      setContinuation({ ...continuation, shown });
      setFeedback(step.replyExplanations?.[shown] ? line(step.replyExplanations[shown], locale) : copy.watchContinuation);
    }
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
  const presentation = lessonBoardPresentation(step, {
    solved, wrong, hint, failedAttempts, lastMove: position?.moves.at(-1)?.position ?? null,
  });
  const boardInteraction = step.kind === "select" ? step.selectFrom ?? "any" : "empty";

  const gameMode = step.kind === "capture-game" ? "capture"
    : step.kind === "guided-game" ? "guided"
      : step.kind === "beginner-game" ? "beginner" : null;
  const stepMode = solved ? "solved" : continuation || step.kind === "info" ? "info" : gameMode ? "game" : "action";
  const modeLabel = solved ? copy.taskSolved : continuation || step.kind === "info" ? copy.explanation : gameMode ? copy.practiceGame : copy.taskTurn;
  const modeHelp = continuation ? copy.watchContinuation : solved ? copy.readyToContinue : step.kind === "info" ? copy.explanationHelp
    : gameMode ? copy.practiceGameHelp : step.kind === "pass" ? copy.passTaskHelp : copy.boardTaskHelp;

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
        <div className="learn-player__step-mode" data-mode={stepMode}>
          <span>
            {solved ? <Check aria-hidden="true" size={15} /> : step.kind === "info" ? <BookOpen aria-hidden="true" size={15} /> : <MousePointer2 aria-hidden="true" size={15} />}
            <strong>{modeLabel}</strong>
          </span>
          <span>{modeHelp}</span>
        </div>
        <LearnTeacher tone={wrong ? "correction" : solved ? "success" : "neutral"}>
          {!solved && !continuation ? <>
            <p>{line(step.body, locale)}</p>
            {step.task ? <strong className="learn-teacher__task">{line(step.task, locale)}</strong> : null}
          </> : null}
          {feedback ? (
            <div aria-live="polite" className={`learn-player__feedback${wrong ? " is-wrong" : solved ? " is-success" : ""}`} role="status">
              {solved ? <Check aria-hidden="true" size={17} /> : null}<p>{feedback}</p>
            </div>
          ) : null}
          {hint && step.hint && !solved ? <p className="learn-player__hint"><Lightbulb aria-hidden="true" size={16} /> {line(step.hint, locale)}</p> : null}
        </LearnTeacher>
      </div>

      <div className={`learn-player__workspace${gameMode ? " is-game" : ""}`}>
        {gameMode ? (
          <LearnGame
            key={`${lesson.id}:${step.id}`}
            locale={locale}
            mode={gameMode}
            boardSize={step.gameSize}
            requireWin={step.requireWin}
            onAttempt={onAttempt}
            onComplete={(outcome) => {
              setGameOutcome(outcome);
              setSolved(true);
              setFeedback(outcome === "won" ? copy.challengeComplete : copy.fullGameComplete);
            }}
          />
        ) : board ? (
          <InteractiveLearnBoard
            board={board}
            disabled={!interactive || solved || Boolean(continuation)}
            emphasis={presentation.emphasis}
            group={presentation.group}
            interaction={boardInteraction}
            lastMove={presentation.lastMove}
            liberties={step.kind === "select" && solved ? targets : []}
            locale={locale}
            onPoint={handlePoint}
            previewColor={step.toPlay ?? "black"}
            selected={selected}
            territory={presentation.territory}
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

          <div className="learn-player__tools">
            {(step.hint || (step.hintArea && failedAttempts >= 3)) && !solved ? (
              <button className="learn-text-button" onClick={() => setHint((current) => !current)} type="button"><Lightbulb aria-hidden="true" size={15} /> {copy.hint}</button>
            ) : null}
            {(wrong || selected.length > 0 || solved || continuation) && !gameMode ? (
              <button className="learn-text-button" onClick={() => resetStep()} type="button"><RotateCcw aria-hidden="true" size={15} /> {copy.restart}</button>
            ) : null}
          </div>

          <button className="button button--primary learn-player__next" disabled={!canAdvance && !continuation} onClick={continuation ? showNextMove : advance} type="button">
            {continuation ? `${copy.showNextMove} (${continuation.shown + 1}/${continuation.positions.length})` : stepIndex === lesson.steps.length - 1 ? copy.completeLesson : copy.continue}
            <ArrowRight aria-hidden="true" size={17} />
          </button>
        </div>
        {step.links ? <nav className="learn-game__actions" aria-label={copy.keepPracticing}>{step.links.map((destination) => <a className="button button--secondary" href={`/${locale}/${destination}`} key={destination}>{destination === "review" ? copy.reviewOwnGame : destination === "puzzles" ? copy.boardPuzzles : copy.playGame}</a>)}</nav> : null}
      </div>
    </article>
  );
}
