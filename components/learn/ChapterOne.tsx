"use client";

import {
  Anchor,
  ArrowLeft,
  ArrowRight,
  Check,
  CircleDot,
  Focus,
  Goal,
  Grid3X3,
  Lightbulb,
  MousePointer2,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useRef, useState, useSyncExternalStore } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { Position } from "@/lib/game/types";
import {
  CAPTURE_MOVE,
  CHAPTER_ONE_LESSON_IDS,
  CHAPTER_ONE_LESSONS,
  chapterOneCopy,
  CONNECT_MOVE,
  ESCAPE_MOVE,
  GOAL_CLOSING_MOVE,
  GOAL_POSITION,
  GROUP_CAPTURE_MOVE,
  LESSON_BOARD_SIZE,
  LESSON_SETUPS,
  LIBERTY_POINTS,
  replaceLessonTokens,
  sameLessonPosition,
  type ChapterOneLessonId,
  type LessonStone,
} from "@/lib/learn/chapterOne";
import { LessonBoard } from "./LessonBoard";

const STORAGE_KEY = "gostone.learn.chapter-one.v2";
const PROGRESS_EVENT = "gostone:learn-progress";

const LESSON_ICONS = [Goal, CircleDot, Focus, Anchor, Grid3X3, MousePointer2] as const;
const LESSON_TARGETS: Partial<Record<ChapterOneLessonId, Position>> = {
  goal: GOAL_CLOSING_MOVE,
  capture: CAPTURE_MOVE,
  escape: ESCAPE_MOVE,
  connect: CONNECT_MOVE,
  "capture-group": GROUP_CAPTURE_MOVE,
};

type FeedbackTone = "idle" | "progress" | "wrong" | "success";

type LessonSession = {
  stones: LessonStone[];
  markedPositions: Position[];
  completed: boolean;
  hintVisible: boolean;
  feedbackTone: FeedbackTone;
  feedback: string | null;
};

function initialSession(id: ChapterOneLessonId): LessonSession {
  return {
    stones: LESSON_SETUPS[id].map((stone) => ({ ...stone })),
    markedPositions: [],
    completed: false,
    hintVisible: false,
    feedbackTone: "idle",
    feedback: null,
  };
}

function savedLessonIds(raw: string | null): ChapterOneLessonId[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid = parsed.filter((value): value is ChapterOneLessonId => (
      typeof value === "string"
      && CHAPTER_ONE_LESSON_IDS.includes(value as ChapterOneLessonId)
    ));
    return [...new Set(valid)];
  } catch {
    return [];
  }
}

function subscribeToProgress(onStoreChange: () => void) {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) onStoreChange();
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(PROGRESS_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(PROGRESS_EVENT, onStoreChange);
  };
}

function progressSnapshot() {
  return window.localStorage.getItem(STORAGE_KEY) ?? "[]";
}

function serverProgressSnapshot() {
  return "[]";
}

