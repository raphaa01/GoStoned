import { applyMove, boardHash, countLiberties, getGroup, getNeighbors, replayMovesWithPrisoners } from "@/lib/game/goEngine";
import {
  GOSTONE_BOT_MODEL,
  type GoStoneBotMove,
  type GoStoneBotPosition,
} from "./modelV1";
import { selectBrowserBotMove, type BrowserBotCandidate } from "./browserMoveSelection";

function positionKey({ x, y }: { x: number; y: number }): string {
  return `${x}:${y}`;
}

function deterministicUnit(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0x1_0000_0000;
}

function fillsOwnEye(position: GoStoneBotPosition, x: number, y: number): boolean {
  const { board, toMove } = position;
  if (!getNeighbors(board, { x, y }).every((point) => board[point.y][point.x] === toMove)) return false;
  const diagonals = [[x - 1, y - 1], [x + 1, y - 1], [x - 1, y + 1], [x + 1, y + 1]]
    .filter(([dx, dy]) => dx >= 0 && dy >= 0 && dx < board.length && dy < board.length);
  const hostileCorners = diagonals.filter(([dx, dy]) => board[dy][dx] !== toMove).length;
  return hostileCorners <= (diagonals.length === 4 ? 1 : 0);
}

/** Pass decisions bypass difficulty sampling: lower strength must not mean random passes. */
export function shouldBrowserBotPass(
  position: GoStoneBotPosition,
  passLogit: number,
  bestPlayLogit: number,
  ownership: Float32Array,
): boolean {
  const area = position.boardSize ** 2;
  // Count placements, not passes, so repeatedly passing cannot unlock the endgame.
  if (position.moves.filter((move) => !move.isPass).length < Math.ceil(area * 0.4)) return false;
  const offset = (GOSTONE_BOT_MODEL.maximumBoardSize - position.boardSize) / 2;
  let unsettledEmptyPoints = 0;
  let occupiedPoints = 0;
  for (let y = 0; y < position.boardSize; y += 1) {
    for (let x = 0; x < position.boardSize; x += 1) {
      if (position.board[y][x]) {
        occupiedPoints += 1;
        continue;
      }
      const value = ownership[(y + offset) * 19 + x + offset];
      if (!Number.isFinite(value) || Math.abs(value) < 0.55) unsettledEmptyPoints += 1;
    }
  }
  if (occupiedPoints < Math.ceil(area * 0.2)
    || unsettledEmptyPoints > Math.max(4, Math.floor(area * 0.08))) return false;
  // Human intent can tip a close endgame decision, but cannot override the phase
  // guards or a clearly preferred board move. An unsolicited pass needs a lead.
  return Number.isFinite(passLogit) && (position.moves.at(-1)?.isPass
    ? passLogit + 0.75 >= bestPlayLogit
    : passLogit >= bestPlayLogit + Math.log(1.5));
}

export function chooseBrowserBotMove(
  position: GoStoneBotPosition,
  policy: Float32Array,
  ownership: Float32Array,
  modelVersion: string,
): GoStoneBotMove {
  const replay = replayMovesWithPrisoners(position.boardSize, [...position.moves]);
  const priorHashes = new Set(replay.positionHistory);
  const excluded = new Set((position.excludedMoves ?? []).map(positionKey));
  const candidates: BrowserBotCandidate[] = [];
  const offset = (GOSTONE_BOT_MODEL.maximumBoardSize - position.boardSize) / 2;
  const beginner = position.targetRating < 1_100;

  for (let y = 0; y < position.boardSize; y += 1) {
    for (let x = 0; x < position.boardSize; x += 1) {
      if (excluded.has(positionKey({ x, y }))) continue;
      const logit = policy[(y + offset) * 19 + x + offset];
      if (!Number.isFinite(logit)) continue;
      const applied = applyMove(position.board, position.toMove, x, y);
      if (!applied.ok || priorHashes.has(boardHash(applied.board))) continue;
      const safeAlternative = !beginner || (!fillsOwnEye(position, x, y)
        && (applied.captured.length > 0 || countLiberties(applied.board, getGroup(applied.board, { x, y })) > 1));
      candidates.push({ move: { kind: "play", x, y }, logit, safeAlternative });
    }
  }
  // If there is no legal play, passing is the only move, irrespective of phase.
  if (candidates.length === 0) return { kind: "pass" };
  const bestPlayLogit = Math.max(...candidates.map(({ logit }) => logit));
  if (shouldBrowserBotPass(position, policy[GOSTONE_BOT_MODEL.passIndex], bestPlayLogit, ownership)) {
    return { kind: "pass" };
  }
  return selectBrowserBotMove(candidates, position.targetRating, deterministicUnit(
    `${position.gameId}:${position.gameVersion}:${modelVersion}`,
  ));
}
