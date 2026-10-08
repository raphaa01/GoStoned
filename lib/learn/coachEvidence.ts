import { countLiberties, getGroup, getNeighbors } from "@/lib/game/goEngine";
import type { Board, Position, Stone } from "@/lib/game/types";
import type { GoStoneBotMove } from "@/lib/bot/modelV1";
import { applyTrainingAction, type TrainingPosition } from "./trainingGame";
import { trainerBestMove, trainerBlackLead, type TrainerPositionAnalysis } from "./aiTrainer";
import { COACH_JUDGEMENTS, COACH_REASONS, type CoachJudgement, type CoachReason } from "./coachModel";

export type CoachStats = { captured: number; threatened: number; libertiesBefore: number; libertiesAfter: number; libertiesGained: number; connected: number; lost: number };
export type CoachEvidence = {
  context: Float32Array; board: Float32Array; facts: string[]; judgement: CoachJudgement;
  loss: number; stable: boolean; extraordinary: boolean; size: number;
  numbers: CoachStats; alternativeNumbers: CoachStats;
  reasons: CoachReason[]; marks: Partial<Record<CoachReason, Position[]>>;
  alternative: Position | null;
};

const key = (p: Position) => `${p.x}:${p.y}`;
const unique = (points: Position[]) => [...new Map(points.map(p => [key(p), p])).values()];

function groups(board: Board, color: Stone): Position[][] {
  const visited = new Set<string>();
  const result: Position[][] = [];
  board.forEach((row, y) => row.forEach((stone, x) => {
    if (stone !== color || visited.has(key({ x, y }))) return;
    const group = getGroup(board, { x, y });
    group.forEach(p => visited.add(key(p)));
    result.push(group);
  }));
  return result;
}

function physical(before: TrainingPosition, after: TrainingPosition, move: GoStoneBotMove) {
  const facts: string[] = [];
  const marks: Partial<Record<CoachReason, Position[]>> = {};
  const stats: CoachStats = { captured: 0, threatened: 0, libertiesBefore: 0, libertiesAfter: 0, libertiesGained: 0, connected: 0, lost: 0 };
  if (move.kind === "pass") return { facts: ["pass"], stats, marks };
  const own = before.turn;
  const enemy = own === "black" ? "white" : "black";
  const point = { x: move.x, y: move.y };
  const beforeGroups = groups(before.board, own);
  const adjacent = beforeGroups.filter(g => g.some(p => getNeighbors(before.board, point).some(n => key(p) === key(n))));
  const newGroup = getGroup(after.board, point);
  stats.libertiesBefore = adjacent.length ? Math.min(...adjacent.map(g => countLiberties(before.board, g))) : 0;
  stats.libertiesAfter = countLiberties(after.board, newGroup);
  stats.libertiesGained = stats.libertiesAfter - stats.libertiesBefore;
  stats.connected = adjacent.length;
  const captured = groups(before.board, enemy).flat().filter(p => after.board[p.y][p.x] !== enemy);
  stats.captured = captured.length;
  if (captured.length) { facts.push("capture"); marks.capture = captured; }
  if (adjacent.length >= 2) { facts.push("connect"); marks.connect = newGroup; }
  if (adjacent.length && stats.libertiesAfter > stats.libertiesBefore) { facts.push("liberties"); marks.liberties = newGroup; }
  if (adjacent.some(g => countLiberties(before.board, g) === 1) && stats.libertiesAfter >= 2) { facts.push("save"); marks.save = newGroup; }
  // Atari means exactly one liberty; only newly threatened adjacent enemy groups.
  const threatened = groups(after.board, enemy).filter(g => countLiberties(after.board, g) === 1
    && g.some(p => getNeighbors(after.board, point).some(n => key(p) === key(n)))
    && countLiberties(before.board, getGroup(before.board, g[0])) > 1).flat();
  stats.threatened = threatened.length;
  if (threatened.length) { facts.push("enemy_atari"); marks.enemy_atari = threatened; }
  if (stats.libertiesAfter === 1) {
    const liberty = unique(newGroup.flatMap(p => getNeighbors(after.board, p))).find(p => after.board[p.y][p.x] === null);
    if (liberty) {
      const reply = applyTrainingAction(after, { kind: "play", ...liberty });
      if (reply.ok && newGroup.every(p => reply.position.board[p.y][p.x] !== own)) {
        facts.push("own_threat"); marks.own_threat = newGroup;
        stats.lost = newGroup.length;
      }
    }
  }
  // Geometry alone proves placement, not a strategic plan, ladder, life or death.
  const early = before.moves.length < Math.min(20, before.boardSize * before.boardSize * .15);
  const separated = beforeGroups.flat().every(p => Math.abs(p.x - point.x) + Math.abs(p.y - point.y) > 4);
  if (early && separated) {
    const third = Math.ceil(before.boardSize / 3);
    const edgeX = point.x < third || point.x >= before.boardSize - third;
    const edgeY = point.y < third || point.y >= before.boardSize - third;
    const reason = edgeX && edgeY ? "opening_corner" : edgeX || edgeY ? "opening_side" : "opening_center";
    facts.push(reason);
    if (reason !== "opening_center") marks[reason] = [point];
  }
  return { facts, stats, marks };
}

export function coachJudgement(loss: number, stable: boolean): CoachJudgement {
  return !stable ? "uncertain" : loss >= 8 ? "blunder" : loss >= 3 ? "mistake" : loss >= 1 ? "inaccuracy" : "good";
}

