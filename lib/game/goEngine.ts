import type { Board, BoardSize, MoveResult, Position, Stone } from "./types";

export function createEmptyBoard(size: BoardSize): Board {
  return Array.from({ length: size }, () => Array<null>(size).fill(null));
}

export function getNeighbors(board: Board, position: Position): Position[] {
  const candidates = [
    { x: position.x - 1, y: position.y },
    { x: position.x + 1, y: position.y },
    { x: position.x, y: position.y - 1 },
    { x: position.x, y: position.y + 1 },
  ];

  return candidates.filter(
    ({ x, y }) => y >= 0 && y < board.length && x >= 0 && x < board[y].length,
  );
}

export function getGroup(board: Board, start: Position): Position[] {
  const color = board[start.y]?.[start.x];
  if (!color) return [];

  const group: Position[] = [];
  const stack: Position[] = [start];
  const visited = new Set<string>();

  while (stack.length > 0) {
    const current = stack.pop()!;
    const key = `${current.x}:${current.y}`;
    if (visited.has(key)) continue;
    visited.add(key);

    if (board[current.y]?.[current.x] !== color) continue;
    group.push(current);

    for (const neighbor of getNeighbors(board, current)) {
      if (board[neighbor.y][neighbor.x] === color) {
        stack.push(neighbor);
      }
    }
  }

  return group;
}

export function countLiberties(board: Board, group: Position[]): number {
  const liberties = new Set<string>();

  for (const position of group) {
    for (const neighbor of getNeighbors(board, position)) {
      if (board[neighbor.y][neighbor.x] === null) {
        liberties.add(`${neighbor.x}:${neighbor.y}`);
      }
    }
  }

  return liberties.size;
}

export function applyMove(
  currentBoard: Board,
  color: Stone,
  x: number,
  y: number,
): MoveResult {
  if (y < 0 || y >= currentBoard.length || x < 0 || x >= currentBoard[y].length) {
    return { ok: false, board: currentBoard, error: "out_of_bounds" };
  }
  if (currentBoard[y][x] !== null) {
    return { ok: false, board: currentBoard, error: "occupied" };
  }

  const board = currentBoard.map((row) => [...row]);
  board[y][x] = color;
  const opponent: Stone = color === "black" ? "white" : "black";
  const captured: Position[] = [];

  for (const neighbor of getNeighbors(board, { x, y })) {
    if (board[neighbor.y][neighbor.x] !== opponent) continue;
    const opponentGroup = getGroup(board, neighbor);
    if (countLiberties(board, opponentGroup) === 0) {
      for (const stone of opponentGroup) {
        board[stone.y][stone.x] = null;
        captured.push(stone);
      }
    }
  }

  const ownGroup = getGroup(board, { x, y });
  if (countLiberties(board, ownGroup) === 0) {
    return { ok: false, board: currentBoard, error: "suicide" };
  }

  return { ok: true, board, captured };
}
