"use client";

import { ArrowLeft, ArrowRight, Check, Lightbulb, Lock, RotateCcw } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { Position } from "@/lib/game/types";
import {
  ADVANCED_CHAPTERS,
  advancedChapterCopy,
  type AdvancedChapterId,
  type AdvancedLesson,
  type AdvancedLessonId,
} from "@/lib/learn/advancedChapters";
import {
  chapterOneCopy,
  lessonPositionKey,
  sameLessonPosition,
  type LessonStone,
} from "@/lib/learn/chapterOne";
import { LessonBoard } from "./LessonBoard";

const PROGRESS_EVENT = "gostone:learn-progress";

type AdvancedChapterProps = {
  chapterId: AdvancedChapterId;
  onFinish?: () => void;
};

type LessonSession = {
  stones: LessonStone[];
  markedPositions: Position[];
  completed: boolean;
  hintVisible: boolean;
  feedback: string | null;
  feedbackTone: "wrong" | "success" | null;
};

function initialSession(lesson: AdvancedLesson): LessonSession {
  return {
    stones: lesson.stones.map((stone) => ({ ...stone })),
    markedPositions: [],
    completed: false,
    hintVisible: false,
    feedback: null,
    feedbackTone: null,
  };
}

function savedIds(raw: string | null, lessons: readonly AdvancedLesson[]): AdvancedLessonId[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    const validIds = new Set(lessons.map(({ id }) => id));
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((value): value is AdvancedLessonId => typeof value === "string" && validIds.has(value as AdvancedLessonId)))]
      : [];
  } catch {
    return [];
  }
}

function subscribeToProgress(onStoreChange: () => void) {
  const handleStorage = () => onStoreChange();
  window.addEventListener("storage", handleStorage);
  window.addEventListener(PROGRESS_EVENT, handleStorage);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(PROGRESS_EVENT, handleStorage);
  };
}

function saveProgress(storageKey: string, ids: readonly AdvancedLessonId[]) {
  window.localStorage.setItem(storageKey, JSON.stringify(ids));
  window.dispatchEvent(new Event(PROGRESS_EVENT));
}

