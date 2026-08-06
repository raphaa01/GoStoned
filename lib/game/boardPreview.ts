import type { BoardSize } from "./types";

export const BOARD_PREVIEW_INSET = 6;
export const BOARD_PREVIEW_CENTER = 50;

export type BoardPreviewPoint = Readonly<{
  x: number;
  y: number;
}>;

export function boardPreviewCoordinates(boardSize: BoardSize): number[] {
  const span = 100 - (BOARD_PREVIEW_INSET * 2);
  return Array.from(
    { length: boardSize },
    (_, index) => BOARD_PREVIEW_INSET + ((span * index) / (boardSize - 1)),
  );
}

export function boardPreviewStarPoints(boardSize: BoardSize): BoardPreviewPoint[] {
  const centerIndex = Math.floor(boardSize / 2);
  if (boardSize === 9) {
    return [
      { x: 2, y: 2 },
      { x: 6, y: 2 },
      { x: centerIndex, y: centerIndex },
      { x: 2, y: 6 },
      { x: 6, y: 6 },
    ];
  }

  const guideIndices = [3, centerIndex, boardSize - 4];
  return guideIndices.flatMap((y) => guideIndices.map((x) => ({ x, y })));
}

export function boardPreviewStoneRadius(boardSize: BoardSize): number {
  const coordinates = boardPreviewCoordinates(boardSize);
  return (coordinates[1] - coordinates[0]) * 0.46;
}
