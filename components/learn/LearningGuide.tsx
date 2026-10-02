"use client";

import { ArrowLeft, Check, ChevronRight, Circle, Flag, Lock } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { formatLearn, learnUiCopy, LEARN_LESSONS, LEARN_STAGES, lessonById, line } from "@/lib/learn/curriculum";
import { completeLearnLesson, type LearnLessonId, type LearnProgress } from "@/lib/learn/progress";
import { LessonPlayer } from "./LessonPlayer";
import { useLearnProgress } from "./useLearnProgress";

function withOpenedLesson(progress: LearnProgress, lessonId: LearnLessonId, step: number): LearnProgress {
  return {
    ...progress,
    currentLessonId: lessonId,
    lastStepByLesson: { ...progress.lastStepByLesson, [lessonId]: step },
    updatedAt: new Date().toISOString(),
  };
}

export function LearningGuide() {
  const { locale } = useI18n();
  const { progress, loaded, commit } = useLearnProgress();
  const [activeLessonId, setActiveLessonId] = useState<LearnLessonId | null>(null);
  const [selectedStageId, setSelectedStageId] = useState<number | null>(null);
  const currentNode = useRef<HTMLButtonElement | null>(null);
  const autoScrolled = useRef(false);
  const copy = learnUiCopy(locale);

  const firstIncomplete = useMemo(() => (
    LEARN_LESSONS.find((lesson) => !progress.completedLessonIds.includes(lesson.id)) ?? LEARN_LESSONS.at(-1)!
  ), [progress.completedLessonIds]);
  const currentIndex = LEARN_LESSONS.findIndex((lesson) => lesson.id === firstIncomplete.id);
  const activeLesson = activeLessonId ? lessonById(activeLessonId) : null;
  const completedCount = progress.completedLessonIds.length;
  const percentage = Math.round((completedCount / LEARN_LESSONS.length) * 100);
  const selectedStage = LEARN_STAGES.find((stage) => stage.id === selectedStageId);
  const stageComplete = selectedStage ? progress.completedStages.includes(selectedStage.id) : false;
  const nextStage = selectedStage ? LEARN_STAGES.find((stage) => stage.id === selectedStage.id + 1) : null;
  const stageNext = selectedStage?.lessons.find((lesson) => !progress.completedLessonIds.includes(lesson.id));

  const openStage = (stageId: number) => {
    setSelectedStageId(stageId);
    autoScrolled.current = false;
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  useEffect(() => {
    if (!loaded || activeLessonId || !selectedStageId || autoScrolled.current || completedCount < 3) return;
    autoScrolled.current = true;
    window.requestAnimationFrame(() => currentNode.current?.scrollIntoView({ block: "center", behavior: "auto" }));
  }, [activeLessonId, completedCount, loaded, selectedStageId]);

  const openLesson = (lessonId: LearnLessonId) => {
    const index = LEARN_LESSONS.findIndex((lesson) => lesson.id === lessonId);
    const unlocked = progress.completedLessonIds.includes(lessonId) || index <= currentIndex;
    if (!loaded || !unlocked) return;
    commit((current) => withOpenedLesson(current, lessonId, current.lastStepByLesson[lessonId] ?? 0));
    setActiveLessonId(lessonId);
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  const rememberStep = useCallback((lessonId: LearnLessonId, step: number) => {
    commit((current) => {
      if (current.currentLessonId === lessonId && current.lastStepByLesson[lessonId] === step) return current;
      return withOpenedLesson(current, lessonId, step);
    });
  }, [commit]);

  const finishLesson = (lessonId: LearnLessonId, outcome?: "won" | "lost" | "completed") => {
    const lesson = lessonById(lessonId);
    commit((current) => completeLearnLesson(current, lessonId, lesson.stage, lesson.challenge ? outcome ?? "completed" : undefined));
    setActiveLessonId(null);
    autoScrolled.current = false;
    window.requestAnimationFrame(() => currentNode.current?.scrollIntoView({ block: "center", behavior: "smooth" }));
  };

  if (activeLesson) {
    return (
      <div className="content-page learn-experience">
        <LessonPlayer
          initialStep={progress.lastStepByLesson[activeLesson.id] ?? 0}
          lesson={activeLesson}
          locale={locale}
          onBack={() => setActiveLessonId(null)}
          onComplete={(outcome) => finishLesson(activeLesson.id, outcome)}
          onStep={(step) => rememberStep(activeLesson.id, step)}
        />
      </div>
    );
  }

  return (
    <div aria-busy={!loaded} className="content-page learn-experience learn-overview">
      {selectedStage ? <button className="learn-text-button learn-stage-back" onClick={() => setSelectedStageId(null)} type="button"><ArrowLeft aria-hidden="true" size={17} /> {copy.stages}</button> : null}
      <header className="learn-overview__header">
        <div>
          {selectedStage ? <small>{formatLearn(copy.stage, { stage: selectedStage.id })}</small> : null}
          <h1>{selectedStage ? line(selectedStage.title, locale) : copy.learn}</h1>
          <p>{formatLearn(copy.lessonsComplete, { done: selectedStage ? selectedStage.lessons.filter((lesson) => progress.completedLessonIds.includes(lesson.id)).length : completedCount, total: selectedStage ? selectedStage.lessons.length : LEARN_LESSONS.length })}</p>
        </div>
        {!selectedStage ? <div aria-label={`${percentage}%`} className="learn-overview__meter"><span style={{ width: `${percentage}%` }} /></div> : null}
      </header>

      {!selectedStage ? <div className="learn-stage-entries">
        {LEARN_STAGES.map((stage) => {
          const done = stage.lessons.filter((lesson) => progress.completedLessonIds.includes(lesson.id)).length;
          const unlocked = stage.id === 1 || progress.completedStages.includes(stage.id - 1);
          return <button className={`learn-stage-entry${stage.id === firstIncomplete.stage ? " is-current" : ""}`} disabled={!loaded || !unlocked} key={stage.id} onClick={() => openStage(stage.id)} type="button">
            <span className="learn-stage-entry__number">{progress.completedStages.includes(stage.id) ? <Check aria-label={copy.complete} size={22} /> : !unlocked ? <Lock aria-hidden="true" size={18} /> : stage.id}</span>
            <span><small>{formatLearn(copy.stage, { stage: stage.id })}</small><strong>{line(stage.title, locale)}</strong><small>{done} / {stage.lessons.length}</small></span>
            <ChevronRight aria-hidden="true" size={20} />
          </button>;
        })}
      </div> : null}

      {selectedStage ? <div className="learn-route">
          <section className="learn-stage" aria-label={line(selectedStage.title, locale)}>
            <svg aria-hidden="true" className="learn-route-track" preserveAspectRatio="none" viewBox={`0 0 360 ${selectedStage.lessons.length * 140}`}>
              <path d={selectedStage.lessons.map((_, index) => {
                const x = [180, 120, 180, 240][index % 4];
                const y = index * 140 + 32;
                if (index === 0) return `M ${x} ${y}`;
                const previousX = [180, 120, 180, 240][(index - 1) % 4];
                return `C ${previousX} ${y - 70}, ${x} ${y - 70}, ${x} ${y}`;
              }).join(" ")} />
            </svg>
            <ol className="learn-stage__nodes">
              {selectedStage.lessons.map((lesson, nodeIndex) => {
                const index = LEARN_LESSONS.findIndex((candidate) => candidate.id === lesson.id);
                const complete = progress.completedLessonIds.includes(lesson.id);
                const current = lesson.id === firstIncomplete.id;
                const unlocked = complete || index <= currentIndex;
                return (
                  <li className={`${complete ? "is-complete" : ""}${current ? " is-current" : ""}${!unlocked ? " is-locked" : ""}${lesson.challenge ? " is-challenge" : ""} learn-route-stop-${nodeIndex % 4}`} key={lesson.id}>
                    <button
                      aria-current={current ? "step" : undefined}
                      className="learn-route-node"
                      disabled={!loaded || !unlocked}
                      onClick={() => openLesson(lesson.id)}
                      ref={current ? currentNode : undefined}
                      type="button"
                    >
                      <span className="learn-route-node__mark">
                        {complete ? <Check aria-hidden="true" size={17} /> : !unlocked ? <Lock aria-hidden="true" size={14} /> : lesson.challenge ? <Flag aria-hidden="true" size={16} /> : <Circle aria-hidden="true" fill="currentColor" size={12} />}
                      </span>
                      <span className="learn-route-node__copy">
                        <strong>{line(lesson.title, locale)}</strong>
                        <small>{formatLearn(copy.minutes, { minutes: lesson.minutes })}{lesson.challenge ? ` · ${copy.checkpoint}` : ""}</small>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
      </div> : null}

      {!selectedStage ? <footer className="learn-future">
        <strong>{copy.later}</strong>
        <p>{copy.futureTopics}</p>
        <span>{copy.futureNote}</span>
      </footer> : null}

      <div className="learn-next-dock">
        <span className="learn-next-dock__lesson">
          <small>{stageComplete ? copy.complete : copy.continue}</small>
          <strong>{line(stageComplete && nextStage ? nextStage.title : (stageNext ?? firstIncomplete).title, locale)}</strong>
        </span>
        <button
          aria-label={`${!selectedStage ? copy.continueLearning : stageComplete ? nextStage ? copy.nextStage : copy.stages : copy.nextLesson}: ${line((stageNext ?? firstIncomplete).title, locale)}`}
          className="button button--primary learn-next-dock__button"
          disabled={!loaded}
          onClick={() => !selectedStage ? openStage(firstIncomplete.stage) : stageComplete ? nextStage ? openStage(nextStage.id) : setSelectedStageId(null) : openLesson((stageNext ?? firstIncomplete).id)}
          type="button"
        >
          {!selectedStage ? copy.continueLearning : stageComplete ? nextStage ? copy.nextStage : copy.stages : copy.nextLesson}
          <ChevronRight aria-hidden="true" size={20} />
        </button>
      </div>
    </div>
  );
}