function LessonPreviewIcon({ lesson }: { lesson: AdvancedLesson }) {
  const inset = 9;
  const span = 46;
  const coordinate = (value: number) => inset + (value / (lesson.size - 1)) * span;
  return (
    <svg aria-hidden="true" className="learn-concept-preview" viewBox="0 0 64 64">
      {Array.from({ length: lesson.size }, (_, index) => (
        <path
          className="learn-concept-preview__line"
          d={`M${coordinate(index)} ${inset}V${inset + span}M${inset} ${coordinate(index)}H${inset + span}`}
          key={`line-${index}`}
        />
      ))}
      {lesson.stones.map((stone) => (
        <circle
          className={`learn-concept-preview__stone is-${stone.color}`}
          cx={coordinate(stone.x)}
          cy={coordinate(stone.y)}
          key={lessonPositionKey(stone)}
          r={lesson.size === 7 ? 3.4 : 4.7}
        />
      ))}
    </svg>
  );
}
export function AdvancedChapter({ chapterId, onFinish }: AdvancedChapterProps) {
  const { locale } = useI18n();
  const chapter = ADVANCED_CHAPTERS[chapterId];
  const copy = advancedChapterCopy(chapterId, locale);
  const boardCopy = chapterOneCopy(locale);
  const [activeId, setActiveId] = useState<AdvancedLessonId>(chapter.lessons[0].id);
  const activeIndex = chapter.lessons.findIndex(({ id }) => id === activeId);
  const activeLesson = chapter.lessons[activeIndex] ?? chapter.lessons[0];
  const lessonText = copy.lessons[activeLesson.id];
  const [session, setSession] = useState<LessonSession>(() => initialSession(activeLesson));
  const [view, setView] = useState<"path" | "lesson">("path");
  const progressSnapshot = useSyncExternalStore(
    subscribeToProgress,
    () => window.localStorage.getItem(chapter.storageKey) ?? "[]",
    () => "[]",
  );
  const completedIds = savedIds(progressSnapshot, chapter.lessons);
  const completionPercentage = Math.round((completedIds.length / chapter.lessons.length) * 100);
  const allComplete = completedIds.length === chapter.lessons.length;
  const firstIncompleteIndex = chapter.lessons.findIndex(({ id }) => !completedIds.includes(id));
  const currentPathIndex = firstIncompleteIndex === -1 ? chapter.lessons.length - 1 : firstIncompleteIndex;
  const nextLesson = chapter.lessons[activeIndex + 1];

  const selectLesson = (lesson: AdvancedLesson) => {
    setActiveId(lesson.id);
    setSession(initialSession(lesson));
    setView("lesson");
  };

  const completeLesson = (nextSession: LessonSession) => {
    setSession({ ...nextSession, completed: true, feedback: lessonText.success, feedbackTone: "success" });
    if (!completedIds.includes(activeLesson.id)) saveProgress(chapter.storageKey, [...completedIds, activeLesson.id]);
  };

  const handlePlay = (position: Position) => {
    if (session.completed) return;
    const isTarget = activeLesson.targets.some((target) => sameLessonPosition(target, position));
    if (!isTarget) {
      setSession((current) => ({ ...current, feedback: lessonText.wrong, feedbackTone: "wrong" }));
      return;
    }

    if (activeLesson.mode === "mark") {
      if (session.markedPositions.some((marked) => sameLessonPosition(marked, position))) return;
      const markedPositions = [...session.markedPositions, position];
      const nextSession = { ...session, markedPositions };
      if (markedPositions.length === activeLesson.targets.length) completeLesson(nextSession);
      else setSession(nextSession);
      return;
    }

    const removeKeys = new Set((activeLesson.remove ?? []).map(lessonPositionKey));
    const stones = session.stones.filter((stone) => !removeKeys.has(lessonPositionKey(stone)));
    completeLesson({
      ...session,
      stones: [...stones, { ...position, color: activeLesson.toPlay }],
    });
  };

  const canRestart = session.hintVisible || session.feedback !== null || session.markedPositions.length > 0;
  const hintPositions = session.hintVisible
    ? activeLesson.targets.filter((target) => !session.markedPositions.some((marked) => sameLessonPosition(marked, target)))
    : [];

  return (
    <section aria-labelledby={`${chapterId}-chapter-title`} className="learn-chapter learn-course">
      {view === "path" ? (
        <div className="learn-map">
          <header className="learn-map__header">
            <span className="learn-map__chapter">{copy.chapterLabel}</span>
            <h1 className="product-page-title" id={`${chapterId}-chapter-title`}>{copy.title.replace(/[.!?]+$/, "")}</h1>
            <p>{copy.description}</p>
            <div aria-label={`${copy.progressLabel}: ${completionPercentage}%`} className="learn-map__progress">
              <span aria-hidden="true"><i style={{ width: `${completionPercentage}%` }} /></span>
              <strong>{completedIds.length} / {chapter.lessons.length}</strong>
            </div>
          </header>

          <nav aria-label={copy.lessonNavigation} className="learn-pathway">
            <svg aria-hidden="true" className="learn-pathway__line" preserveAspectRatio="none" viewBox="0 0 100 708">
              <path d="M30 59 C30 118 70 118 70 177 S30 236 30 295 S70 354 70 413 S30 472 30 531 S70 590 70 649" />
            </svg>
            {chapter.lessons.map((lesson, index) => {
              const complete = completedIds.includes(lesson.id);
              const unlocked = index === 0 || completedIds.includes(chapter.lessons[index - 1].id);
              const current = index === currentPathIndex && !allComplete;
              return (
                <div className={`learn-pathway__item${complete ? " is-complete" : ""}${current ? " is-current" : ""}${!unlocked ? " is-locked" : ""}`} key={lesson.id}>
                  <button
                    aria-current={current ? "step" : undefined}
                    aria-label={`${copy.lessons[lesson.id].shortTitle}${!unlocked ? `. ${copy.lockedLesson}` : ""}`}
                    className="learn-node"
                    disabled={!unlocked}
                    onClick={() => selectLesson(lesson)}
                    type="button"
                  >
                    <span className="learn-node__tile"><LessonPreviewIcon lesson={lesson} /></span>
                    <span className="learn-node__copy">
                      <small>{copy.stepLabel} {String(index + 1).padStart(2, "0")}</small>
                      <strong>{copy.lessons[lesson.id].shortTitle}</strong>
                    </span>
                    {complete ? <span className="learn-node__status"><Check aria-hidden="true" size={16} /></span> : null}
                    {!unlocked ? <span className="learn-node__status"><Lock aria-hidden="true" size={14} /></span> : null}
                    {current ? <span aria-hidden="true" className="learn-node__label">{copy.lessons[lesson.id].shortTitle}<i /></span> : null}
                  </button>
                </div>
              );
            })}
          </nav>

          {completedIds.length > 0 ? (
            <button
              className="learn-map__reset"
              onClick={() => {
                saveProgress(chapter.storageKey, []);
                setActiveId(chapter.lessons[0].id);
                setSession(initialSession(chapter.lessons[0]));
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
              {onFinish ? <button className="button button--secondary" onClick={onFinish} type="button">{copy.finishChapter} <ArrowRight aria-hidden="true" size={17} /></button> : null}
            </aside>
          ) : null}
        </div>
      ) : (
        <article className="learn-lesson-focus">
          <header className="learn-lesson-focus__topbar">
            <button className="lesson-text-action" onClick={() => setView("path")} type="button">
              <ArrowLeft aria-hidden="true" size={17} /> {copy.backToPath}
            </button>
            <span>{copy.stepLabel} {activeIndex + 1} / {chapter.lessons.length}</span>
          </header>

          <div className="learn-lesson-focus__intro">
            <span className="section-kicker">{lessonText.shortTitle}</span>
            <h1 id={`${chapterId}-chapter-title`}>{lessonText.title.replace(/[.!?]+$/, "")}</h1>
            <p>{lessonText.instruction}</p>
          </div>

          <div className="learn-lesson-focus__workspace">
            <div className="lesson-workspace__board-panel">
              <header>
                <span>{boardCopy.boardLabel}</span>
                <strong className="lesson-turn"><i className={activeLesson.toPlay === "white" ? "is-white" : undefined} aria-hidden="true" /> {activeLesson.toPlay === "black" ? copy.blackToPlay : copy.whiteToPlay}</strong>
              </header>
              <LessonBoard
                copy={boardCopy}
                disabled={session.completed}
                hintPositions={hintPositions}
                markedPositions={session.markedPositions}
                onPlay={handlePlay}
                size={activeLesson.size}
                stones={session.stones}
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
                <div className="lesson-hint"><Lightbulb aria-hidden="true" size={16} /><p>{lessonText.hint}</p></div>
              ) : null}

              <div className="lesson-actions">
                {!session.completed ? (
                  <button className="lesson-text-action" onClick={() => setSession((current) => ({ ...current, hintVisible: !current.hintVisible }))} type="button">
                    <Lightbulb aria-hidden="true" size={15} /> {session.hintVisible ? copy.hideHint : copy.hint}
                  </button>
                ) : null}
                {canRestart ? (
                  <button className="lesson-text-action" onClick={() => setSession(initialSession(activeLesson))} type="button">
                    <RotateCcw aria-hidden="true" size={15} /> {copy.restartLesson}
                  </button>
                ) : null}
              </div>

              <footer className="learn-lesson-focus__next">
                {nextLesson ? (
                  <button className="button button--primary" disabled={!session.completed} onClick={() => selectLesson(nextLesson)} type="button">
                    {copy.nextLesson} <ArrowRight aria-hidden="true" size={17} />
                  </button>
                ) : (
                  <button className="button button--primary" disabled={!session.completed} onClick={() => setView("path")} type="button">
                    {copy.finishChapter} <ArrowRight aria-hidden="true" size={17} />
                  </button>
                )}
              </footer>
            </div>
          </div>
        </article>
      )}
    </section>
  );
}
