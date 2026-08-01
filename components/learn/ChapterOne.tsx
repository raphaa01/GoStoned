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
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { Position } from "@/lib/game/types";
import {
  CHAPTER_ONE_LESSON_IDS,
  CHAPTER_ONE_LESSONS,
  chapterOneCopy,
  GOAL_CLOSING_MOVE,
  GOAL_POSITION,
  INTERSECTION_TARGET,
  LESSON_BOARD_SIZE,
  LESSON_SETUPS,
  REGION_EXERCISES,
  replaceLessonTokens,
  sameLessonPosition,
  SURROUND_DISTRACTOR,
  type ChapterOneLessonId,
  type LessonStone,
} from "@/lib/learn/chapterOne";
import { LessonBoard } from "./LessonBoard";

const STORAGE_KEY = "gostone.learn.chapter-one.v1";
const PROGRESS_EVENT = "gostone:learn-progress";

const LESSON_ICONS = [Goal, CircleDot, MousePointer2, Anchor, Focus, Grid3X3] as const;

type FeedbackTone = "idle" | "progress" | "wrong" | "success";

type LessonSession = {
  stones: LessonStone[];
  step: number;
  completed: boolean;
  hintVisible: boolean;
  feedbackTone: FeedbackTone;
  feedback: string | null;
};

function initialSession(id: ChapterOneLessonId): LessonSession {
  return {
    stones: LESSON_SETUPS[id].map((stone) => ({ ...stone })),
    step: 0,
    completed: false,
    hintVisible: false,
    feedbackTone: "idle",
    feedback: null,
  };
}

