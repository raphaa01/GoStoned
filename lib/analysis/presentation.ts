import { fromGtpCoordinate } from "./coordinates";
import type { MoveAnalysis } from "./types";
import { applyMove, countLiberties, getGroup, getNeighbors } from "@/lib/game/goEngine";
import type { Board, BoardSize, Stone } from "@/lib/game/types";
import type { Locale } from "@/lib/i18n/config";

export function normalizeWinrate(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  const probability = value > 1 && value <= 100 ? value / 100 : value;
  return Math.min(1, Math.max(0, probability));
}

export function fixedColorWinrates(move: Pick<MoveAnalysis, "color" | "winrateAfter">) {
  const mover = normalizeWinrate(move.winrateAfter);
  const black = move.color === "black" ? mover : 1 - mover;
  return { black, white: 1 - black };
}

export function formatWinrate(value: number): string {
  const percent = normalizeWinrate(value) * 100;
  if (percent >= 99.5) return ">99%";
  if (percent <= 0.5) return "<1%";
  return `${Math.round(percent)}%`;
}

export function fixedColorScoreLead(move: Pick<MoveAnalysis, "color" | "scoreLeadAfter">) {
  const blackLead = move.color === "black" ? move.scoreLeadAfter : -move.scoreLeadAfter;
  return blackLead >= 0
    ? { color: "black" as const, points: blackLead }
    : { color: "white" as const, points: -blackLead };
}

type MoveRegion = "corner" | "side" | "center";
type MoveShape = {
  captures: number;
  connections: number;
  liberties: number;
  pass: boolean;
  region: MoveRegion | null;
};

function moveShape(board: Board, size: BoardSize, color: Stone, move: string): MoveShape | null {
  let coordinate: ReturnType<typeof fromGtpCoordinate>;
  try {
    coordinate = fromGtpCoordinate(size, move);
  } catch {
    return null;
  }
  if (coordinate.isPass) return { captures: 0, connections: 0, liberties: 0, pass: true, region: null };
  if (coordinate.x === undefined || coordinate.y === undefined) return null;
  const position = { x: coordinate.x, y: coordinate.y };
  const adjacentFriendlyGroups = new Set<string>();
  for (const neighbor of getNeighbors(board, position)) {
    if (board[neighbor.y][neighbor.x] !== color) continue;
    const group = getGroup(board, neighbor);
    adjacentFriendlyGroups.add(group.map(({ x, y }) => `${x}:${y}`).sort().join("|"));
  }
  const result = applyMove(board, color, position.x, position.y);
  if (!result.ok) return null;
  const group = getGroup(result.board, position);
  const edgeDistance = Math.min(position.x, position.y, size - 1 - position.x, size - 1 - position.y);
  const nearHorizontalEdge = Math.min(position.x, size - 1 - position.x) <= Math.max(2, Math.floor(size / 5));
  const nearVerticalEdge = Math.min(position.y, size - 1 - position.y) <= Math.max(2, Math.floor(size / 5));
  return {
    captures: result.captured.length,
    connections: adjacentFriendlyGroups.size,
    liberties: countLiberties(result.board, group),
    pass: false,
    region: nearHorizontalEdge && nearVerticalEdge
      ? "corner"
      : edgeDistance <= Math.max(2, Math.floor(size / 5)) ? "side" : "center",
  };
}

function germanShape(move: string, shape: MoveShape): string {
  if (shape.pass) return `${move} passt und verändert das Brett nicht.`;
  if (shape.captures > 0) return `${move} fängt ${shape.captures} ${shape.captures === 1 ? "Stein" : "Steine"}.`;
  if (shape.connections > 0) return `${move} verbindet ${shape.connections} benachbarte ${shape.connections === 1 ? "Gruppe" : "Gruppen"}.`;
  const region = shape.region === "corner" ? "in Eckennähe" : shape.region === "side" ? "am Rand" : "im Zentrum";
  return `${move} spielt ${region} und gibt der Gruppe ${shape.liberties} ${shape.liberties === 1 ? "Freiheit" : "Freiheiten"}.`;
}

function englishShape(move: string, shape: MoveShape): string {
  if (shape.pass) return `${move} passes and leaves the board unchanged.`;
  if (shape.captures > 0) return `${move} captures ${shape.captures} ${shape.captures === 1 ? "stone" : "stones"}.`;
  if (shape.connections > 0) return `${move} connects ${shape.connections} adjacent ${shape.connections === 1 ? "group" : "groups"}.`;
  const region = shape.region === "corner" ? "near a corner" : shape.region === "side" ? "along the side" : "in the center";
  return `${move} plays ${region} and gives the group ${shape.liberties} ${shape.liberties === 1 ? "liberty" : "liberties"}.`;
}

function kyrgyzShape(move: string, shape: MoveShape): string {
  if (shape.pass) return `${move} пас берет жана тактаны өзгөртпөйт.`;
  if (shape.captures > 0) return `${move} ${shape.captures} ташты алат.`;
  if (shape.connections > 0) return `${move} коңшу ${shape.connections} топту бириктирет.`;
  const region = shape.region === "corner" ? "бурчка жакын" : shape.region === "side" ? "четке" : "борборго";
  return `${move} ${region} ойнолуп, топко ${shape.liberties} дем берет.`;
}

export function moveExplanation(move: MoveAnalysis, boardBefore: Board, size: BoardSize, locale: Locale): string {
  if (locale !== "de" && locale !== "en" && locale !== "ky") return move.explanation[locale] ?? move.explanation.en;
  const played = moveShape(boardBefore, size, move.color, move.playedMove);
  const best = moveShape(boardBefore, size, move.color, move.bestMove);
  const sameMove = move.playedMove.toLowerCase() === move.bestMove.toLowerCase();

  if (locale === "de") {
    if (sameMove) return played
      ? `KataGos erste Wahl. ${germanShape(move.playedMove, played)}`
      : `${move.playedMove} ist KataGos erste Wahl.`;
    return `KataGo empfiehlt ${move.bestMove}. ${best ? germanShape(move.bestMove, best) : ""}${played ? ` Dein Zug: ${germanShape(move.playedMove, played)}` : ""}`.trim();
  }

  if (locale === "ky") {
    if (sameMove) return played
      ? `KataGo да ушул жүрүштү тандайт. ${kyrgyzShape(move.playedMove, played)}`
      : `${move.playedMove} — KataGoнун биринчи тандоосу.`;
    return `KataGo ${move.bestMove} жүрүшүн сунуштайт. ${best ? kyrgyzShape(move.bestMove, best) : ""}${played ? ` Сиздин жүрүшүңүз: ${kyrgyzShape(move.playedMove, played)}` : ""}`.trim();
  }

  if (sameMove) return played
    ? `KataGo's first choice. ${englishShape(move.playedMove, played)}`
    : `${move.playedMove} is KataGo's first choice.`;
  return `KataGo recommends ${move.bestMove}. ${best ? englishShape(move.bestMove, best) : ""}${played ? ` Your move: ${englishShape(move.playedMove, played)}` : ""}`.trim();
}
