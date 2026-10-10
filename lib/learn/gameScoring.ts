import { applyMove, boardHash, createEmptyBoard } from "@/lib/game/goEngine";
import { replayJapaneseNormalPlayBoardLegality, type JapanesePersistedMove } from "@/lib/game/japaneseKo";
import { scoreJapaneseTerritory } from "@/lib/game/japaneseScoring";
import { GOSTONE_BOT_MODEL } from "@/lib/bot/modelV1";
import type { BoardSize, Position, Stone } from "@/lib/game/types";
import { pointKey, territoryPoints } from "./lessonEngine";

export function scoreLearnGame(moves: readonly (Position | null)[], deadStones: Position[], neutralRegionSeeds: Position[], size: BoardSize = 9) {
  if (![9, 13, 19].includes(size)) throw new Error("invalid_board_size");
  if (moves.length < 2 || moves.at(-1) !== null || moves.at(-2) !== null) throw new Error("two_passes_required");
  let board = createEmptyBoard(size);
  const record: JapanesePersistedMove[] = [];
  for (const [index, point] of moves.entries()) {
    const color: Stone = index % 2 === 0 ? "black" : "white";
    if (point !== null) {
      const next = applyMove(board, color, point.x, point.y);
      if (!next.ok) throw new Error("illegal_game_record");
      board = next.board;
    }
    record.push({ moveNumber: index + 1, color, x: point?.x ?? null, y: point?.y ?? null, isPass: point === null, createdAt: "2000-01-01T00:00:00.000Z", boardHash: boardHash(board) });
  }
  const replay = replayJapaneseNormalPlayBoardLegality(size, record);
  const score = scoreJapaneseTerritory({ board, prisoners: replay.prisoners, deadStones, agreedNeutralRegionSeeds: neutralRegionSeeds, komi: GOSTONE_BOT_MODEL.komi });
  const settledBoard = board.map((row) => [...row]);
  deadStones.forEach(({ x, y }) => { settledBoard[y][x] = null; });
  const excluded = new Set<string>();
  // Neutral region seeds exclude the whole connected empty region, not one point.
  for (const seed of neutralRegionSeeds) {
    const pending = [seed];
    while (pending.length) {
      const point = pending.pop()!;
      const key = pointKey(point);
      if (excluded.has(key) || settledBoard[point.y]?.[point.x] !== null) continue;
      excluded.add(key);
      for (const [x, y] of [[point.x - 1, point.y], [point.x + 1, point.y], [point.x, point.y - 1], [point.x, point.y + 1]]) {
        if (x >= 0 && y >= 0 && x < size && y < size) pending.push({ x, y });
      }
    }
  }
  return { score, board: settledBoard, blackTerritory: territoryPoints(settledBoard, "black").filter((p) => !excluded.has(pointKey(p))), whiteTerritory: territoryPoints(settledBoard, "white").filter((p) => !excluded.has(pointKey(p))) };
}
