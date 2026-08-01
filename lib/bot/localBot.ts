import {
  applyMove,
  boardHash,
  countLiberties,
  getGroup,
  getNeighbors,
  replayMovesWithPrisoners,
  scoreChinese,
} from "@/lib/game/goEngine";
import type { Board, GameState, Position, Stone } from "@/lib/game/types";

export type LocalBotMove =
  | { x: number; y: number; isPass?: false }
  | { isPass: true };

export type LocalBotLevel = "novice" | "beginner" | "intermediate" | "advanced" | "strongest";

export type LocalBotProfile = Readonly<{
  level: LocalBotLevel;
  candidateLimit: number;
  noise: number;
  tacticalDepth: number;
}>;

export type LocalBotInput = Readonly<{
  game: GameState;
  targetRating: number;
}>;

type Candidate = { move: LocalBotMove; score: number; tieBreak: number };

function opponent(color: Stone): Stone {
  return color === "black" ? "white" : "black";
}

export function deterministicBrowserUnit(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0x1_0000_0000;
}

export function localBotProfileForRating(rawRating: number): LocalBotProfile {
  const rating = Math.max(100, Math.min(3_000, Math.round(rawRating || 1_200)));
  if (rating < 800) return { level: "novice", candidateLimit: 12, noise: 125, tacticalDepth: 0 };
  if (rating < 1_100) return { level: "beginner", candidateLimit: 8, noise: 80, tacticalDepth: 0 };
  if (rating < 1_400) return { level: "intermediate", candidateLimit: 5, noise: 42, tacticalDepth: 1 };
  if (rating < 1_800) return { level: "advanced", candidateLimit: 3, noise: 18, tacticalDepth: 1 };
  return { level: "strongest", candidateLimit: 1, noise: 2, tacticalDepth: 2 };
}

export function localBotThinkDelayMs(gameId: string, gameVersion: number): number {
  return Math.round(3_000 + deterministicBrowserUnit(`${gameId}:${gameVersion}:local-think`) * 6_000);
}

function uniqueAdjacentGroups(board: Board, point: Position, color: Stone): Position[][] {
  const seen = new Set<string>();
  const groups: Position[][] = [];
  for (const neighbor of getNeighbors(board, point)) {
    if (board[neighbor.y][neighbor.x] !== color) continue;
    const group = getGroup(board, neighbor);
    const key = group.map(({ x, y }) => `${x}:${y}`).sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    groups.push(group);
  }
  return groups;
}

function shapeScore(board: Board, color: Stone, point: Position): number {
  const size = board.length;
  const friendly = uniqueAdjacentGroups(board, point, color);
  const hostile = uniqueAdjacentGroups(board, point, opponent(color));
  let score = Math.max(0, friendly.length - 1) * 18;
  score += friendly.filter((group) => countLiberties(board, group) === 1).length * 85;
  for (const group of hostile) {
    const liberties = countLiberties(board, group);
    if (liberties === 1) score += 95 + group.length * 14;
    else if (liberties === 2) score += 24 + Math.min(16, group.length * 2);
  }
  const neighbors = getNeighbors(board, point);
  const friendlyNeighbors = neighbors.filter(({ x, y }) => board[y][x] === color).length;
  const emptyNeighbors = neighbors.filter(({ x, y }) => board[y][x] === null).length;
  if (emptyNeighbors === 0 && friendlyNeighbors === neighbors.length) score -= 75;

  const edgeDistance = Math.min(point.x, point.y, size - 1 - point.x, size - 1 - point.y);
  const occupied = board.flat().filter(Boolean).length;
  if (occupied < size * 2.2) {
    if (edgeDistance === 0) score -= 24;
    else if (edgeDistance === 1) score -= 7;
    const starDistance = Math.min(
      ...[3, size - 4]
        .filter((coordinate) => coordinate >= 0 && coordinate < size)
        .flatMap((x) => [3, size - 4]
          .filter((coordinate) => coordinate >= 0 && coordinate < size)
          .map((y) => Math.abs(point.x - x) + Math.abs(point.y - y))),
    );
    score += Math.max(0, 12 - starDistance * 3);
  }
  return score;
}

function shallowReplyPenalty(board: Board, color: Stone, point: Position, depth: number): number {
  if (depth === 0) return 0;
  const placed = applyMove(board, color, point.x, point.y);
  if (!placed.ok) return 10_000;
  const group = getGroup(placed.board, point);
  const liberties = countLiberties(placed.board, group);
  if (liberties === 1) return 90 + group.length * 10;
  if (liberties === 2 && depth > 1) return 18 + group.length * 2;
  return 0;
}

function shouldPass(game: GameState, color: Stone, bestScore: number): boolean {
  const occupied = game.board.flat().filter(Boolean).length;
  const fill = occupied / (game.boardSize * game.boardSize);
  if (fill < 0.58 || bestScore >= 18) return false;
  if (game.consecutivePasses > 0) {
    const score = scoreChinese(game.board, game.komi);
    return score.winner === color || fill > 0.82;
  }
  return fill > 0.9;
}

export function chooseLocalBotMove(input: LocalBotInput): LocalBotMove {
  const { game } = input;
  if (game.status !== "active" || game.phase !== "play" || !game.turn) {
    throw new Error("The local bot can only choose a move during active play.");
  }
  const color = game.turn;
  const profile = localBotProfileForRating(input.targetRating);
  const history = new Set(replayMovesWithPrisoners(game.boardSize, game.moves).positionHistory);
  const candidates: Candidate[] = [];

  for (let y = 0; y < game.boardSize; y += 1) {
    for (let x = 0; x < game.boardSize; x += 1) {
      if (game.board[y][x] !== null) continue;
      const result = applyMove(game.board, color, x, y);
      if (!result.ok || history.has(boardHash(result.board))) continue;
      const point = { x, y };
      const ownGroup = getGroup(result.board, point);
      const liberties = countLiberties(result.board, ownGroup);
      const seed = `${game.id}:${game.version}:${x}:${y}:${profile.level}`;
      const noise = (deterministicBrowserUnit(seed) * 2 - 1) * profile.noise;
      const score = result.captured.length * 115
        + Math.min(6, liberties) * 5
        + shapeScore(game.board, color, point)
        - shallowReplyPenalty(game.board, color, point, profile.tacticalDepth)
        + noise;
      candidates.push({ move: { x, y }, score, tieBreak: deterministicBrowserUnit(`${seed}:tie`) });
    }
  }

  if (candidates.length === 0) return { isPass: true };
  candidates.sort((left, right) => right.score - left.score || right.tieBreak - left.tieBreak);
  const pool = candidates.slice(0, Math.min(profile.candidateLimit, candidates.length));
  const selectedIndex = profile.candidateLimit === 1
    ? 0
    : Math.floor(deterministicBrowserUnit(`${game.id}:${game.version}:candidate`) * pool.length);
  const selected = pool[selectedIndex] ?? candidates[0];
  return shouldPass(game, color, selected.score) ? { isPass: true } : selected.move;
}
