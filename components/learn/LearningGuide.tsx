"use client";

import { ArrowRight, Check, Lock } from "lucide-react";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { ADVANCED_CHAPTERS, LIFE_LESSON_IDS } from "@/lib/learn/advancedChapters";
import { CHAPTER_ONE_LESSON_IDS } from "@/lib/learn/chapterOne";
import { AdvancedChapter } from "./AdvancedChapter";
import { ChapterOne } from "./ChapterOne";

const CHAPTER_ONE_STORAGE_KEY = "gostone.learn.chapter-one.v3";
const PROGRESS_EVENT = "gostone:learn-progress";

type ChapterNumber = 1 | 2 | 3;

function subscribeToProgress(onStoreChange: () => void) {
  const handleProgress = () => onStoreChange();
  window.addEventListener("storage", handleProgress);
  window.addEventListener(PROGRESS_EVENT, handleProgress);
  return () => {
    window.removeEventListener("storage", handleProgress);
    window.removeEventListener(PROGRESS_EVENT, handleProgress);
  };
}

function parseCompleted(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : []);
  } catch {
    return new Set();
  }
}

export function LearningGuide() {
  const { dictionary, href, locale } = useI18n();
  const [activeChapter, setActiveChapter] = useState<ChapterNumber>(1);
  const snapshot = useSyncExternalStore(
    subscribeToProgress,
    () => JSON.stringify([
      window.localStorage.getItem(CHAPTER_ONE_STORAGE_KEY),
      window.localStorage.getItem(ADVANCED_CHAPTERS.life.storageKey),
      window.localStorage.getItem(ADVANCED_CHAPTERS.tactics.storageKey),
    ]),
    () => "[null,null,null]",
  );
  const [chapterOneRaw, chapterTwoRaw, chapterThreeRaw] = JSON.parse(snapshot) as Array<string | null>;
  const chapterOneComplete = CHAPTER_ONE_LESSON_IDS.every((id) => parseCompleted(chapterOneRaw).has(id));
  const chapterTwoComplete = LIFE_LESSON_IDS.every((id) => parseCompleted(chapterTwoRaw).has(id));
  const chapterThreeComplete = parseCompleted(chapterThreeRaw).size === ADVANCED_CHAPTERS.tactics.lessons.length;
  const german = locale === "de";
  const labels = german
    ? ["Grundlagen", "Leben & Tod", "Fangen & Kämpfen"]
    : ["Basics", "Life & death", "Capture & fight"];
  const chapterStates = [true, chapterOneComplete, chapterTwoComplete] as const;
  const completedStates = [chapterOneComplete, chapterTwoComplete, chapterThreeComplete] as const;

  return (
    <div className="content-page learn-path learning-guide">
      <section className="learn-practice-entry">
        <div>
          <strong>{dictionary.trainingGame.launchTitle}</strong>
          <span>{dictionary.trainingGame.launchDescription}</span>
        </div>
        <Link className="button button--primary button--sm" href={href("/learn/ai")}>
          {dictionary.trainingGame.launchAction} <ArrowRight aria-hidden="true" size={15} />
        </Link>
      </section>
      <nav aria-label={labels.join(", ")} className="learning-chapters">
        {labels.map((label, index) => {
          const number = (index + 1) as ChapterNumber;
          const unlocked = chapterStates[index];
          const complete = completedStates[index];
          return (
            <button
              aria-current={activeChapter === number ? "page" : undefined}
              aria-label={`${german ? "Kapitel" : "Chapter"} ${number}: ${label}${!unlocked ? german ? ". Gesperrt" : ". Locked" : ""}`}
              className={`learning-chapters__item${activeChapter === number ? " is-active" : ""}${complete ? " is-complete" : ""}`}
              disabled={!unlocked}
              key={number}
              onClick={() => setActiveChapter(number)}
              type="button"
            >
              <span>{complete ? <Check aria-hidden="true" size={16} /> : !unlocked ? <Lock aria-hidden="true" size={14} /> : number}</span>
              <strong>{label}</strong>
            </button>
          );
        })}
      </nav>

      {activeChapter === 1 ? (
        <ChapterOne embedded nextChapterLabel={german ? "Weiter zu Kapitel 2" : "Continue to chapter 2"} onFinish={() => setActiveChapter(2)} />
      ) : null}
      {activeChapter === 2 && chapterOneComplete ? (
        <AdvancedChapter chapterId="life" onFinish={() => setActiveChapter(3)} />
      ) : null}
      {activeChapter === 3 && chapterTwoComplete ? <AdvancedChapter chapterId="tactics" /> : null}
    </div>
  );
}
