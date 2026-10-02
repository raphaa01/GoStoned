import assert from "node:assert/strict";
import test from "node:test";
import {
  completeLearnLesson,
  emptyLearnProgress,
  LEARN_LESSON_IDS,
  mergeLearnProgress,
  parseLearnProgress,
} from "./progress";

test("learning progress rejects unknown lessons and invalid challenge data", () => {
  const parsed = parseLearnProgress({
    completedLessonIds: ["s1-board", "made-up", 12],
    currentLessonId: "made-up",
    completedStages: [1, 9],
    lastStepByLesson: { "s1-board": 2, "made-up": 3, "s1-turns": -1 },
    challengeResults: { "s1-capture-go": { attempts: 0, completedAt: "no", outcome: "won" } },
  });
  assert.deepEqual(parsed.completedLessonIds, ["s1-board"]);
  assert.equal(parsed.currentLessonId, "s1-turns");
  assert.deepEqual(parsed.completedStages, []);
  assert.deepEqual(parsed.lastStepByLesson, { "s1-board": 2 });
  assert.deepEqual(parsed.challengeResults, {});
});

test("completing lessons advances linearly and completes a stage only at its final node", () => {
  let progress = emptyLearnProgress();
  for (const id of LEARN_LESSON_IDS.filter((candidate) => candidate.startsWith("s1-"))) {
    progress = completeLearnLesson(progress, id, 1, id === "s1-capture-go" ? "won" : undefined);
  }
  assert.ok(progress.completedStages.includes(1));
  assert.equal(progress.currentLessonId, "s2-goal");
  assert.equal(progress.challengeResults["s1-capture-go"]?.outcome, "won");
});

test("local and account progress merge without losing completed lessons", () => {
  const local = parseLearnProgress({
    ...emptyLearnProgress(), completedLessonIds: ["s1-board", "s1-turns"], currentLessonId: "s1-liberties",
  });
  const remote = parseLearnProgress({
    ...emptyLearnProgress(), completedLessonIds: ["s1-board", "s1-liberties"], currentLessonId: "s1-groups",
  });
  const merged = mergeLearnProgress(local, remote);
  assert.deepEqual(merged.completedLessonIds.slice(0, 3), ["s1-board", "s1-turns", "s1-liberties"]);
});

test("synchronization does not invent timestamps that overwrite a newer learning step", () => {
  const before = parseLearnProgress({...emptyLearnProgress(), updatedAt: "2026-01-01T00:00:00.000Z", lastStepByLesson: {"s1-liberties": 1}});
  const after = parseLearnProgress({...before, updatedAt: "2026-01-01T00:00:01.000Z", lastStepByLesson: {"s1-liberties": 2}});
  const saved = mergeLearnProgress(before, before);
  assert.equal(saved.updatedAt, before.updatedAt);
  assert.equal(mergeLearnProgress(after, saved).lastStepByLesson["s1-liberties"], 2);
  assert.equal(mergeLearnProgress(saved, after).updatedAt, after.updatedAt);
  assert.equal(mergeLearnProgress(emptyLearnProgress(), after).lastStepByLesson["s1-liberties"], 2);
  assert.equal(mergeLearnProgress(emptyLearnProgress(), after).updatedAt, after.updatedAt);
});