function firstFreeWhiteReply(stones: readonly LessonStone[], move: Position): Position | null {
  const occupied = new Set(stones.map(({ x, y }) => `${x}:${y}`));
  const candidates: Position[] = [
    { x: LESSON_BOARD_SIZE - 1 - move.x, y: LESSON_BOARD_SIZE - 1 - move.y },
    { x: 6, y: 6 }, { x: 5, y: 5 }, { x: 6, y: 5 }, { x: 5, y: 6 },
    { x: 4, y: 6 }, { x: 6, y: 4 }, { x: 0, y: 6 }, { x: 6, y: 0 },
  ];
  return candidates.find(({ x, y }) => !occupied.has(`${x}:${y}`)) ?? null;
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
      setSession((current) => ({ ...current, feedbackTone: "wrong", feedback: copy.occupiedPoint }));
      return;
    }

    if (activeId === "goal" || activeId === "surround") {
      if (!sameLessonPosition(position, GOAL_CLOSING_MOVE)) {
        setSession((current) => ({ ...current, feedbackTone: "wrong", feedback: copy.feedbackWrong }));
        return;
      }
      completeLesson({
        ...session,
        stones: [...session.stones, { ...position, color: "black" }],
      });
      return;
    }

    if (activeId === "intersections") {
      if (!sameLessonPosition(position, INTERSECTION_TARGET)) {
        setSession((current) => ({ ...current, feedbackTone: "wrong", feedback: copy.feedbackWrong }));
        return;
      }
      completeLesson({
        ...session,
        stones: [{ ...position, color: "black" }],
      });
      return;
    }

    if (activeId === "turns") {
      const blackStones: LessonStone[] = [...session.stones, { ...position, color: "black" }];
      const whiteReply = firstFreeWhiteReply(blackStones, position);
      const stones = whiteReply
        ? [...blackStones, { ...whiteReply, color: "white" as const }]
        : blackStones;
      const nextCount = session.step + 1;
      const nextSession = { ...session, stones, step: nextCount };
      if (nextCount === 3) {
        completeLesson(nextSession);
      } else {
        setSession({
          ...nextSession,
          feedbackTone: "progress",
          feedback: replaceLessonTokens(copy.turnProgress, { count: nextCount }),
        });
      }
      return;
    }

    if (activeId === "stones-stay") {
      const nextCount = session.step + 1;
      const nextSession = {
        ...session,
        stones: [...session.stones, { ...position, color: "black" as const }],
        step: nextCount,
      };
      if (nextCount === 2) {
        completeLesson(nextSession);
      } else {
        setSession({ ...nextSession, feedbackTone: "progress", feedback: copy.feedbackProgress });
      }
      return;
    }

    const region = REGION_EXERCISES[session.step];
    if (!region || !region.required.some((required) => sameLessonPosition(required, position))) {
      setSession((current) => ({ ...current, feedbackTone: "wrong", feedback: copy.feedbackWrong }));
      return;
    }

    const stones = [...session.stones, { ...position, color: "black" as const }];
    const placedCount = region.required.filter((required) => (
      stones.some((stone) => sameLessonPosition(stone, required))
    )).length;
    if (placedCount === region.required.length && session.step === REGION_EXERCISES.length - 1) {
      completeLesson({ ...session, stones });
      return;
    }
    if (placedCount === region.required.length) {
      const nextRegionIndex = session.step + 1;
      const nextRegion = REGION_EXERCISES[nextRegionIndex];
      const regionName = [copy.regionCorner, copy.regionSide, copy.regionCenter][nextRegionIndex];
      setSession({
        ...session,
        stones,
        step: nextRegionIndex,
        feedbackTone: "progress",
        feedback: replaceLessonTokens(copy.regionProgress, {
          region: regionName,
          count: 0,
          total: nextRegion.required.length,
        }),
      });
      return;
    }

    const regionName = [copy.regionCorner, copy.regionSide, copy.regionCenter][session.step];
    setSession({
      ...session,
      stones,
      feedbackTone: "progress",
      feedback: replaceLessonTokens(copy.regionProgress, {
        region: regionName,
        count: placedCount,
        total: region.required.length,
      }),
    });
  };

  const boardDecorations = useMemo(() => {
    const hintPositions: Position[] = [];
    const choicePositions: Position[] = [];
    const territoryTargets: Position[] = [];
    const ownedTerritory: Position[] = [];

    if (activeId === "goal" || activeId === "surround") {
      territoryTargets.push(GOAL_POSITION);
      if (session.completed) ownedTerritory.push(GOAL_POSITION);
      if (session.hintVisible) hintPositions.push(GOAL_CLOSING_MOVE);
    }
    if (activeId === "surround") choicePositions.push(GOAL_CLOSING_MOVE, SURROUND_DISTRACTOR);
    if (activeId === "intersections") hintPositions.push(INTERSECTION_TARGET);
    if (activeId === "board-regions") {
      const region = REGION_EXERCISES[session.step] ?? REGION_EXERCISES.at(-1);
      if (region) {
        territoryTargets.push(region.target);
        if (session.hintVisible) {
          hintPositions.push(...region.required.filter((position) => (
            !session.stones.some((stone) => sameLessonPosition(stone, position))
          )));
        }
      }
      for (const completedRegion of REGION_EXERCISES.slice(0, session.step)) {
        ownedTerritory.push(completedRegion.target);
      }
      if (session.completed) ownedTerritory.push(REGION_EXERCISES.at(-1)!.target);
    }

    return { hintPositions, choicePositions, territoryTargets, ownedTerritory };
  }, [activeId, session]);

  const feedback = session.feedback ?? copy.feedbackIdle;
  const nextId = CHAPTER_ONE_LESSONS[activeIndex + 1]?.id;
  const previousId = CHAPTER_ONE_LESSONS[activeIndex - 1]?.id;

  return (
    <div className="content-page learn-path">
      <header className="content-hero learn-path__hero">
        <span className="section-kicker"><Sparkles aria-hidden="true" size={14} /> {copy.kicker}</span>
        <h1>{copy.title}</h1>
        <p>{copy.description}</p>
        <div className="learn-path__chapter-meta">
          <strong>{copy.chapterLabel}</strong>
          <span>{CHAPTER_ONE_LESSONS.length} {copy.lessonsLabel}</span>
          <span>{CHAPTER_ONE_LESSONS.reduce((sum, item) => sum + item.minutes, 0)} {copy.minuteLabel}</span>
        </div>
      </header>

      <section aria-labelledby="chapter-one-title" className="learn-chapter">
        <header className="learn-chapter__header">
          <div>
            <span className="section-kicker">{copy.chapterLabel}</span>
            <h2 id="chapter-one-title">{lesson.title}</h2>
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
        </header>

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

        <article className="lesson-workspace" ref={workspaceRef}>
          <div className="lesson-workspace__board-panel">
            <header>
              <div>
                <strong>{copy.boardLabel}</strong>
                <span>{copy.boardContext}</span>
              </div>
              <span className="lesson-turn"><i aria-hidden="true" /> {copy.blackToPlay}</span>
            </header>
            <LessonBoard
              choicePositions={boardDecorations.choicePositions}
              copy={copy}
              disabled={session.completed}
              hintPositions={boardDecorations.hintPositions}
              onPlay={handlePlay}
              ownedTerritory={boardDecorations.ownedTerritory}
              size={LESSON_BOARD_SIZE}
              stones={session.stones}
              territoryTargets={boardDecorations.territoryTargets}
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