function saveProgress(ids: readonly ChapterOneLessonId[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  window.dispatchEvent(new Event(PROGRESS_EVENT));
}

export function ChapterOne() {
  const { href, locale } = useI18n();
  const copy = chapterOneCopy(locale);
  const [activeId, setActiveId] = useState<ChapterOneLessonId>(CHAPTER_ONE_LESSON_IDS[0]);
  const [session, setSession] = useState<LessonSession>(() => initialSession(activeId));
  const workspaceRef = useRef<HTMLElement>(null);
  const savedProgress = useSyncExternalStore(
    subscribeToProgress,
    progressSnapshot,
    serverProgressSnapshot,
  );
  const completedIds = savedLessonIds(savedProgress);

  const activeIndex = CHAPTER_ONE_LESSONS.findIndex(({ id }) => id === activeId);
  const activeDefinition = CHAPTER_ONE_LESSONS[activeIndex];
  const lesson = copy.lessons[activeId];
  const completionPercentage = Math.round((completedIds.length / CHAPTER_ONE_LESSONS.length) * 100);
  const allComplete = completedIds.length === CHAPTER_ONE_LESSONS.length;

  const selectLesson = (id: ChapterOneLessonId, scroll = true) => {
    setActiveId(id);
    setSession(initialSession(id));
    if (scroll) {
      window.requestAnimationFrame(() => workspaceRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  };

  const completeLesson = (nextSession: LessonSession) => {
    setSession({ ...nextSession, completed: true, feedbackTone: "success", feedback: lesson.success });
    if (!completedIds.includes(activeId)) saveProgress([...completedIds, activeId]);
  };

  const occupied = (position: Position) => session.stones.some((stone) => sameLessonPosition(stone, position));

  const handlePlay = (position: Position) => {
    if (session.completed) return;
    if (occupied(position)) {
      setSession((current) => ({ ...current, feedbackTone: "wrong", feedback: copy.feedbackWrong }));
      return;
    }

    if (activeId === "liberties") {
      const isLiberty = LIBERTY_POINTS.some((liberty) => sameLessonPosition(liberty, position));
      if (!isLiberty) {
        setSession((current) => ({ ...current, feedbackTone: "wrong", feedback: copy.feedbackWrong }));
        return;
      }

      if (session.markedPositions.some((marked) => sameLessonPosition(marked, position))) return;
      const markedPositions = [...session.markedPositions, position];
      const nextSession = { ...session, markedPositions };
      if (markedPositions.length === LIBERTY_POINTS.length) {
        completeLesson(nextSession);
      } else {
        setSession({
          ...nextSession,
          feedbackTone: "progress",
          feedback: replaceLessonTokens(copy.libertyProgress, { count: markedPositions.length }),
        });
      }
      return;
    }

    const target = LESSON_TARGETS[activeId];
    if (!target || !sameLessonPosition(position, target)) {
      setSession((current) => ({ ...current, feedbackTone: "wrong", feedback: copy.feedbackWrong }));
      return;
    }

    const stones = activeId === "capture" || activeId === "capture-group"
      ? session.stones.filter((stone) => stone.color !== "white")
      : session.stones;
    completeLesson({
      ...session,
      stones: [...stones, { ...position, color: "black" }],
    });
  };

  const lessonTarget = LESSON_TARGETS[activeId];
  const hintPositions = session.hintVisible
    ? activeId === "liberties"
      ? LIBERTY_POINTS.filter((liberty) => !session.markedPositions.some((marked) => sameLessonPosition(marked, liberty)))
      : lessonTarget
        ? [lessonTarget]
        : []
    : [];
  const territoryTargets = activeId === "goal" ? [GOAL_POSITION] : [];
  const ownedTerritory = activeId === "goal" && session.completed ? [GOAL_POSITION] : [];

  const feedback = session.feedback ?? copy.feedbackIdle;
  const nextId = CHAPTER_ONE_LESSONS[activeIndex + 1]?.id;
  const previousId = CHAPTER_ONE_LESSONS[activeIndex - 1]?.id;

  return (
    <div className="content-page learn-path">
      <header className="content-hero learn-path__hero">
        <span className="section-kicker"><Sparkles aria-hidden="true" size={14} /> {copy.kicker}</span>
        <h1>{copy.title}</h1>
        <p>{copy.description}</p>
      </header>

      <section aria-labelledby="chapter-one-title" className="learn-chapter">
        <div className="learn-course">
          <aside className="learn-course__sidebar">
            <div className="learn-course__intro">
              <span className="section-kicker">{copy.chapterLabel}</span>
              <h2 id="chapter-one-title">{copy.chapterSummary}</h2>
              <div className="learn-path__chapter-meta">
                <span>{CHAPTER_ONE_LESSONS.length} {copy.lessonsLabel}</span>
                <span>{CHAPTER_ONE_LESSONS.reduce((sum, item) => sum + item.minutes, 0)} {copy.minuteLabel}</span>
              </div>
            </div>

            <div aria-label={`${copy.progressLabel}: ${completionPercentage}%`} className="learn-progress">
              <div className="learn-progress__copy">
                <span>{copy.progressLabel}</span>
                <strong>{completedIds.length}/{CHAPTER_ONE_LESSONS.length}</strong>
              </div>
              <div aria-hidden="true" className="learn-progress__track">
                <span style={{ width: `${completionPercentage}%` }} />
              </div>
              <button
                className="learn-progress__reset"
                disabled={completedIds.length === 0}
                onClick={() => {
                  saveProgress([]);
                  setActiveId(CHAPTER_ONE_LESSON_IDS[0]);
                  setSession(initialSession(CHAPTER_ONE_LESSON_IDS[0]));
                }}
                type="button"
              >
                <RotateCcw aria-hidden="true" size={13} /> {copy.resetProgress}
              </button>
            </div>

            <nav aria-label={copy.lessonNavigation} className="lesson-rail">
              {CHAPTER_ONE_LESSONS.map((definition, index) => {
                const Icon = LESSON_ICONS[index];
                const complete = completedIds.includes(definition.id);
                const active = definition.id === activeId;
                return (
                  <button
                    aria-current={active ? "step" : undefined}
                    className={`lesson-rail__item${active ? " is-active" : ""}${complete ? " is-complete" : ""}`}
                    key={definition.id}
                    onClick={() => selectLesson(definition.id, false)}
                    type="button"
                  >
                    <span className="lesson-rail__number">
                      {complete ? <Check aria-hidden="true" size={14} /> : <Icon aria-hidden="true" size={15} />}
                    </span>
                    <span>
                      <strong>{index + 1}. {copy.lessons[definition.id].shortTitle}</strong>
                      <small>{definition.minutes} {copy.minuteLabel}</small>
                    </span>
                  </button>
                );
              })}
            </nav>
          </aside>

          <article className="lesson-workspace" ref={workspaceRef}>
            <div className="lesson-workspace__board-panel">
              <header>
                <div>
                  <strong>{copy.boardLabel}</strong>
                  <span>{copy.boardContext}</span>
                </div>
                <span className="lesson-turn"><i aria-hidden="true" /> {activeId === "liberties" ? copy.markLiberties : copy.blackToPlay}</span>
              </header>
              <LessonBoard
                copy={copy}
                disabled={session.completed}
                hintPositions={hintPositions}
                markedPositions={session.markedPositions}
                onPlay={handlePlay}
                ownedTerritory={ownedTerritory}
                size={LESSON_BOARD_SIZE}
                stones={session.stones}
                territoryTargets={territoryTargets}
              />
            </div>

            <div className="lesson-workspace__lesson-panel">
              <div className="lesson-copy">
                <span className="lesson-copy__eyebrow">{lesson.eyebrow} · {activeDefinition.minutes} {copy.minuteLabel}</span>
                <h3>{lesson.title}</h3>
                <p>{lesson.summary}</p>
              </div>

              <section className="lesson-task" aria-labelledby="lesson-task-title">
                <span><MousePointer2 aria-hidden="true" size={16} /> {copy.guidedExercise}</span>
                <h4 id="lesson-task-title">{copy.instructionLabel}</h4>
                <p>{lesson.instruction}</p>
              </section>

              <div aria-atomic="true" aria-live="polite" className={`lesson-feedback is-${session.feedbackTone}`} role="status">
                <span aria-hidden="true">
                  {session.feedbackTone === "success" ? <Check size={17} /> : session.feedbackTone === "wrong" ? <RotateCcw size={16} /> : <CircleDot size={16} />}
                </span>
                <p>{feedback}</p>
              </div>

              {session.hintVisible && !session.completed ? (
                <div className="lesson-hint"><Lightbulb aria-hidden="true" size={16} /><p>{lesson.hint}</p></div>
              ) : null}

              {session.completed ? (
                <div className="lesson-takeaway">
                  <span><Sparkles aria-hidden="true" size={15} /> {copy.takeawayLabel}</span>
                  <p>{lesson.takeaway}</p>
                </div>
              ) : null}

              <div className="lesson-actions">
                <button
                  className="button button--ghost button--sm"
                  onClick={() => setSession((current) => ({ ...current, hintVisible: !current.hintVisible }))}
                  type="button"
                >
                  <Lightbulb aria-hidden="true" size={15} /> {session.hintVisible ? copy.hideHint : copy.hint}
                </button>
                <button className="button button--ghost button--sm" onClick={() => setSession(initialSession(activeId))} type="button">
                  <RotateCcw aria-hidden="true" size={15} /> {copy.restartLesson}
                </button>
              </div>

              <footer className="lesson-pagination">
                <button
                  aria-label={copy.previousLesson}
                  className="lesson-pagination__previous"
                  disabled={!previousId}
                  onClick={() => previousId && selectLesson(previousId)}
                  type="button"
                >
                  <ArrowLeft aria-hidden="true" size={17} /> <span>{copy.previousLesson}</span>
                </button>
                {nextId ? (
                  <button
                    className="button button--primary"
                    disabled={!session.completed}
                    onClick={() => selectLesson(nextId)}
                    type="button"
                  >
                    {copy.nextLesson} <ArrowRight aria-hidden="true" size={17} />
                  </button>
                ) : session.completed ? (
                  <Link className="button button--primary" href={href("/play?size=9")}>
                    {copy.finishChapter} <ArrowRight aria-hidden="true" size={17} />
                  </Link>
                ) : (
                  <button className="button button--primary" disabled type="button">
                    {copy.finishChapter} <ArrowRight aria-hidden="true" size={17} />
                  </button>
                )}
              </footer>
            </div>
          </article>
        </div>

        {allComplete ? (
          <aside className="learn-chapter-complete">
            <span><Check aria-hidden="true" size={22} /></span>
            <div><strong>{copy.chapterComplete}</strong><p>{copy.chapterCompleteBody}</p></div>
            <Link className="button button--secondary" href={href("/play?size=9")}>{copy.playNine} <ArrowRight aria-hidden="true" size={17} /></Link>
          </aside>
        ) : null}
      </section>
    </div>
  );
}
