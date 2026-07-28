import type { BoardSize, Position } from "@/lib/game/types";

export type PrecisionPlacementContext = {
  boardSize: BoardSize;
  disabled: boolean;
  interactionMode: "play" | "mark-dead";
  revision: string;
};

export type PrecisionPlacementState =
  | { kind: "whole" }
  | { kind: "precision"; position: Position; revision: string }
  | { kind: "submitting"; revision: string };

export type PrecisionPlacementActivation = Position & {
  actionable: boolean;
  coarseMobile: boolean;
  pointerType: "keyboard" | "mouse" | "pen" | "touch";
};

export const WHOLE_BOARD: PrecisionPlacementState = { kind: "whole" };

export function boardPositionFromClientPoint(
  clientX: number,
  clientY: number,
  bounds: { left: number; top: number; width: number; height: number },
  boardSize: BoardSize,
): Position | null {
  if (bounds.width <= 0 || bounds.height <= 0) return null;
  const gridRatio = 0.86;
  const insetRatio = 0.07;
  const xRatio = ((clientX - bounds.left) / bounds.width - insetRatio) / gridRatio;
  const yRatio = ((clientY - bounds.top) / bounds.height - insetRatio) / gridRatio;
  const last = boardSize - 1;
  return {
    x: Math.max(0, Math.min(last, Math.round(xRatio * last))),
    y: Math.max(0, Math.min(last, Math.round(yRatio * last))),
  };
}

export function reconcilePrecisionPlacement(
  state: PrecisionPlacementState,
  context: PrecisionPlacementContext,
): PrecisionPlacementState {
  if (state.kind === "whole") return state;
  if (
    context.disabled
    || context.boardSize !== 19
    || context.interactionMode !== "play"
    || state.revision !== context.revision
  ) {
    return WHOLE_BOARD;
  }
  return state;
}

export function activatePrecisionPlacement(
  state: PrecisionPlacementState,
  context: PrecisionPlacementContext,
  activation: PrecisionPlacementActivation,
): { state: PrecisionPlacementState; submit: boolean } {
  const current = reconcilePrecisionPlacement(state, context);
  if (context.disabled || !activation.actionable) {
    return { state: current, submit: false };
  }
  if (current.kind === "submitting") {
    return { state: current, submit: false };
  }
  if (current.kind === "precision") {
    if (
      activation.pointerType === "touch"
      && activation.coarseMobile
      && (
        current.position.x !== activation.x
        || current.position.y !== activation.y
      )
    ) {
      return {
        state: {
          kind: "precision",
          position: { x: activation.x, y: activation.y },
          revision: context.revision,
        },
        submit: false,
      };
    }
    return {
      state: { kind: "submitting", revision: context.revision },
      submit: true,
    };
  }
  if (
    context.boardSize === 19
    && context.interactionMode === "play"
    && activation.pointerType === "touch"
    && activation.coarseMobile
  ) {
    return {
      state: {
        kind: "precision",
        position: { x: activation.x, y: activation.y },
        revision: context.revision,
      },
      submit: false,
    };
  }
  return { state: WHOLE_BOARD, submit: true };
}
