"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useAccountFeatureHref } from "@/components/auth/useAccountFeatureHref";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useLearnProgress } from "@/components/learn/useLearnProgress";
import { getMobileCopy } from "@/lib/i18n/mobile";
import { getTournamentsCopy } from "@/lib/i18n/tournaments";
import { LEARN_LESSON_IDS } from "@/lib/learn/progress";
import { TournamentStone } from "./TournamentStone";

export function HomeShortcuts() {
  const { href, locale } = useI18n();
  const copy = getMobileCopy(locale);
  const learnHref = useAccountFeatureHref("/learn");
  const { progress } = useLearnProgress();
  const completed = progress.completedLessonIds.length;
  const total = LEARN_LESSON_IDS.length;

  return (
    <div className="home-shortcuts">
      <TournamentStone href={href("/tournaments")} label={getTournamentsCopy(locale).title} />
      <Link className="home-learning home-shortcut" href={learnHref}>
        <span aria-hidden="true" className="home-learning__stones"><i /><i /><i /></span>
        <strong>{copy.continueLearning}</strong>
        <span className="home-learning__progress">
          <progress aria-label={copy.lessonsComplete.replace("{done}", String(completed)).replace("{total}", String(total))} max={total} value={completed} />
          <span className="home-shortcut__label"><small>{completed} / {total}</small><ArrowRight aria-hidden="true" size={18} /></span>
        </span>
      </Link>
    </div>
  );
}
