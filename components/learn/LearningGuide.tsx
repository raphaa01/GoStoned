"use client";

import { ArrowDownToLine, BookOpen, Check, ChevronRight, Flag, Grid2X2, Layers3, Link2, Lock, Map, Play, ScanLine, Sparkles, Swords } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useAuth } from "@/components/auth/AuthProvider";
import { developerCopy } from "@/lib/i18n/developer";
import { canOpenLearnLesson } from "@/lib/learn/access";
import { formatLearn, learnUiCopy, LEARN_LESSONS, LEARN_STAGES, lessonById, line } from "@/lib/learn/curriculum";
import { completeLearnLesson, learnStepBookmark, type LearnLessonId, type LearnProgress, type LearnStepBookmark } from "@/lib/learn/progress";
import { LessonPlayer } from "./LessonPlayer";
import { useLearnProgress } from "./useLearnProgress";

const stageIcons = [Grid2X2, BookOpen, Link2, Swords, Flag, ScanLine, Map, Sparkles];

function withOpenedLesson(progress: LearnProgress, lessonId: LearnLessonId, step: LearnStepBookmark): LearnProgress {
  return {
    ...progress,
    currentLessonId: lessonId,
    lastStepByLesson: { ...progress.lastStepByLesson, [lessonId]: step },
    updatedAt: new Date().toISOString(),
  };
}

