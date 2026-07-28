import type { BoardSize } from "./types";

const GO_COLUMNS = "ABCDEFGHJKLMNOPQRST";
const BOARD_NAVIGATION_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
]);

export function isBoardNavigationKey(key: string): boolean {
  return BOARD_NAVIGATION_KEYS.has(key);
}

export function goColumnLabel(boardSize: BoardSize, x: number): string {
  if (!Number.isInteger(x) || x < 0 || x >= boardSize) {
    throw new RangeError("Board column is outside the supported board.");
  }
  return GO_COLUMNS[x];
}

export function goCoordinate(boardSize: BoardSize, x: number, y: number): string {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= boardSize || y >= boardSize) {
    throw new RangeError("Board position is outside the supported board.");
  }

  return `${goColumnLabel(boardSize, x)}${boardSize - y}`;
}

export function formatBoardLabel(
  template: string,
  values: Record<string, string | number>,
): string {
  return Object.entries(values).reduce(
    (label, [name, value]) => label.replaceAll(`{${name}}`, String(value)),
    template,
  );
}

export function joinBoardLabels(...parts: Array<string | null | undefined | false>): string {
  return parts.filter(Boolean).join(" ");
}

export function moveBoardFocus(
  index: number,
  key: string,
  boardSize: BoardSize,
  wholeGrid = false,
): number {
  const lastIndex = boardSize * boardSize - 1;
  const rowStart = Math.floor(index / boardSize) * boardSize;
  const rowEnd = rowStart + boardSize - 1;

  switch (key) {
    case "ArrowLeft":
      return Math.max(rowStart, index - 1);
    case "ArrowRight":
      return Math.min(rowEnd, index + 1);
    case "ArrowUp":
      return Math.max(index % boardSize, index - boardSize);
    case "ArrowDown":
      return Math.min(lastIndex - ((lastIndex - index) % boardSize), index + boardSize);
    case "Home":
      return wholeGrid ? 0 : rowStart;
    case "End":
      return wholeGrid ? lastIndex : rowEnd;
    default:
      return index;
  }
}
