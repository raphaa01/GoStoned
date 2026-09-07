"use client";

import { ArrowLeft, ArrowRight, Check, Lightbulb, RotateCcw } from "lucide-react";
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
  LESSON_BOARD_SIZE,
  LESSON_SETUPS,
  LIBERTY_POINTS,
  PLACE_MOVE,
  replaceLessonTokens,
  sameLessonPosition,
  TERRITORY_MOVE,
  TERRITORY_POINT,
  type ChapterOneLessonId,
  type LessonStone,
} from "@/lib/learn/chapterOne";
import { LessonBoard } from "./LessonBoard";

const STORAGE_KEY = "gostone.learn.chapter-one.v3";
const PROGRESS_EVENT = "gostone:learn-progress";

const LESSON_TARGETS: Partial<Record<ChapterOneLessonId, Position>> = {
  place: PLACE_MOVE,
  capture: CAPTURE_MOVE,
  escape: ESCAPE_MOVE,
  connect: CONNECT_MOVE,
  territory: TERRITORY_MOVE,
};

type FeedbackTone = "progress" | "wrong" | "success";

type LessonSession = {
  stones: LessonStone[];
  markedPositions: Position[];
  completed: boolean;
  hintVisible: boolean;
  feedbackTone: FeedbackTone | null;
  feedback: string | null;
};

function initialSession(id: ChapterOneLessonId): LessonSession {
  return {
    stones: LESSON_SETUPS[id].map((stone) => ({ ...stone })),
    markedPositions: [],
    completed: false,
    hintVisible: false,
    feedbackTone: null,
    feedback: null,
  };
}

