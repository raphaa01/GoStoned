import type { Position, Stone } from "@/lib/game/types";
import type { LessonStep, LocalizedLine } from "./curriculum";
import { createLearnGame, passLearnMove, playLearnMove, stonesFromBoard, withLearnTurn, type LearnStone } from "./lessonEngine";

export const t = (de: string, en: string): LocalizedLine => ({ de, en });
export const p = (x: number, y: number): Position => ({ x, y });
export const b = (x: number, y: number): LearnStone => ({ x, y, color: "black" });
export const w = (x: number, y: number): LearnStone => ({ x, y, color: "white" });

export function task(id: string, size: number, stones: readonly LearnStone[], toPlay: Stone, targets: readonly Position[], body: LocalizedLine, success: LocalizedLine, wrong: LocalizedLine): LessonStep {
  const hintArea: Position[] = [];
  for (const target of targets) for (let y = Math.max(0,target.y-1); y <= Math.min(size-1,target.y+1); y++) for (let x = Math.max(0,target.x-1); x <= Math.min(size-1,target.x+1); x++) {
    if (!hintArea.some((point)=>point.x===x&&point.y===y)) hintArea.push(p(x,y));
  }
  return { id, kind: "play", size, stones, toPlay, targets, hintArea, body, task: t(`Spiele ${toPlay === "black" ? "Schwarz" : "Weiß"}.`, `Play ${toPlay === "black" ? "Black" : "White"}.`), success, wrong };
}
export function mark(id: string, size: number, stones: readonly LearnStone[], targets: readonly Position[], body: LocalizedLine, success: LocalizedLine, selectFrom: "empty" | "stone" = "empty"): LessonStep {
  return { id, kind: "select", size, stones, targets, selectFrom, body, task: t("Antworte durch Markieren auf dem Brett.", "Answer by marking on the board."), success, wrong: t("Dieser Punkt gehört nicht zum gesuchten Bereich. Prüfe die direkten Nachbarn.", "This point is not part of the requested area. Check its direct neighbors.") };
}
export function info(id: string, size: number, stones: readonly LearnStone[], body: LocalizedLine): LessonStep {
  return { id, kind: "info", size, stones, body };
}

/** Author a real line. Each decision has a restartable snapshot; continuation retains ko/history. */
export function sequence(id: string, size: number, stones: readonly LearnStone[], color: Stone, turns: readonly Readonly<{
  move: Position; replies?: readonly (Position | null)[]; body: LocalizedLine; success: LocalizedLine; wrong?: LocalizedLine;
}>[]): LessonStep[] {
  let position = withLearnTurn(createLearnGame(size, stones), color);
  return turns.map((turn, index) => {
    const step: LessonStep = { ...task(`${id}-${index}`, size, stonesFromBoard(position.board), position.turn, [turn.move], turn.body, turn.success,
      turn.wrong ?? t("Suche den Zug, der die gezeigte Gruppe weiter verfolgt oder verbindet.", "Find the move that continues chasing or connecting the shown group.")),
      continuePosition: index > 0, replies: turn.replies };
    for (const move of [turn.move, ...(turn.replies ?? [])]) {
      if (move === null) { position = passLearnMove(position); continue; }
      const next = playLearnMove(position, move);
      if (!next.ok) throw new Error(`Illegal authored continuation ${id}/${index}: ${JSON.stringify(move)} (${next.error})`);
      position = next.position;
    }
    return step;
  });
}

export function mirror(step: LessonStep, id: string): LessonStep {
  const point = (point: Position) => p(step.size! - 1 - point.x, point.y);
  return { ...step, id, stones: step.stones?.map((stone) => ({ ...point(stone), color: stone.color })),
    targets: step.targets?.map(point), emphasis: undefined, group: undefined, territory: undefined,
    replies: step.replies?.map((move) => move === null ? null : point(move)),
    hintArea: step.hintArea?.map(point),
    continuePosition: false };
}

/** A connected black wall surrounded by White, with only the specified eye space left. */
export function eyePosition(inner: readonly Position[]): LearnStone[] {
  const left = Math.min(...inner.map((point) => point.x)) - 1, right = Math.max(...inner.map((point) => point.x)) + 1;
  const top = Math.min(...inner.map((point) => point.y)) - 1, bottom = Math.max(...inner.map((point) => point.y)) + 1;
  const inside = new Set(inner.map(({ x, y }) => `${x}:${y}`));
  const stones: LearnStone[] = [];
  for (let y = top - 1; y <= bottom + 1; y++) for (let x = left - 1; x <= right + 1; x++) {
    if (!inside.has(`${x}:${y}`)) stones.push((x >= left && x <= right && y >= top && y <= bottom ? b : w)(x, y));
  }
  return stones;
}