export function buildCoachEvidence(before: TrainingPosition, after: TrainingPosition, baseline: TrainerPositionAnalysis, current: TrainerPositionAnalysis, confirmed = false): CoachEvidence {
  if (before.turn !== "black" || after.turn !== "white" || before.boardSize !== after.boardSize || after.moves.at(-1)?.color !== "black" || after.moves.length !== before.moves.length + 1) throw new Error("Coach only explains a single human move.");
  // trainerBestMove also validates that each analysis belongs to this position.
  const alternativeMove = trainerBestMove(before, baseline);
  trainerBestMove(after, current);
  const best = baseline.moveInfos.find(m => {
    const point = alternativeMove.kind === "pass" ? "pass" : "ABCDEFGHJKLMNOPQRST"[alternativeMove.x] + (before.boardSize - alternativeMove.y);
    return m.move.toLowerCase() === point.toLowerCase();
  })!;
  const loss = Math.max(0, best.scoreLead - trainerBlackLead(current));
  const stable = baseline.rootInfo.visits >= 8 && current.rootInfo.visits >= 8 && best.visits >= 2;
  // A retry prompt needs a second, consistent evaluation, not a noisy quick scan.
  const judgement = coachJudgement(loss, stable);
  const last = after.moves.at(-1)!;
  const move: GoStoneBotMove = last.isPass ? { kind: "pass" } : { kind: "play", x: last.x!, y: last.y! };
  const played = physical(before, after, move);
  const alternativeResult = applyTrainingAction(before, alternativeMove);
  if (!alternativeResult.ok) throw new Error("The coach alternative is illegal.");
  const alternative = physical(before, alternativeResult.position, alternativeMove);
  const facts = [...played.facts.map(f => `played:${f}`), ...alternative.facts.map(f => `alternative:${f}`)];
  facts.push(`played:${judgement === "good" ? "quiet_good" : judgement === "uncertain" ? "quiet_uncertain" : "quiet_error"}`);
  const reasons = COACH_REASONS.filter(reason => played.facts.includes(reason));
  reasons.push(judgement === "uncertain" ? "uncertain" : judgement === "good" ? "good" : "score_loss");
  const context = new Float32Array(63);
  COACH_REASONS.forEach((r, i) => { context[i] = reasons.includes(r) ? 1 : 0; context[39 + i] = alternative.facts.includes(r) ? 1 : 0; });
  context[39 + COACH_REASONS.indexOf(stable ? "good" : "uncertain")] = 1;
  context[20 + COACH_JUDGEMENTS.indexOf(judgement)] = 1;
  const cap = (n: number, d: number) => Math.min(Math.max(n, 0) / d, 1);
  const prev = before.moves.at(-1);
  context.set([before.boardSize / 19, cap(before.moves.length, 100), cap(loss, 20), stable ? 1 : 0,
    cap(played.stats.captured, 10), cap(played.stats.threatened, 10), cap(played.stats.libertiesBefore, 10), cap(played.stats.libertiesAfter, 10), cap(played.stats.connected, 4), cap(played.stats.lost, 10), last.isPass ? 1 : 0,
    !last.isPass && prev && !prev.isPass ? cap(Math.abs(last.x! - prev.x!) + Math.abs(last.y! - prev.y!), 19) : 0,
    cap(groups(after.board, before.turn).length, 12), cap(groups(after.board, after.turn).length, 12)], 25);
  context.set([cap(alternative.stats.captured, 10), cap(alternative.stats.connected, 4), cap(alternative.stats.libertiesAfter, 10), cap(alternative.stats.lost, 10)], 59);
  const board = new Float32Array(11 * 19 * 19);
  const mark = (plane: number, p: Position) => { board[plane * 361 + p.y * 19 + p.x] = 1; };
  before.board.forEach((row, y) => row.forEach((stone, x) => {
    const p = { x, y }; mark(7, p);
    if (stone) mark(stone === before.turn ? 0 : 1, p);
    const now = after.board[y][x]; if (now) mark(now === before.turn ? 2 : 3, p);
    const alt = alternativeResult.position.board[y][x]; if (alt) mark(alt === before.turn ? 8 : 9, p);
  }));
  if (move.kind === "play") mark(4, move);
  if (prev && !prev.isPass) mark(5, { x: prev.x!, y: prev.y! });
  Object.values(played.marks).flat().forEach(p => mark(6, p));
  if (alternativeMove.kind === "play") mark(10, alternativeMove);
  const runnerUp = [...baseline.moveInfos].sort((a, b) => a.order - b.order)[1];
  return { context, board, facts, judgement, loss, stable, size: before.boardSize,
    extraordinary: confirmed && judgement === "good" && move.kind === "play" && alternativeMove.kind === "play" && move.x === alternativeMove.x && move.y === alternativeMove.y
      && !!runnerUp && runnerUp.visits >= 8 && best.scoreLead - runnerUp.scoreLead >= 2,
    numbers: played.stats, alternativeNumbers: alternative.stats, reasons, marks: played.marks,
    alternative: alternativeMove.kind === "play" ? { x: alternativeMove.x, y: alternativeMove.y } : null };
}

export function coachInfluence(position: TrainingPosition, analysis: TrainerPositionAnalysis) {
  if (analysis.turnNumber !== position.moves.length || analysis.rootInfo.currentPlayer !== (position.turn === "black" ? "B" : "W")) throw new Error("Stale ownership estimate.");
  const areas = { black: [] as Position[], white: [] as Position[] };
  analysis.ownership?.forEach((value, index) => {
    // Native config reports ALL outputs, including ownership, as SIDETOMOVE.
    const blackValue = analysis.rootInfo.currentPlayer === "B" ? value : -value;
    const p = { x: index % position.boardSize, y: Math.floor(index / position.boardSize) };
    if (!position.board[p.y][p.x]) {
      if (blackValue > .55) areas.black.push(p);
      if (blackValue < -.55) areas.white.push(p);
    }
  });
  return areas;
}