function savedLessonIds(raw: string | null): ChapterOneLessonId[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid = parsed.filter((value): value is ChapterOneLessonId => (
      typeof value === "string" && CHAPTER_ONE_LESSON_IDS.includes(value as ChapterOneLessonId)
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
  const savedProgress = useSyncExternalStore(subscribeToProgress, progressSnapshot, serverProgressSnapshot);
  const completedIds = savedLessonIds(savedProgress);

  const activeIndex = CHAPTER_ONE_LESSONS.findIndex(({ id }) => id === activeId);
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
      setSession((current) => ({ ...current, feedbackTone: "wrong", feedback: copy.occupiedPoint }));
      return;
    }

    if (activeId === "liberties") {
      const isLiberty = LIBERTY_POINTS.some((liberty) => sameLessonPosition(liberty, position));
      if (!isLiberty) {
        setSession((current) => ({ ...current, feedbackTone: "wrong", feedback: lesson.wrong }));
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
      setSession((current) => ({ ...current, feedbackTone: "wrong", feedback: lesson.wrong }));
      return;
    }

    const stones = activeId === "capture"
      ? session.stones.filter((stone) => stone.color !== "white")
      : session.stones;
    completeLesson({ ...session, stones: [...stones, { ...position, color: "black" }] });
  };

  const lessonTarget = LESSON_TARGETS[activeId];
  const hintPositions = session.hintVisible
    ? activeId === "liberties"
      ? LIBERTY_POINTS.filter((liberty) => !session.markedPositions.some((marked) => sameLessonPosition(marked, liberty)))
      : lessonTarget ? [lessonTarget] : []
    : [];
  const territoryTargets = activeId === "territory" ? [TERRITORY_POINT] : [];
  const ownedTerritory = activeId === "territory" && session.completed ? [TERRITORY_POINT] : [];
  const choicePositions = activeId === "place" ? [PLACE_MOVE] : [];
  const nextId = CHAPTER_ONE_LESSONS[activeIndex + 1]?.id;
  const previousId = CHAPTER_ONE_LESSONS[activeIndex - 1]?.id;
  const canRestart = session.hintVisible || session.feedback !== null || session.markedPositions.length > 0;

  return (
    <div className="content-page learn-path">
      <section aria-labelledby="beginner-lesson-title" className="learn-chapter">
        <header className="learn-course__header">
          <div className="learn-course__intro">
            <span className="section-kicker">{copy.kicker}</span>
            <h1 id="beginner-lesson-title">{copy.title.replace(/[.!?。！？]+$/, "")}</h1>
            <p>{copy.description}</p>
          </div>

          <div aria-label={`${copy.progressLabel}: ${completionPercentage}%`} className="learn-progress">
            <div className="learn-progress__copy">
              <span>{copy.stepLabel} {activeIndex + 1} / {CHAPTER_ONE_LESSONS.length}</span>
            </div>
            <div aria-hidden="true" className="learn-progress__track">
              <span style={{ width: `${completionPercentage}%` }} />
            </div>
            {completedIds.length > 0 ? (
              <button
                className="learn-progress__reset"
                onClick={() => {
                  saveProgress([]);
                  selectLesson(CHAPTER_ONE_LESSON_IDS[0], false);
                }}
                type="button"
              >
                <RotateCcw aria-hidden="true" size={13} /> {copy.resetProgress}
              </button>
            ) : null}
          </div>
        </header>

        <nav aria-label={copy.lessonNavigation} className="lesson-rail">
          {CHAPTER_ONE_LESSONS.map(({ id }, index) => {
            const complete = completedIds.includes(id);
            const active = id === activeId;
            return (
              <button
                aria-current={active ? "step" : undefined}
                className={`lesson-rail__item${active ? " is-active" : ""}${complete ? " is-complete" : ""}`}
                key={id}
                onClick={() => selectLesson(id, false)}
                type="button"
              >
                <span className="lesson-rail__number">{complete ? <Check aria-hidden="true" size={13} /> : index + 1}</span>
                <span>{copy.lessons[id].shortTitle}</span>
              </button>
            );
          })}
        </nav>

        <article className="lesson-workspace" ref={workspaceRef}>
          <div className="lesson-workspace__board-panel">
            <header>
              <span>{copy.boardLabel}</span>
              <strong className="lesson-turn"><i aria-hidden="true" /> {activeId === "liberties" ? copy.markLiberties : copy.blackToPlay}</strong>
            </header>
            <LessonBoard
              choicePositions={choicePositions}
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
              <span className="lesson-copy__eyebrow">{copy.stepLabel} {activeIndex + 1} / {CHAPTER_ONE_LESSONS.length}</span>
              <h2>{lesson.title.replace(/[.!?。！？]+$/, "")}</h2>
              <p>{lesson.summary}</p>
            </div>

            <section className="lesson-task" aria-labelledby="lesson-task-title">
              <h3 id="lesson-task-title">{copy.instructionLabel}</h3>
              <p>{lesson.instruction}</p>
            </section>

            {session.feedback && session.feedbackTone ? (
              <div aria-atomic="true" aria-live="polite" className={`lesson-feedback is-${session.feedbackTone}`} role="status">
                {session.feedbackTone === "success" ? <Check aria-hidden="true" size={17} /> : null}
                <p>{session.feedback}</p>
              </div>
            ) : null}

            {session.hintVisible && !session.completed ? (
              <div className="lesson-hint"><Lightbulb aria-hidden="true" size={16} /><p>{lesson.hint}</p></div>
            ) : null}

            <div className="lesson-actions">
              {!session.completed ? (
                <button
                  className="lesson-text-action"
                  onClick={() => setSession((current) => ({ ...current, hintVisible: !current.hintVisible }))}
                  type="button"
                >
                  <Lightbulb aria-hidden="true" size={15} /> {session.hintVisible ? copy.hideHint : copy.hint}
                </button>
              ) : null}
              {canRestart ? (
                <button className="lesson-text-action" onClick={() => setSession(initialSession(activeId))} type="button">
                  <RotateCcw aria-hidden="true" size={15} /> {copy.restartLesson}
                </button>
              ) : null}
            </div>

            <footer className="lesson-pagination">
              {previousId ? (
                <button className="lesson-pagination__previous" onClick={() => selectLesson(previousId)} type="button">
                  <ArrowLeft aria-hidden="true" size={17} /> {copy.previousLesson}
                </button>
              ) : <span />}
              {nextId ? (
                <button className="button button--primary" disabled={!session.completed} onClick={() => selectLesson(nextId)} type="button">
                  {copy.nextLesson} <ArrowRight aria-hidden="true" size={17} />
                </button>
              ) : session.completed ? (
                <Link className="button button--primary" href={href("/play?size=9")}>{copy.finishChapter} <ArrowRight aria-hidden="true" size={17} /></Link>
              ) : (
                <button className="button button--primary" disabled type="button">{copy.finishChapter} <ArrowRight aria-hidden="true" size={17} /></button>
              )}
            </footer>
          </div>
        </article>

        {allComplete ? (
          <aside className="learn-chapter-complete">
            <Check aria-hidden="true" size={21} />
            <div><strong>{copy.chapterComplete}</strong><p>{copy.chapterCompleteBody}</p></div>
            <Link className="button button--secondary" href={href("/play?size=9")}>{copy.playNine} <ArrowRight aria-hidden="true" size={17} /></Link>
          </aside>
        ) : null}
      </section>
    </div>
  );
}