export const STRAIGHT_THREE = eyePosition([p(2, 3), p(3, 3), p(4, 3)]);
export const BENT_THREE = eyePosition([p(2, 2), p(3, 2), p(2, 3)]);
export const T_FOUR = eyePosition([p(2, 2), p(3, 2), p(4, 2), p(3, 3)]);
export const SNAPBACK = [w(2, 0), w(0, 1), w(1, 1), b(2, 1), b(0, 2), b(1, 2), b(2, 2)];
export const DOUBLE_ATARI = [w(1, 2), w(3, 2), b(1, 1), b(1, 3), b(3, 1), b(3, 3)];
export const NET = [w(1, 1), b(0, 1), b(1, 0), b(3, 1), b(1, 3)];
export const RACE = [b(0, 1), b(1, 1), w(2, 1), w(3, 1), b(3, 0), b(4, 1)];

export function ladderSteps(breaker = false): LessonStep[] {
  const stones = [w(1, 1), b(0, 1), b(1, 0), b(2, 0), ...(breaker ? [w(4, 2)] : [])];
  return sequence(breaker ? "broken-ladder" : "ladder", 7, stones, "black", [
    { move: p(1, 2), replies: [p(2, 1)], body: t("Weiß hat zwei Freiheiten. Verfolge so, dass Weiß Richtung rechte Brettseite läuft.", "White has two liberties. Chase White toward the right side."), success: t("Weiß läuft nach rechts und hat wieder zwei Freiheiten.", "White runs right and has two liberties again.") },
    { move: p(3, 1), replies: [p(2, 2)], body: t("Nimm die Freiheit rechts. Weiß muss nach unten erweitern.", "Take the right liberty. White must extend downward."), success: t("Die Verfolgung wechselt zwischen rechts und unten.", "The chase alternates between right and down.") },
    { move: p(2, 3), replies: [p(3, 2)], body: t("Nimm die Freiheit unter der weißen Gruppe.", "Take the liberty below the white group."), success: breaker ? t("Weiß verbindet mit dem Stein rechts und hat mehr als zwei Freiheiten. Die Leiter ist gebrochen.", "White connects with the stone on the right and has more than two liberties. The ladder is broken.") : t("Weiß bleibt bei zwei Freiheiten. Dieses diagonale Verfolgen heißt Leiter.", "White still has two liberties. This diagonal chase is called a ladder.") },
    ...(!breaker ? [
      { move: p(4, 2), replies: [p(3, 3)], body: t("Nimm wieder die rechte Freiheit.", "Take the right liberty again."), success: t("Weiß wird weiter an den Rand gedrängt.", "White is pushed closer to the edge.") },
      { move: p(3, 4), replies: [p(4, 3)], body: t("Jetzt blockiere unter Weiß.", "Now block below White."), success: t("Die ganze Gruppe bleibt in der Leiter.", "The whole group stays in the ladder.") },
      { move: p(5, 3), replies: [p(4, 4)], body: t("Blockiere rechts.", "Block on the right."), success: t("Weiß hat nur zwei Freiheiten, obwohl die Gruppe wächst.", "White has only two liberties even as the group grows.") },
      { move: p(4, 5), replies: [p(5, 4)], body: t("Blockiere unten.", "Block below."), success: t("Der rechte Rand ist nahe.", "The right edge is close.") },
      { move: p(6, 4), replies: [p(5, 5)], body: t("Blockiere rechts am Rand.", "Block on the right edge."), success: t("Weiß läuft noch einmal nach unten.", "White extends downward once more.") },
      { move: p(5, 6), replies: [p(6, 5)], body: t("Blockiere unten am Rand.", "Block below on the bottom edge."), success: t("Der Rand lässt Weiß nur noch eine Freiheit.", "The edge leaves White with only one liberty.") },
      { move: p(6, 6), body: t("Nimm die letzte Freiheit der weißen Gruppe.", "Take the white group's last liberty."), success: t("Die ganze Gruppe wird geschlagen. Vor einer Leiter musst du ihren Weg bis zum Rand prüfen.", "The entire group is captured. Before starting a ladder, check its path all the way to the edge.") },
    ] : []),
  ]);
}
