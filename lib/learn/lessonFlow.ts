import type { LearnLesson, LessonStep, LocalizedLine } from "./curriculum";
import type { Stone } from "@/lib/game/types";

const opposite = (color: Stone): Stone => color === "black" ? "white" : "black";

function swapLine(copy: LocalizedLine | undefined): LocalizedLine | undefined {
  if (!copy) return copy;
  const swap = (text: string) => text.replace(/\b(Schwarz|Weiß|schwarz|weiß|Black|White|black|white)/gu, (word) => ({
    Schwarz: "Weiß", Weiß: "Schwarz", schwarz: "weiß", weiß: "schwarz",
    Black: "White", White: "Black", black: "white", white: "black",
  })[word]!);
  return { de: swap(copy.de), en: swap(copy.en) };
}

/** Independent exercises can change the position, never the learner's colour.
 * Swap the whole authored position AND its copy, including the ko predecessor.
 * Coordinates, replies, captures and selection answers are unchanged. */
export function stableLessonColor(lesson: LearnLesson): LearnLesson {
  const color = lesson.steps.some((step) => step.kind.endsWith("game")) ? "black"
    : lesson.steps.find((step) => step.kind === "play" || step.kind === "illegal")?.toPlay;
  if (!color) return lesson;
  return { ...lesson, steps: lesson.steps.map((step): LessonStep => {
    if ((step.kind !== "play" && step.kind !== "illegal") || !step.toPlay || step.toPlay === color) return step;
    return { ...step, toPlay: color,
      stones: step.stones?.map((stone) => ({ ...stone, color: opposite(stone.color) })),
      koPreviousBoard: step.koPreviousBoard?.map((stone) => ({ ...stone, color: opposite(stone.color) })),
      body: swapLine(step.body)!, task: swapLine(step.task), success: swapLine(step.success),
      wrong: swapLine(step.wrong), hint: swapLine(step.hint),
      replyExplanations: step.replyExplanations?.map((copy) => swapLine(copy)!),
    };
  }) };
}

/** Only the opponent's first reply is automatic. Further trainer plies are
 * deliberately revealed one at a time, including passes. */
export function automaticReplyCount(step: LessonStep): number {
  return step.kind === "play" && step.replies?.length ? 1 : 0;
}

export function continuesOwnTurn(current: LessonStep, next: LessonStep | undefined): boolean {
  return current.kind === "play" && next?.kind === "play" && next.continuePosition === true
    && current.size === next.size && (current.toPlay ?? "black") === (next.toPlay ?? "black");
}
