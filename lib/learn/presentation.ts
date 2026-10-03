import type { Position } from "@/lib/game/types";
import type { LessonStep } from "./curriculum";

const NO_POINTS: readonly Position[] = [];

/** Selection answers must never be exposed by authored overlays or automatic hints. */
export function lessonBoardPresentation(step: LessonStep, state: Readonly<{
  solved: boolean;
  wrong: boolean;
  hint: boolean;
  lastMove: Position | null;
}>) {
  if (step.kind === "select") {
    return {
      emphasis: NO_POINTS,
      group: NO_POINTS,
      territory: state.solved ? step.territory ?? NO_POINTS : NO_POINTS,
      lastMove: null,
    };
  }
  return {
    emphasis: state.wrong || state.hint ? [...(step.emphasis ?? NO_POINTS), ...(step.targets ?? NO_POINTS)] : step.emphasis ?? NO_POINTS,
    group: step.group ?? NO_POINTS,
    territory: step.territory ?? NO_POINTS,
    lastMove: step.lastMove ?? state.lastMove,
  };
}
