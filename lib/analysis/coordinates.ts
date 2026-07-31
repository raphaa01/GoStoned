import type { BoardSize, StoredMove } from "@/lib/game/types";

const GTP_COLUMNS = "ABCDEFGHJKLMNOPQRST";

export function toGtpCoordinate(
  boardSize: BoardSize,
  move: Pick<StoredMove, "x" | "y" | "isPass">,
): string {
  if (move.isPass) return "pass";
  if (move.x === null || move.y === null) {
    throw new Error("A non-pass move requires board coordinates.");
  }
  if (move.x < 0 || move.y < 0 || move.x >= boardSize || move.y >= boardSize) {
    throw new Error("Move coordinates are outside the board.");
  }
  return `${GTP_COLUMNS[move.x]}${boardSize - move.y}`;
}

export function fromGtpCoordinate(
  boardSize: BoardSize,
  coordinate: string,
): { x?: number; y?: number; isPass?: boolean } {
  if (coordinate.toLowerCase() === "pass") return { isPass: true };
  const match = /^([A-HJ-T])(\d{1,2})$/i.exec(coordinate);
  if (!match) throw new Error("KataGo returned an invalid coordinate.");
  const x = GTP_COLUMNS.indexOf(match[1].toUpperCase());
  const row = Number(match[2]);
  const y = boardSize - row;
  if (x < 0 || x >= boardSize || row < 1 || row > boardSize || y < 0 || y >= boardSize) {
    throw new Error("KataGo returned a coordinate outside the board.");
  }
  return { x, y };
}

export function coordinateRegion(move: string, boardSize: BoardSize): "corner" | "side" | "center" | "pass" {
  if (move.toLowerCase() === "pass") return "pass";
  const match = /^([A-HJ-T])(\d{1,2})$/.exec(move.toUpperCase());
  if (!match) return "center";
  const x = GTP_COLUMNS.indexOf(match[1]);
  const yFromBottom = Number(match[2]) - 1;
  const edgeDistance = Math.min(x, boardSize - 1 - x, yFromBottom, boardSize - 1 - yFromBottom);
  const nearHorizontalEdge = Math.min(x, boardSize - 1 - x) <= 3;
  const nearVerticalEdge = Math.min(yFromBottom, boardSize - 1 - yFromBottom) <= 3;
  if (nearHorizontalEdge && nearVerticalEdge) return "corner";
  if (edgeDistance <= 3) return "side";
  return "center";
}
