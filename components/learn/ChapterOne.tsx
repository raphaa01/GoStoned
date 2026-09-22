"use client";

import { ArrowLeft, ArrowRight, Check, Lightbulb, Lock, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
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

function LessonPathIcon({ id }: { id: ChapterOneLessonId }) {
  return (
    <svg aria-hidden="true" className={`learn-symbol learn-symbol--${id}`} viewBox="0 0 64 64">
      <path className="learn-symbol__grid" d="M12 20h40M12 32h40M12 44h40M20 12v40M32 12v40M44 12v40" />
      {id === "place" ? <circle className="learn-symbol__black" cx="32" cy="32" r="8" /> : null}
      {id === "liberties" ? (
        <>
          <circle className="learn-symbol__black" cx="32" cy="32" r="7" />
          <circle className="learn-symbol__mark" cx="32" cy="20" r="3" />
          <circle className="learn-symbol__mark" cx="20" cy="32" r="3" />
          <circle className="learn-symbol__mark" cx="44" cy="32" r="3" />
          <circle className="learn-symbol__mark" cx="32" cy="44" r="3" />
        </>
      ) : null}
      {id === "capture" ? (
        <>
          <circle className="learn-symbol__white" cx="32" cy="32" r="7" />
          <circle className="learn-symbol__black" cx="32" cy="20" r="6" />
          <circle className="learn-symbol__black" cx="20" cy="32" r="6" />
          <circle className="learn-symbol__black" cx="44" cy="32" r="6" />
          <circle className="learn-symbol__target" cx="32" cy="44" r="5" />
        </>
      ) : null}
      {id === "escape" ? (
        <>
          <circle className="learn-symbol__white" cx="32" cy="20" r="6" />
          <circle className="learn-symbol__white" cx="20" cy="32" r="6" />
          <circle className="learn-symbol__white" cx="44" cy="32" r="6" />
          <circle className="learn-symbol__black" cx="32" cy="32" r="7" />
          <circle className="learn-symbol__mark" cx="32" cy="44" r="5" />
        </>
      ) : null}
      {id === "connect" ? (
        <>
          <circle className="learn-symbol__black" cx="20" cy="32" r="7" />
          <circle className="learn-symbol__mark" cx="32" cy="32" r="6" />
          <circle className="learn-symbol__black" cx="44" cy="32" r="7" />
        </>
      ) : null}
      {id === "territory" ? (
        <>
          <circle className="learn-symbol__black" cx="32" cy="20" r="6" />
          <circle className="learn-symbol__black" cx="20" cy="32" r="6" />
          <circle className="learn-symbol__black" cx="44" cy="32" r="6" />
          <circle className="learn-symbol__black" cx="32" cy="44" r="6" />
          <rect className="learn-symbol__territory" height="10" rx="2" width="10" x="27" y="27" />
        </>
      ) : null}
    </svg>
  );
}

export function ChapterOne({ embedded = false, nextChapterLabel, onFinish }: { embedded?: boolean; nextChapterLabel?: string; onFinish?: () => void } = {}) {
  const { href, locale } = useI18n();
  const copy = chapterOneCopy(locale);
  const [activeId, setActiveId] = useState<ChapterOneLessonId>(CHAPTER_ONE_LESSON_IDS[0]);
  const [session, setSession] = useState<LessonSession>(() => initialSession(activeId));
  const [view, setView] = useState<"path" | "lesson">("path");
  const savedProgress = useSyncExternalStore(subscribeToProgress, progressSnapshot, serverProgressSnapshot);
  const completedIds = savedLessonIds(savedProgress);

  const activeIndex = CHAPTER_ONE_LESSONS.findIndex(({ id }) => id === activeId);
  const lesson = copy.lessons[activeId];
  const completionPercentage = Math.round((completedIds.length / CHAPTER_ONE_LESSONS.length) * 100);
  const allComplete = completedIds.length === CHAPTER_ONE_LESSONS.length;

  const selectLesson = (id: ChapterOneLessonId) => {
    setActiveId(id);
    setSession(initialSession(id));
    setView("lesson");
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
  const canRestart = session.hintVisible || session.feedback !== null || session.markedPositions.length > 0;
  const nextLessonIndex = CHAPTER_ONE_LESSONS.findIndex(({ id }) => !completedIds.includes(id));
  const currentPathIndex = nextLessonIndex === -1 ? CHAPTER_ONE_LESSONS.length - 1 : nextLessonIndex;

  return (
    <div className={embedded ? "learn-path" : "content-page learn-path"}>
      <section aria-labelledby="beginner-lesson-title" className="learn-chapter learn-course">
        {view === "path" ? (
          <div className="learn-map">
            <header className="learn-map__header">
              <span className="learn-map__chapter">{copy.chapterLabel}</span>
              <h1 className="product-page-title" id="beginner-lesson-title">{copy.title.replace(/[.!?。！？]+$/, "")}</h1>
              <p>{copy.description}</p>
              <div aria-label={`${copy.progressLabel}: ${completionPercentage}%`} className="learn-map__progress">
                <span aria-hidden="true"><i style={{ width: `${completionPercentage}%` }} /></span>
                <strong>{completedIds.length} / {CHAPTER_ONE_LESSONS.length}</strong>
              </div>
            </header>

            <nav aria-label={copy.lessonNavigation} className="learn-pathway">
              <svg aria-hidden="true" className="learn-pathway__line" preserveAspectRatio="none" viewBox="0 0 100 708">
                <path d="M30 59 C30 118 70 118 70 177 S30 236 30 295 S70 354 70 413 S30 472 30 531 S70 590 70 649" />
              </svg>
              {CHAPTER_ONE_LESSONS.map(({ id }, index) => {
                const complete = completedIds.includes(id);
                const unlocked = index === 0 || completedIds.includes(CHAPTER_ONE_LESSONS[index - 1].id);
                const current = index === currentPathIndex && !allComplete;
                return (
                  <div className={`learn-pathway__item${complete ? " is-complete" : ""}${current ? " is-current" : ""}${!unlocked ? " is-locked" : ""}`} key={id}>
                    <button
                      aria-current={current ? "step" : undefined}
                      aria-label={!unlocked ? `${copy.lessons[id].shortTitle}. ${copy.lockedLesson}` : undefined}
                      className="learn-node"
                      disabled={!unlocked}
                      onClick={() => selectLesson(id)}
                      type="button"
                    >
                      <span className="learn-node__tile">
                        <LessonPathIcon id={id} />
                      </span>
                      <span className="learn-node__copy">
                        <small>{copy.stepLabel} {String(index + 1).padStart(2, "0")}</small>
                        <strong>{copy.lessons[id].shortTitle}</strong>
                      </span>
                      {complete ? <span className="learn-node__status"><Check aria-hidden="true" size={16} /></span> : null}
                      {!unlocked ? <span className="learn-node__status"><Lock aria-hidden="true" size={14} /></span> : null}
                      {current ? <span aria-hidden="true" className="learn-node__label">{copy.lessons[id].shortTitle}<i /></span> : null}
                    </button>
                  </div>
                );
              })}
            </nav>

            {completedIds.length > 0 ? (
              <button
                className="learn-map__reset"
                onClick={() => {
                  saveProgress([]);
                  setActiveId(CHAPTER_ONE_LESSON_IDS[0]);
                  setSession(initialSession(CHAPTER_ONE_LESSON_IDS[0]));
                }}
                type="button"
              >
                <RotateCcw aria-hidden="true" size={14} /> {copy.resetProgress}
              </button>
            ) : null}

            {allComplete ? (
              <aside className="learn-chapter-complete">
                <Check aria-hidden="true" size={21} />
                <div><strong>{copy.chapterComplete}</strong><p>{copy.chapterCompleteBody}</p></div>
                <div className="learn-chapter-complete__actions">
                  {onFinish && nextChapterLabel ? (
                    <button className="button button--primary" onClick={onFinish} type="button">{nextChapterLabel} <ArrowRight aria-hidden="true" size={17} /></button>
                  ) : null}
                  <Link className="button button--secondary" href={href("/play?size=9")}>{copy.playNine} <ArrowRight aria-hidden="true" size={17} /></Link>
                </div>
              </aside>
            ) : null}
          </div>
        ) : (
          <article className="learn-lesson-focus">
            <header className="learn-lesson-focus__topbar">
              <button className="lesson-text-action" onClick={() => setView("path")} type="button">
                <ArrowLeft aria-hidden="true" size={17} /> {copy.backToPath}
              </button>
              <span>{copy.stepLabel} {activeIndex + 1} / {CHAPTER_ONE_LESSONS.length}</span>
            </header>

            <div className="learn-lesson-focus__intro">
              <span className="section-kicker">{copy.lessons[activeId].shortTitle}</span>
              <h1 id="beginner-lesson-title">{lesson.title.replace(/[.!?。！？]+$/, "")}</h1>
              <p>{lesson.instruction}</p>
            </div>

            <div className="learn-lesson-focus__workspace">
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

              <div className="learn-lesson-focus__controls">
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

                <footer className="learn-lesson-focus__next">
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
            </div>
          </article>
        )}
      </section>
    </div>
  );
}
