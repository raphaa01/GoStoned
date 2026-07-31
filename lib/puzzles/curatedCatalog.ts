import type { Board, Position } from "@/lib/game/types";
import { createEmptyBoard } from "@/lib/game/goEngine";
import { PUZZLE_CATEGORIES, type PuzzleCategory } from "./types";

export const CURATED_PUZZLE_SOURCE = {
  repository: "https://github.com/sanderland/tsumego",
  commit: "9d2ca58d3188f42a4bb1248d6c2c1ebbaca56ce4",
  license: "MIT",
} as const;

type SourceProblem = {
  id: string;
  black: readonly string[];
  white: readonly string[];
  solutions: readonly string[];
};

const CATALOG: Record<PuzzleCategory, readonly SourceProblem[]> = {
  life_and_death: [
    { id: "5-2-2-1", black: ["bq","br","eq","er"], white: ["bp","cp","dp","bn","eo","fp","fq","fr","hr"], solutions: ["bs","dq","es","aq"] },
    { id: "5-2-2-2", black: ["br","cr","eq","fq","gq","fr","gs"], white: ["ir","gr","hr","hq","hp","gp","fp","ep","dp","cq","bq","cn"], solutions: ["ds"] },
    { id: "5-2-2-3", black: ["br","cr","cq","dp","do","eq","fq"], white: ["hq","gp","fp","eo","en","cm","dn","co","cp","bp","bq","gr"], solutions: ["ds"] },
    { id: "5-2-2-4", black: ["co","cp","cq","bp","dr","er"], white: ["gq","fr","eq","dq","do","dn","cn","bn","bo","es"], solutions: ["br"] },
    { id: "5-2-2-5", black: ["dr","dq","dp","ep","fq","gq","hr"], white: ["ir","hq","hp","gp","fp","eo","do","co","cp","bq","cr","jq"], solutions: ["gs"] },
    { id: "5-2-2-6", black: ["bs","br","cq","cp","cn","bn"], white: ["dr","dq","dp","do","dn","dm","cm","bm","an","cr"], solutions: ["ap"] },
    { id: "5-2-2-7", black: ["cr","cq","cp","dp","ep","eq"], white: ["dr","fr","fq","fp","fo","eo","do","co","bo","dq"], solutions: ["ar"] },
    { id: "5-2-2-8", black: ["bq","cr","dq","eq","fr","do","eo"], white: ["hq","cq","cp","co","bp","cm","dn","fn","fo","fp","fq","gr"], solutions: ["ar","aq"] },
    { id: "5-2-2-9", black: ["br","cq","dp","ep","eq","er","fr"], white: ["gr","fq","fp","fo","dn","co","bp","bq","ar","hq"], solutions: ["bs"] },
    { id: "5-2-2-10", black: ["br","cr","cq","eq","fq","gq","hq","gr"], white: ["ir","iq","ip","hp","gp","fp","ep","dp","cp","bp","bq","ar","hr"], solutions: ["bs","dq","gs","fs"] },
  ],
  tesuji: [
    { id: "2-1", black: ["ar","bq","cq","cr","dp","ep","eq","fq","fr"], white: ["br","cs","dq","dr","er","fs","gr","gq","gp","cp","co","eo"], solutions: ["es"] },
    { id: "2-2", black: ["bs","br","cr","dq","cp","dp","ep","co","bn","cm"], white: ["ar","cq","bq","bp","bo","ao","dr","er","eq","fp","gq"], solutions: ["aq"] },
    { id: "2-3", black: ["br","cr","cq","dp","ep","gp","en","fn","dm","cm","bm"], white: ["bq","bp","bo","cp","cn","dn","do","em","el","bl","bk","dk"], solutions: ["bn"] },
    { id: "2-4", black: ["co","bp","bq","cq","dq","ep","eo","en","em","dm","cl","bk"], white: ["ar","br","cr","dr","er","eq","dp","do","dn","cn","bo"], solutions: ["bn"] },
    { id: "2-5", black: ["ar","bq","ap","ao","bo","co","cp","dp","eq","fp","fq","fr","fs"], white: ["br","cr","cq","dq","er","es","ep","eo","do","dn","cn","bn","an"], solutions: ["ds"] },
    { id: "2-6", black: ["aq","bq","br","cp","dp","eq","fq","fr","fs"], white: ["bs","cq","cr","dr","er","es","bp","bo","co"], solutions: ["cs"] },
    { id: "2-7", black: ["bs","br","bq","cp","dp","do","eq","fq","fr","fo"], white: ["cr","cq","dq","er","es","fs","gr","gq","gp","bp","bo","co","dn"], solutions: ["dr"] },
    { id: "2-8", black: ["dq","ep","fp","gq","gr","gs"], white: ["br","dr","eq","fq","fr","fs","cp","co","gp","hp"], solutions: ["es"] },
    { id: "2-9", black: ["cs","cr","br","bq","cp","co","cn","bm","am"], white: ["as","aq","bp","bo","bn","cq","dq","dr","ds"], solutions: ["ap"] },
    { id: "2-10", black: ["cq","cr","dr","bp","bo","co","do","eo","go","gp","gq","hr"], white: ["bs","br","bq","cp","dp","dq","er","fq","gr"], solutions: ["eq"] },
  ],
  capturing_race: [
    { id: "6-1-1", black: ["cq","cp","dp","ep","fq","gq","fr","hr"], white: ["jp","jr","hq","ir","hp","gp","fp","dr","dq","eq","gs"], solutions: ["es"] },
    { id: "6-1-2", black: ["hn","hp","ip","iq","eq","fq","er","dr","bq","bp","dp","do","eo","fo","go"], white: ["hq","gq","gp","ir","jr","jq","fp","ep","cr","cq","dq","fs"], solutions: ["gs"] },
    { id: "6-1-3", black: ["dn","eq","gp","fp","jr","ep","dp","fr","ir","cp","iq","hq","jp","jo","in","gm","en"], white: ["fq","gq","lq","kq","gr","er","bq","cq","jq","ip","hp","ho","go","fo","dq"], solutions: ["gs"] },
    { id: "6-1-4", black: ["bs","br","bq","cp","dp","do","fp","fo","hp","hq","hr"], white: ["bo","bp","gr","gq","eq","cr","cq","cn"], solutions: ["er"] },
    { id: "6-1-5", black: ["en","eo","fo","go","gp","gq","gr","cr","cq","cp","co","dn"], white: ["dm","do","dp","ep","fp","dr","bm","cn","bo","bp","bq","fr"], solutions: ["ds"] },
    { id: "6-1-6", black: ["cp","bp","bo","bq","dq","eq","ep","fn","fr","gq","es"], white: ["dm","dk","cq","cr","br","dr","dp","do","co","bn","er"], solutions: ["an"] },
    { id: "6-1-7", black: ["en","fn","go","fp","gp","gq","iq","bq","bo","co","dp","dq","dn"], white: ["fo","ep","eq","fq","dr","gn","eo","do","cm","cn","gm"], solutions: ["es"] },
    { id: "6-1-8", black: ["bq","cq","dp","ep","eo","en","fq","gq","gr"], white: ["fo","fn","fm","dm","co","cp","fr","eq","dq","cr","fp"], solutions: ["cs"] },
    { id: "6-1-9", black: ["dm","eo","do","dp","cp","cq","br","fr","fq","fp","go","ho","hm","fl","el"], white: ["er","fo","eq","ep","fn","fm","gp","hq","dq","bs","cr","bo","bp","bq","ir"], solutions: ["fs"] },
    { id: "6-1-10", black: ["cq","cr","dr","eq","ep","eo","dn","bn","bm"], white: ["fr","er","dq","dp","cp","bp","hq"], solutions: ["bq","ar"] },
  ],
  endgame: [
    { id: "3-3-2-1", black: ["ds","cs","cr","cq","bp","bo","bn","dp","ep"], white: ["fr","es","dr","dq","gp","fp","en","ck","cm","cn","co","cp","iq"], solutions: ["fq"] },
    { id: "3-3-2-2", black: ["dp","do","dn","cm","bm","eq","fo","as","bs","cr","cq","bq","aq"], white: ["cp","bp","br","cs","ds","dr","cn","bn","dl","dm","dq"], solutions: ["bo"] },
    { id: "3-3-2-3", black: ["bp","ao","co","do","dn","em","fn","fp","fk"], white: ["fq","dq","cp","dj","dl","dm","cn","bm","bn","bo","gq"], solutions: ["eq"] },
    { id: "3-3-2-4", black: ["ar","br","cq","dq","dp","eo","en","dm","go","jp"], white: ["ck","dk","el","em","dn","do","bo","cp","ap","aq","bq","bj"], solutions: ["bn"] },
    { id: "3-3-2-5", black: ["ds","er","eq","dp","co","cn","cl","em"], white: ["es","fs","fr","fq","go","fo","eo","do","hq"], solutions: ["dq"] },
    { id: "3-3-2-6", black: ["bn","bo","do","eo","fo","go","ho","hp","hq","hr","jr","dj"], white: ["gq","gp","fp","ep","dp","cp","bp","gr"], solutions: ["gs"] },
    { id: "3-3-2-7", black: ["dq","eq","fq","fr","cr","jq"], white: ["er","br","cq","cp","dp","cn","ck"], solutions: ["bs"] },
    { id: "3-3-2-8", black: ["cr","cq","cp","do","eo","fo","ep","cl","cj"], white: ["hq","gp","fp","eq","dq","dp","ho"], solutions: ["er"] },
    { id: "3-3-2-9", black: ["cs","br","bq","cp","co","cl","cj","dq","eq","fq","fr"], white: ["gr","gq","gp","fp","ep","dp","dr","cr","cq","jp"], solutions: ["es"] },
    { id: "3-3-2-10", black: ["cr","cq","dq","co","fp","gp","gn","cj","ej"], white: ["jq","dr","er","gq","hq","hp"], solutions: ["fr"] },
  ],
};

