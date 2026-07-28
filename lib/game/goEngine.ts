import type {
  Board,
  BoardSize,
  MoveResult,
  Position,
  Score,
  Stone,
  StoredMove,
} from "./types";

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

export function boardHash(board: Board): string {
  return board
    .map((row) =>
      row.map((intersection) => (intersection === "black" ? "B" : intersection === "white" ? "W" : ".")).join(""),
    )
    .join("/");
}

export function replayMoves(size: BoardSize, moves: StoredMove[]): Board {
  let board = createEmptyBoard(size);

  for (const move of moves) {
    if (move.isPass || move.x === null || move.y === null) continue;
    const result = applyMove(board, move.color, move.x, move.y);
    if (!result.ok) {
      throw new Error(`Stored move ${move.moveNumber} is invalid (${result.error}).`);
    }
    board = result.board;
  }

  return board;
}

export function scoreChinese(board: Board, komi = 7.5): Score {
  let blackStones = 0;
  let whiteStones = 0;
  let blackTerritory = 0;
  let whiteTerritory = 0;
  let neutralPoints = 0;
  const visited = new Set<string>();

  for (let y = 0; y < board.length; y += 1) {
    for (let x = 0; x < board[y].length; x += 1) {
      const stone = board[y][x];
      if (stone === "black") {
        blackStones += 1;
        continue;
      }
      if (stone === "white") {
        whiteStones += 1;
        continue;
      }

      const startKey = `${x}:${y}`;
      if (visited.has(startKey)) continue;

      const region: Position[] = [];
      const borders = new Set<Stone>();
      const stack: Position[] = [{ x, y }];

      while (stack.length > 0) {
        const current = stack.pop()!;
        const key = `${current.x}:${current.y}`;
        if (visited.has(key)) continue;
        visited.add(key);
        region.push(current);

        for (const neighbor of getNeighbors(board, current)) {
          const neighborStone = board[neighbor.y][neighbor.x];
          if (neighborStone) borders.add(neighborStone);
          else if (!visited.has(`${neighbor.x}:${neighbor.y}`)) stack.push(neighbor);
        }
      }

      if (borders.size === 1) {
        if (borders.has("black")) blackTerritory += region.length;
        else whiteTerritory += region.length;
      } else {
        neutralPoints += region.length;
      }
    }
  }

  const sharedNeutral = neutralPoints / 2;
  const black = blackStones + blackTerritory + sharedNeutral;
  const white = whiteStones + whiteTerritory + sharedNeutral + komi;
  const margin = Math.abs(black - white);
  const winner: Stone | null = black === white ? null : black > white ? "black" : "white";
  const result = winner ? `${winner === "black" ? "B" : "W"}+${margin}` : "Draw";
  return {
    black,
    white,
    blackStones,
    whiteStones,
    blackTerritory,
    whiteTerritory,
    neutralPoints,
    winner,
    margin,
    result,
  };
}
