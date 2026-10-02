export const LEARN_LESSON_IDS = [
  "s1-board",
  "s1-turns",
  "s1-liberties",
  "s1-groups",
  "s1-capture",
  "s1-atari",
  "s1-escape",
  "s1-review",
  "s1-capture-go",
  "s2-goal",
  "s2-territory",
  "s2-suicide",
  "s2-ko",
  "s2-pass",
  "s2-dead",
  "s2-ending",
  "s2-counting",
  "s2-komi",
  "s2-first-game",
  "s3-alive",
  "s3-one-eye",
  "s3-two-eyes",
  "s3-false-eye",
  "s3-life-death",
  "s3-seki",
  "s3-connect",
  "s3-cut",
  "s3-weak-groups",
  "s3-sacrifice",
  "s3-challenge",
  "s3-second-game",
] as const;

export type LearnLessonId = (typeof LEARN_LESSON_IDS)[number];

export type LearnChallengeResult = Readonly<{
  attempts: number;
  completedAt: string;
  outcome: "completed" | "won" | "lost";
}>;

export type LearnProgress = Readonly<{
  version: 1;
  completedLessonIds: readonly LearnLessonId[];
  currentLessonId: LearnLessonId;
  completedStages: readonly number[];
  lastStepByLesson: Readonly<Partial<Record<LearnLessonId, number>>>;
  challengeResults: Readonly<Partial<Record<LearnLessonId, LearnChallengeResult>>>;
  updatedAt: string;
}>;

const ID_SET = new Set<string>(LEARN_LESSON_IDS);

export function isLearnLessonId(value: unknown): value is LearnLessonId {
  return typeof value === "string" && ID_SET.has(value);
}

function isoNow() {
  return new Date().toISOString();
}

export function emptyLearnProgress(): LearnProgress {
  return {
    version: 1,
    completedLessonIds: [],
    currentLessonId: LEARN_LESSON_IDS[0],
    completedStages: [],
    lastStepByLesson: {},
    challengeResults: {},
    updatedAt: "1970-01-01T00:00:00.000Z",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseLearnProgress(value: unknown): LearnProgress {
  if (!isRecord(value)) return emptyLearnProgress();
  const completedLessonIds = Array.isArray(value.completedLessonIds)
    ? [...new Set(value.completedLessonIds.filter(isLearnLessonId))]
    : [];
  const currentLessonId = isLearnLessonId(value.currentLessonId)
    ? value.currentLessonId
    : LEARN_LESSON_IDS.find((id) => !completedLessonIds.includes(id)) ?? LEARN_LESSON_IDS.at(-1)!;
  const completedStages = [1, 2, 3].filter((stage) => LEARN_LESSON_IDS.filter((id) => id.startsWith(`s${stage}-`)).every((id) => completedLessonIds.includes(id)));
  const lastStepByLesson: Partial<Record<LearnLessonId, number>> = {};
  if (isRecord(value.lastStepByLesson)) {
    for (const [id, step] of Object.entries(value.lastStepByLesson)) {
      if (isLearnLessonId(id) && Number.isInteger(step) && (step as number) >= 0 && (step as number) <= 20) {
        lastStepByLesson[id] = step as number;
      }
    }
  }
  const challengeResults: Partial<Record<LearnLessonId, LearnChallengeResult>> = {};
  if (isRecord(value.challengeResults)) {
    for (const [id, result] of Object.entries(value.challengeResults)) {
      if (!isLearnLessonId(id) || !isRecord(result)) continue;
      if (
        !Number.isInteger(result.attempts)
        || (result.attempts as number) < 1
        || (result.outcome !== "completed" && result.outcome !== "won" && result.outcome !== "lost")
        || typeof result.completedAt !== "string"
        || !Number.isFinite(Date.parse(result.completedAt))
      ) continue;
      challengeResults[id] = {
        attempts: result.attempts as number,
        completedAt: result.completedAt,
        outcome: result.outcome,
      };
    }
  }
  return {
    version: 1,
    completedLessonIds,
    currentLessonId,
    completedStages,
    lastStepByLesson,
    challengeResults,
    updatedAt: typeof value.updatedAt === "string" && Number.isFinite(Date.parse(value.updatedAt))
      ? value.updatedAt
      : isoNow(),
  };
}

export function mergeLearnProgress(local: LearnProgress, remote: LearnProgress): LearnProgress {
  const completed = LEARN_LESSON_IDS.filter((id) => (
    local.completedLessonIds.includes(id) || remote.completedLessonIds.includes(id)
  ));
  const newest = Date.parse(local.updatedAt) >= Date.parse(remote.updatedAt) ? local : remote;
  const older = newest === local ? remote : local;
  return parseLearnProgress({
    ...newest,
    completedLessonIds: completed,
    completedStages: [...new Set([...local.completedStages, ...remote.completedStages])],
    lastStepByLesson: { ...older.lastStepByLesson, ...newest.lastStepByLesson },
    challengeResults: { ...older.challengeResults, ...newest.challengeResults },
    updatedAt: newest.updatedAt,
  });
}

export function completeLearnLesson(
  progress: LearnProgress,
  lessonId: LearnLessonId,
  stage: number,
  challengeOutcome?: LearnChallengeResult["outcome"],
): LearnProgress {
  const completedLessonIds = LEARN_LESSON_IDS.filter((id) => (
    progress.completedLessonIds.includes(id) || id === lessonId
  ));
  const stageIds = LEARN_LESSON_IDS.filter((id) => id.startsWith(`s${stage}-`));
  const completedStages = stageIds.every((id) => completedLessonIds.includes(id))
    ? [...new Set([...progress.completedStages, stage])].sort()
    : [...progress.completedStages];
  const currentIndex = LEARN_LESSON_IDS.indexOf(lessonId);
  const nextLesson = LEARN_LESSON_IDS.find((id) => !completedLessonIds.includes(id))
    ?? LEARN_LESSON_IDS[Math.min(currentIndex + 1, LEARN_LESSON_IDS.length - 1)];
  const previousResult = progress.challengeResults[lessonId];
  return {
    ...progress,
    completedLessonIds,
    completedStages,
    currentLessonId: nextLesson,
    lastStepByLesson: { ...progress.lastStepByLesson, [lessonId]: 0 },
    challengeResults: challengeOutcome ? {
      ...progress.challengeResults,
      [lessonId]: {
        attempts: (previousResult?.attempts ?? 0) + 1,
        completedAt: isoNow(),
        outcome: challengeOutcome,
      },
    } : progress.challengeResults,
    updatedAt: isoNow(),
  };
}
