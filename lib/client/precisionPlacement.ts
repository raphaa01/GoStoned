import type { BoardSize, Position } from "@/lib/game/types";

/**
 * The playable grid occupies one shared, square region inside the wooden board.
 * Rendering and pointer snapping both consume these values so a visual
 * intersection can never drift away from its interactive coordinate.
 */
export const BOARD_GRID_INSET_RATIO = 0.07;
export const BOARD_GRID_SPAN_RATIO = 1 - BOARD_GRID_INSET_RATIO * 2;

export const TOUCH_LENS_RADIUS = 3;
export const TOUCH_LENS_DIAMETER_PX = 168;
export const TOUCH_LENS_GAP_PX = 56;
export const TOUCH_LENS_EDGE_PADDING_PX = 8;

export type TouchLensLayout = {
  left: number;
  placement: "above" | "below";
  tetherOffsetX: number;
  top: number;
};

export function touchLensLayout(
  clientX: number,
  clientY: number,
  bounds: { left: number; top: number; width: number },
  viewportHeight: number,
): TouchLensLayout {
  const touchX = clientX - bounds.left;
  const touchY = clientY - bounds.top;
  const radius = TOUCH_LENS_DIAMETER_PX / 2;
  const minimumCenter = radius + TOUCH_LENS_EDGE_PADDING_PX;
  const maximumCenter = bounds.width - minimumCenter;
  const left = maximumCenter < minimumCenter
    ? bounds.width / 2
    : Math.max(minimumCenter, Math.min(maximumCenter, touchX));
  const maximumTetherOffset = radius - 12;
  const tetherOffsetX = Math.max(
    -maximumTetherOffset,
    Math.min(maximumTetherOffset, touchX - left),
  );
  const requiredSpace = TOUCH_LENS_DIAMETER_PX
    + TOUCH_LENS_GAP_PX
    + TOUCH_LENS_EDGE_PADDING_PX;
  const spaceAbove = clientY - TOUCH_LENS_EDGE_PADDING_PX;
  const spaceBelow = viewportHeight - clientY - TOUCH_LENS_EDGE_PADDING_PX;
  const placement = spaceAbove >= requiredSpace || spaceAbove >= spaceBelow
    ? "above"
    : "below";

  return { left, placement, tetherOffsetX, top: touchY };
}

export function boardPositionFromClientPoint(
  clientX: number,
  clientY: number,
  bounds: { left: number; top: number; width: number; height: number },
  boardSize: BoardSize,
): Position | null {
  if (bounds.width <= 0 || bounds.height <= 0) return null;
  const xRatio = (
    (clientX - bounds.left) / bounds.width - BOARD_GRID_INSET_RATIO
  ) / BOARD_GRID_SPAN_RATIO;
  const yRatio = (
    (clientY - bounds.top) / bounds.height - BOARD_GRID_INSET_RATIO
  ) / BOARD_GRID_SPAN_RATIO;
  const last = boardSize - 1;
  return {
    x: Math.max(0, Math.min(last, Math.round(xRatio * last))),
    y: Math.max(0, Math.min(last, Math.round(yRatio * last))),
  };
}

export function touchLensCoordinates(center: Position, boardSize: BoardSize): Array<Position | null> {
  const coordinates: Array<Position | null> = [];
  for (let dy = -TOUCH_LENS_RADIUS; dy <= TOUCH_LENS_RADIUS; dy += 1) {
    for (let dx = -TOUCH_LENS_RADIUS; dx <= TOUCH_LENS_RADIUS; dx += 1) {
      const x = center.x + dx;
      const y = center.y + dy;
      coordinates.push(x < 0 || y < 0 || x >= boardSize || y >= boardSize ? null : { x, y });
    }
  }
  return coordinates;
}
