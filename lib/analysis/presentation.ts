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

type MoveShape = { captures: number; connections: number; liberties: number; pass: boolean };

function moveShape(board: Board, size: BoardSize, color: Stone, move: string): MoveShape | null {
  let coordinate: ReturnType<typeof fromGtpCoordinate>;
  try {
    coordinate = fromGtpCoordinate(size, move);
  } catch {
    return null;
  }
  if (coordinate.isPass) return { captures: 0, connections: 0, liberties: 0, pass: true };
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
  return {
    captures: result.captured.length,
    connections: adjacentFriendlyGroups.size,
    liberties: countLiberties(result.board, group),
    pass: false,
  };
}

function germanShape(move: string, shape: MoveShape): string {
  if (shape.pass) return `${move} gibt den Zug ab und verändert das Brett nicht.`;
  const facts: string[] = [];
  if (shape.captures > 0) facts.push(`fängt ${shape.captures} ${shape.captures === 1 ? "Stein" : "Steine"}`);
  if (shape.connections > 0) facts.push(`verbindet ${shape.connections} benachbarte ${shape.connections === 1 ? "Gruppe" : "Gruppen"}`);
  facts.push(`lässt die neue Gruppe mit ${shape.liberties} ${shape.liberties === 1 ? "Freiheit" : "Freiheiten"}`);
  return `${move} ${facts.join(", ")}.`;
}

function englishShape(move: string, shape: MoveShape): string {
  if (shape.pass) return `${move} yields the turn and does not change the board.`;
  const facts: string[] = [];
  if (shape.captures > 0) facts.push(`captures ${shape.captures} ${shape.captures === 1 ? "stone" : "stones"}`);
  if (shape.connections > 0) facts.push(`connects ${shape.connections} adjacent ${shape.connections === 1 ? "group" : "groups"}`);
  facts.push(`leaves the new group with ${shape.liberties} ${shape.liberties === 1 ? "liberty" : "liberties"}`);
  return `${move} ${facts.join(", ")}.`;
}

export function moveExplanation(move: MoveAnalysis, boardBefore: Board, size: BoardSize, locale: Locale): string {
  if (locale !== "de" && locale !== "en") return move.explanation[locale];
  const played = moveShape(boardBefore, size, move.color, move.playedMove);
  const best = moveShape(boardBefore, size, move.color, move.bestMove);
  const chanceLoss = normalizeWinrate(move.winrateLoss) * 100;
  const sameMove = move.playedMove.toLowerCase() === move.bestMove.toLowerCase();
  const variation = move.alternatives[0]?.pv.slice(0, 4).join(" – ") ?? "";

  if (locale === "de") {
    const verdict = sameMove
      ? `${move.playedMove} entspricht KataGos erster Wahl.`
      : `KataGo bevorzugt ${move.bestMove} gegenüber dem gespielten Zug ${move.playedMove}.`;
    const impact = sameMove
      ? "Der Zug hält die Bewertung der Stellung praktisch stabil."
      : `Die Alternative bewahrt ungefähr ${chanceLoss.toFixed(1)} Prozentpunkte Gewinnchance und ${Math.max(0, move.scoreLoss).toFixed(1)} Punkte mehr.`;
    const boardFacts = sameMove
      ? played ? germanShape(move.playedMove, played) : ""
      : [played ? `Gespielt: ${germanShape(move.playedMove, played)}` : "", best ? `Vorschlag: ${germanShape(move.bestMove, best)}` : ""].filter(Boolean).join(" ");
    return `${verdict} ${impact}${boardFacts ? ` ${boardFacts}` : ""}${variation ? ` Berechnete Fortsetzung: ${variation}.` : ""}`;
  }

  const verdict = sameMove
    ? `${move.playedMove} matches KataGo's first choice.`
    : `KataGo prefers ${move.bestMove} to the played move ${move.playedMove}.`;
  const impact = sameMove
    ? "The move keeps the position's evaluation effectively stable."
    : `The alternative preserves about ${chanceLoss.toFixed(1)} percentage points of winning chance and ${Math.max(0, move.scoreLoss).toFixed(1)} more points.`;
  const boardFacts = sameMove
    ? played ? englishShape(move.playedMove, played) : ""
    : [played ? `Played: ${englishShape(move.playedMove, played)}` : "", best ? `Suggestion: ${englishShape(move.bestMove, best)}` : ""].filter(Boolean).join(" ");
  return `${verdict} ${impact}${boardFacts ? ` ${boardFacts}` : ""}${variation ? ` Calculated continuation: ${variation}.` : ""}`;
}
