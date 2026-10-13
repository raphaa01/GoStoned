import type { BoardSize, Position } from "./types";
import { scoreLearnGame } from "@/lib/learn/gameScoring";

export type LocalSettlement = ReturnType<typeof scoreLearnGame>;

export function scoreLocalSettlement(body: Record<string, unknown>) {
  const invalid = () => { throw new Error("invalid_local_settlement"); };
  const size = body.boardSize;
  if (size !== 9 && size !== 13 && size !== 19) return invalid();
  const allowed = new Set(["boardSize", "moves", "deadStones", "neutralRegionSeeds", "blackAgreed", "whiteAgreed"]);
  if (Object.keys(body).some((key) => !allowed.has(key))
    || typeof body.blackAgreed !== "boolean" || typeof body.whiteAgreed !== "boolean") return invalid();
  function point(value: unknown): Position {
    if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
    const p = value as Record<string, unknown>;
    if (Object.keys(p).length !== 2 || !Number.isInteger(p.x) || !Number.isInteger(p.y)
      || Number(p.x) < 0 || Number(p.x) >= Number(size) || Number(p.y) < 0 || Number(p.y) >= Number(size)) return invalid();
    return { x: Number(p.x), y: Number(p.y) };
  }
  if (!Array.isArray(body.moves) || body.moves.length > 3000
    || !Array.isArray(body.deadStones) || body.deadStones.length > size * size
    || !Array.isArray(body.neutralRegionSeeds) || body.neutralRegionSeeds.length > size * size) return invalid();
  const result = scoreLearnGame(body.moves.map((p) => p === null ? null : point(p)),
    body.deadStones.map(point), body.neutralRegionSeeds.map(point), size as BoardSize);
  return { result, finalized: body.blackAgreed && body.whiteAgreed };
}
