import assert from "node:assert/strict";
import test from "node:test";
import { LEARN_LESSONS, type LessonStep } from "./curriculum";
import { lessonBoardPresentation } from "./presentation";

test("every selection task starts without answer overlays, including retries and requested hints", () => {
  let checked = 0;
  for (const lesson of LEARN_LESSONS) for (const step of lesson.steps) {
    if (step.kind !== "select") continue;
    checked += 1;
    for (const wrong of [false, true]) for (const hint of [false, true]) {
      assert.deepEqual(lessonBoardPresentation(step, { solved: false, wrong, hint, lastMove: step.targets![0] }), {
        emphasis: [], group: [], territory: [], lastMove: null,
      }, `${lesson.id}/${step.id} leaks its selection answer`);
    }
  }
  assert.ok(checked >= 15, "Audit the whole curriculum, not only territory tasks");
});

test("a selection task with every overlay populated still cannot reveal its targets", () => {
  const points = [{ x: 1, y: 1 }];
  const step: LessonStep = { id: "guard", kind: "select", body: { de: "Markiere.", en: "Mark." }, targets: points, emphasis: points, group: points, territory: points, lastMove: points[0] };
  assert.deepEqual(lessonBoardPresentation(step, { solved: false, wrong: true, hint: true, lastMove: points[0] }), {
    emphasis: [], group: [], territory: [], lastMove: null,
  });
  assert.deepEqual(lessonBoardPresentation(step, { solved: true, wrong: false, hint: false, lastMove: null }).territory, points);
  assert.deepEqual(lessonBoardPresentation(step, { solved: false, wrong: false, hint: false, lastMove: null }).territory, []);
});

test("explanation boards and explicitly directed placement lessons retain their teaching overlays", () => {
  const points = [{ x: 2, y: 2 }];
  const step: LessonStep = { id: "explain", kind: "info", body: { de: "Ein Auge.", en: "An eye." }, emphasis: points, group: points, territory: points, lastMove: points[0] };
  assert.deepEqual(lessonBoardPresentation(step, { solved: false, wrong: false, hint: false, lastMove: null }), {
    emphasis: points, group: points, territory: points, lastMove: points[0],
  });
  const placement = { ...step, kind: "play" as const, targets: [{ x: 3, y: 3 }] };
  assert.deepEqual(lessonBoardPresentation(placement, { solved: false, wrong: false, hint: true, lastMove: null }).emphasis, [...points, ...placement.targets]);
});
