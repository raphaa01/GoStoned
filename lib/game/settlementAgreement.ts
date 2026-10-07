import { getGroup } from "./goEngine";
import { GameServiceError } from "./gameServiceError";
import { sortPositions } from "./scoring";
import type { Board, Position } from "./types";

export function settlementPositions(value: unknown, board: Board, groups = false): Position[] {
  const invalid = () => {
    throw new GameServiceError("The settlement proposal is invalid.", 400, "invalid_browser_bot_action");
  };
  if (!Array.isArray(value) || value.length > board.length ** 2) return invalid();
  const points: Position[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return invalid();
    const { x, y } = candidate as Record<string, unknown>;
    if (Object.keys(candidate).length !== 2 || !Number.isInteger(x) || !Number.isInteger(y)
      || Number(x) < 0 || Number(y) < 0 || Number(x) >= board.length || Number(y) >= board.length) return invalid();
    const point = { x: Number(x), y: Number(y) };
    const key = `${point.x}:${point.y}`;
    if (seen.has(key)) return invalid();
    seen.add(key);
    points.push(point);
  }
  if (groups) {
    for (const point of points) {
      if (!board[point.y][point.x] || getGroup(board, point).some(({ x, y }) => !seen.has(`${x}:${y}`))) return invalid();
    }
  }
  return sortPositions(points);
}