export function LearningGuide() {
  const { locale } = useI18n();
  const { user, loading: authLoading, error: authError } = useAuth();
  const developerAccess = !authLoading && !authError && user?.developerAccess === true;
  const { progress, loaded, commit } = useLearnProgress();
  const [activeLessonId, setActiveLessonId] = useState<LearnLessonId | null>(null);
  const currentNode = useRef<HTMLButtonElement | null>(null);
  const lastScrollTarget = useRef<string | null>(null);
  const copy = learnUiCopy(locale);

  const completedIds = new Set(progress.completedLessonIds);
  const firstIncomplete = LEARN_LESSONS.find((lesson) => !completedIds.has(lesson.id)) ?? LEARN_LESSONS.at(-1)!;
  const currentIndex = LEARN_LESSONS.findIndex((lesson) => lesson.id === firstIncomplete.id);
  const activeLesson = activeLessonId && canOpenLearnLesson(
    completedIds.has(activeLessonId),
    LEARN_LESSONS.findIndex((lesson) => lesson.id === activeLessonId),
    currentIndex,
    developerAccess,
  ) ? lessonById(activeLessonId) : null;
  const completedCount = progress.completedLessonIds.length;
  const allDone = completedCount === LEARN_LESSONS.length;
  const percentage = Math.round((completedCount / LEARN_LESSONS.length) * 100);

  useEffect(() => {
    if (!loaded || activeLessonId || lastScrollTarget.current === firstIncomplete.id) return;
    const frame = window.requestAnimationFrame(() => {
      if (lastScrollTarget.current !== null || firstIncomplete.id !== LEARN_LESSONS[0].id) {
        currentNode.current?.scrollIntoView({ block: "center", behavior: "instant" });
      }
      lastScrollTarget.current = firstIncomplete.id;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeLessonId, loaded, firstIncomplete.id]);

  const openLesson = (lessonId: LearnLessonId) => {
    const index = LEARN_LESSONS.findIndex((lesson) => lesson.id === lessonId);
    const unlocked = canOpenLearnLesson(completedIds.has(lessonId), index, currentIndex, developerAccess);
    if (!loaded || !unlocked) return;
    commit((current) => withOpenedLesson(current, lessonId, current.lastStepByLesson[lessonId] ?? learnStepBookmark(lessonId, 0, lessonById(lessonId).steps[0].id)));
    setActiveLessonId(lessonId);
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  const rememberStep = useCallback((lessonId: LearnLessonId, step: number) => {
    const bookmark = learnStepBookmark(lessonId, step, lessonById(lessonId).steps[step].id);
    commit((current) => {
      if (current.currentLessonId === lessonId && current.lastStepByLesson[lessonId] === bookmark) return current;
      return withOpenedLesson(current, lessonId, bookmark);
    });
  }, [commit]);

  const finishLesson = (lessonId: LearnLessonId, outcome?: "won" | "lost" | "completed") => {
    const lesson = lessonById(lessonId);
    commit((current) => completeLearnLesson(current, lessonId, lesson.stage, lesson.challenge ? outcome ?? "completed" : undefined));
    setActiveLessonId(null);
    lastScrollTarget.current = null;
  };

  if (activeLesson) {
    const bookmark = progress.lastStepByLesson[activeLesson.id];
    const initialStep = typeof bookmark === "string"
      ? Math.max(0, activeLesson.steps.findIndex((step) => step.id === bookmark))
      : bookmark ?? 0;
    return (
      <div className="content-page learn-experience">
        <LessonPlayer
          initialStep={initialStep}
          lesson={activeLesson}
          locale={locale}
          onBack={() => {
            lastScrollTarget.current = null;
            setActiveLessonId(null);
          }}
          onComplete={(outcome) => finishLesson(activeLesson.id, outcome)}
          onAttempt={(outcome) => commit((current) => completeLearnLesson(current, activeLesson.id, activeLesson.stage, outcome))}
          onStep={(step) => rememberStep(activeLesson.id, step)}
        />
      </div>
    );
  }

  return (
    <div aria-busy={!loaded} className="content-page learn-experience learn-overview">
      <header className="learn-overview__header">
        <div className="learn-overview__title"><Layers3 aria-hidden="true" size={22} /><h1>{copy.learn}</h1></div>
        <div className="learn-overview__progress">
          <p>{formatLearn(copy.lessonsComplete, { done: completedCount, total: LEARN_LESSONS.length })}</p>
          <div aria-hidden="true" className="learn-overview__meter"><span style={{ width: `${percentage}%` }} /></div>
        </div>
        {developerAccess ? <p className="learn-developer-access">{developerCopy(locale).learningAccess}</p> : null}
        <nav aria-label={copy.stageNavigation} className="learn-stage-index">
          {LEARN_STAGES.map((stage) => (
            <a
              aria-current={stage.id === firstIncomplete.stage ? "location" : undefined}
              aria-label={formatLearn(copy.stageLink, { stage: stage.id, title: line(stage.title, locale) })}
              className={progress.completedStages.includes(stage.id) ? "is-complete" : undefined}
              href={`#learn-stage-${stage.id}`}
              key={stage.id}
              title={line(stage.title, locale)}
            >
              {stage.id}
              {progress.completedStages.includes(stage.id) ? <Check aria-hidden="true" size={12} /> : null}
            </a>
          ))}
        </nav>
      </header>

      <div className="learn-route">
        {LEARN_STAGES.map((stage) => {
          const done = stage.lessons.filter((lesson) => completedIds.has(lesson.id)).length;
          const stageUnlocked = developerAccess || stage.id === 1 || progress.completedStages.includes(stage.id - 1);
          const StageIcon = stageIcons[stage.id - 1];
          return (
            <section
              aria-labelledby={`learn-stage-heading-${stage.id}`}
              className={stageUnlocked ? "learn-path-stage" : "learn-path-stage is-locked"}
              id={`learn-stage-${stage.id}`}
              key={stage.id}
            >
              <header className="learn-path-stage__header">
                <span aria-hidden="true" className="learn-path-stage__icon"><StageIcon size={23} /></span>
                <div>
                  <small>{formatLearn(copy.stage, { stage: stage.id })}</small>
                  <h2 id={`learn-stage-heading-${stage.id}`}>{line(stage.title, locale)}</h2>
                </div>
                <span className="learn-path-stage__count">
                  {!stageUnlocked ? <Lock aria-hidden="true" size={13} /> : done === stage.lessons.length ? <Check aria-hidden="true" size={15} /> : null}
                  {done}/{stage.lessons.length}
                </span>
              </header>
              <ol className="learn-stage__nodes">
                {stage.lessons.map((lesson) => {
                  const index = LEARN_LESSONS.indexOf(lesson);
                  const complete = completedIds.has(lesson.id);
                  const current = !allDone && lesson.id === firstIncomplete.id;
                  const unlocked = canOpenLearnLesson(complete, index, currentIndex, developerAccess);
                  const StopIcon = complete ? Check : current ? Play : !unlocked ? Lock : lesson.challenge ? Flag : BookOpen;
                  return (
                    <li className={complete ? "is-complete" : current ? "is-current" : !unlocked ? "is-locked" : undefined} key={lesson.id}>
                      <button
                        aria-current={current ? "step" : undefined}
                        className="learn-route-node"
                        disabled={!loaded || !unlocked}
                        onClick={() => openLesson(lesson.id)}
                        ref={lesson.id === firstIncomplete.id ? currentNode : undefined}
                        type="button"
                      >
                        <span className="learn-route-node__mark"><StopIcon aria-hidden="true" size={18} /></span>
                        <span className="learn-route-node__copy">
                          <strong>{line(lesson.title, locale)}</strong>
                          {current ? <small>{copy.upNext}</small> : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </section>
          );
        })}
      </div>

      <div className="learn-next-dock">
        <button aria-label={copy.showCurrentLesson} className="learn-next-dock__locate" disabled={!loaded} onClick={() => currentNode.current?.scrollIntoView({ block: "center" })} title={copy.showCurrentLesson} type="button">
          <ArrowDownToLine aria-hidden="true" size={19} />
        </button>
        <span className="learn-next-dock__lesson">
          <small>{allDone ? copy.allStagesComplete : formatLearn(copy.stage, { stage: firstIncomplete.stage })}</small>
          <strong>{line(firstIncomplete.title, locale)}</strong>
        </span>
        <button
          aria-label={`${copy.continueLearning}: ${line(firstIncomplete.title, locale)}`}
          className="button button--primary learn-next-dock__button"
          disabled={!loaded}
          onClick={() => openLesson(firstIncomplete.id)}
          type="button"
        >
          {copy.continueLearning}
          <ChevronRight aria-hidden="true" size={20} />
        </button>
      </div>
      {allDone ? <nav className="learn-game__actions" aria-label={copy.ownGameLearning}>{["play","review","puzzles"].map((path)=><a className="button button--secondary" href={`/${locale}/${path}`} key={path}>{path === "play" ? copy.playGame : path === "review" ? copy.reviewOwnGame : copy.boardPuzzles}</a>)}</nav> : null}
    </div>
  );
}
