import { bit } from './engine.mjs';
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

export class DiversityIndex {
  constructor(puzzles = []) {
    this.exact = new Set(); this.families = new Set(); this.shapes = [];
    for (const puzzle of puzzles) this.add(puzzle);
  }
  duplicate(puzzle) {
    const prints = fingerprints({ cells: puzzle.cells, mask: 2 ** puzzle.cells.length - 1 }, puzzle.initial);
    if (this.exact.has(prints.position)) return 'duplicate';
    if (this.families.has(prints.family)) return 'same-motif';
    const views = tacticalViews(puzzle);
    for (const previous of this.shapes) {
      if (Math.abs(previous.size - views[0].size) > 2) continue;
      for (const view of views) {
        let intersection = 0;
        for (const point of view) if (previous.has(point)) intersection++;
        const union = previous.size + view.size - intersection;
        if (intersection / union >= 0.84 || (Math.min(previous.size, view.size) >= 5 && union - intersection <= 1)) return 'near-duplicate';
      }
    }
    return null;
  }
  add(puzzle) {
    this.exact.add(puzzle.fingerprints.position);
    this.families.add(puzzle.fingerprints.family);
    this.shapes.push(tacticalViews(puzzle)[0]);
  }
}
