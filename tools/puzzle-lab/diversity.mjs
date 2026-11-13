import { bit, Chamber } from './engine.mjs';
import { fingerprints } from './generator.mjs';

export function tacticalViews(puzzle) {
  const points = puzzle.cells.flatMap(([x, y], i) => puzzle.initial.white & bit(i) ? [] : [[x, y, puzzle.initial.black & bit(i) ? 'B' : '.']]);
  return Array.from({ length: 8 }, (_, symmetry) => {
    const transformed = points.map(([x, y, color]) => {
      if (symmetry & 4) x = -x;
      for (let rotation = 0; rotation < (symmetry & 3); rotation++) [x, y] = [-y, x];
      return [x, y, color];
    });
    const minX = Math.min(...transformed.map(([x]) => x));
    const minY = Math.min(...transformed.map(([, y]) => y));
    return new Set(transformed.map(([x, y, color]) => `${x - minX},${y - minY}:${color}`));
  });
}

export function continuationKeys(puzzle) {
  if (puzzle.ownMoves < 3 || !puzzle.solution) return [];
  const chamber = new Chamber(puzzle.cells, puzzle.layout);
  let state = puzzle.initial;
  const keys = [];
  for (const { color, move } of puzzle.solution.slice(0, 2)) {
    state = chamber.play(state, color, move);
    if (!state) return [];
    keys.push(`${puzzle.ownMoves - 1}:${3 - color}:${fingerprints(chamber, state).family}`);
  }
  return keys;
}

// Compare the moves themselves, not the decorative surrounding stones.
// Relative coordinates, attacker/defender roles and all eight symmetries
// remove translation, rotation, reflection and physical color swapping.
export function solutionViews(puzzle) {
  if (puzzle.ownMoves < 3 || !puzzle.solution?.length) return [];
  const points = puzzle.solution.filter((ply) => ply.move >= 0).map((ply) => [...puzzle.cells[ply.move], ply.color]);
  return Array.from({ length: 8 }, (_, symmetry) => {
    const transformed = points.map(([x, y, role]) => {
      if (symmetry & 4) x = -x;
      for (let r = 0; r < (symmetry & 3); r++) [x, y] = [-y, x];
      return [x, y, role];
    });
    const minX = Math.min(...transformed.map(([x]) => x)), minY = Math.min(...transformed.map(([, y]) => y));
    return new Set(transformed.map(([x, y, role]) => `${x - minX},${y - minY}:${role}`));
  });
}
export function solutionPattern(puzzle) {
  const views = solutionViews(puzzle);
  return views.length ? `${puzzle.ownMoves}:${views.map((view) => [...view].sort().join(';')).sort()[0]}` : null;
}

export function targetViews(puzzle) {
  if (puzzle.target === undefined || !(puzzle.initial.white & bit(puzzle.target))) return [];
  const group = new Chamber(puzzle.cells, puzzle.layout).group(puzzle.initial.white, puzzle.target);
  const points = puzzle.cells.filter((_, i) => group & bit(i));
  return Array.from({ length: 8 }, (_, symmetry) => {
    const transformed = points.map(([x, y]) => {
      if (symmetry & 4) x = -x;
      for (let r = 0; r < (symmetry & 3); r++) [x, y] = [-y, x];
      return [x, y];
    });
    const minX = Math.min(...transformed.map(([x]) => x)), minY = Math.min(...transformed.map(([, y]) => y));
    return new Set(transformed.map(([x, y]) => `${x - minX},${y - minY}`));
  });
}

function translatedOverlap(view, previous) {
  const offsets=new Map(); let maximum=0;
  const left=[...view].map((point)=>point.split(',').map(Number));
  const right=[...previous].map((point)=>point.split(',').map(Number));
  // Align every possible pair of points, not just the bounding-box corners.
  // Adding one outer stone can move a box corner while leaving the entire
  // old tactical group unchanged. Each offset's frequency is its overlap.
  for(const [x,y] of left) for(const [px,py] of right) {
    const key=`${px-x},${py-y}`, count=(offsets.get(key)??0)+1;
    offsets.set(key,count); maximum=Math.max(maximum,count);
  }
  return maximum;
}

export class DiversityIndex {
  constructor(puzzles = []) {
    this.exact = new Set(); this.families = new Set(); this.cores = new Set(); this.shapes = []; this.patterns = new Set(); this.moveShapes = []; this.targetShapes = [];
    for (const puzzle of puzzles) this.add(puzzle);
  }
  duplicate(puzzle) {
    const prints = fingerprints({ cells: puzzle.cells, mask: 2 ** puzzle.cells.length - 1 }, puzzle.initial);
    if (this.exact.has(prints.position)) return 'duplicate';
    if (this.families.has(prints.family)) return 'same-motif';
    if (continuationKeys(puzzle).some((core) => this.cores.has(core))) return 'same-continuation';
    const pattern = solutionPattern(puzzle);
    if (pattern && this.patterns.has(pattern)) return 'same-solution-pattern';
    const moveViews = solutionViews(puzzle);
    for (const previous of this.moveShapes) {
      if (previous.ownMoves !== puzzle.ownMoves) continue;
      for (const view of moveViews) {
        let shared = 0;
        for (const point of view) if (previous.shape.has(point)) shared++;
        // Conservative rejection: at most one changed played point, with
        // at least 85% of the smaller move pattern shared.
        const union = view.size + previous.shape.size - shared;
        if (shared / Math.min(view.size, previous.shape.size) >= .85 && union - shared <= 1) return 'similar-solution-pattern';
      }
    }
    const targets=targetViews(puzzle);
    for (const previous of this.targetShapes) for (const view of targets) {
      if(Math.abs(previous.size-view.size)>2) continue;
      const shared = translatedOverlap(view, previous);
      const difference = previous.size + view.size - 2 * shared;
      if (difference === 0) return 'same-target-shape';
      if (Math.min(previous.size, view.size) >= 4 && shared / Math.min(previous.size, view.size) >= .8 && difference <= 2) return 'similar-target-shape';
    }
    const views = tacticalViews(puzzle);
    for (const previous of this.shapes) {
      if (Math.abs(previous.size - views[0].size) > 2) continue;
      for (const view of views) {
        let intersection = 0;
        for (const point of view) if (previous.has(point)) intersection++;
        const union = previous.size + view.size - intersection;
        const smaller = Math.min(previous.size, view.size);
        if (intersection / union >= 0.84 || (smaller >= 6 && intersection / smaller >= .85) || (smaller >= 5 && union - intersection <= 1)) return 'near-duplicate';
      }
    }
    return null;
  }
  add(puzzle) {
    this.exact.add(puzzle.fingerprints.position);
    this.families.add(puzzle.fingerprints.family);
    for (const core of puzzle.cores ?? continuationKeys(puzzle)) this.cores.add(core);
    this.shapes.push(tacticalViews(puzzle)[0]);
    const pattern = solutionPattern(puzzle);
    if (pattern) { this.patterns.add(pattern); this.moveShapes.push({ ownMoves: puzzle.ownMoves, shape: solutionViews(puzzle)[0] }); }
    const targets = targetViews(puzzle);
    if (targets.length) this.targetShapes.push(targets[0]);
  }
}