function sourcePoint(coordinate: string): Position {
  if (!/^[a-s]{2}$/.test(coordinate)) throw new Error(`Invalid source coordinate: ${coordinate}`);
  const x = coordinate.charCodeAt(0) - 97;
  const y = coordinate.charCodeAt(1) - 97 - 6;
  if (x < 0 || x >= 13 || y < 0 || y >= 13) {
    throw new Error(`Source coordinate does not fit the 13x13 crop: ${coordinate}`);
  }
  return { x, y };
}

function localMoves(points: readonly Position[]): Position[] {
  const minX = Math.max(0, Math.min(...points.map((point) => point.x)) - 1);
  const maxX = Math.min(12, Math.max(...points.map((point) => point.x)) + 1);
  const minY = Math.max(0, Math.min(...points.map((point) => point.y)) - 1);
  const maxY = Math.min(12, Math.max(...points.map((point) => point.y)) + 1);
  const result: Position[] = [];
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) result.push({ x, y });
  }
  return result;
}

export type CuratedPuzzle = {
  sourceId: string;
  board: Board;
  candidateMoves: Position[];
  localRegion: Position[];
};

export function curatedPuzzle(category: PuzzleCategory, collectionOrder: number): CuratedPuzzle {
  if (!PUZZLE_CATEGORIES.includes(category) || collectionOrder < 1 || collectionOrder > 10) {
    throw new Error("Unknown curated puzzle.");
  }
  const source = CATALOG[category][collectionOrder - 1];
  if (!source) throw new Error("Curated puzzle catalog is incomplete.");
  const board = createEmptyBoard(13);
  const black = source.black.map(sourcePoint);
  const white = source.white.map(sourcePoint);
  const candidateMoves = source.solutions.map(sourcePoint);
  for (const point of black) board[point.y][point.x] = "black";
  for (const point of white) {
    if (board[point.y][point.x]) throw new Error(`Overlapping source stones in ${source.id}.`);
    board[point.y][point.x] = "white";
  }
  for (const point of candidateMoves) {
    if (board[point.y][point.x]) throw new Error(`Occupied solution in ${source.id}.`);
  }
  return {
    sourceId: `${CURATED_PUZZLE_SOURCE.commit}:${source.id}`,
    board,
    candidateMoves,
    localRegion: localMoves([...black, ...white, ...candidateMoves]),
  };
}

export function curatedPuzzleCount(): number {
  return PUZZLE_CATEGORIES.reduce((count, category) => count + CATALOG[category].length, 0);
}
