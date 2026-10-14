import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyMove, getNeighbors, getGroup, boardHash } from '../../lib/game/goEngine.ts';
import { BLACK, WHITE, Chamber } from './engine.mjs';
import { analyze, materialize, verifyPuzzle } from './generator.mjs';
import { DiversityIndex } from './diversity.mjs';
import { Store } from './store.mjs';

const pointKey = ({ x, y }) => `${x},${y}`;
function whiteHasTwoEyes(board, target) {
  if (board[target.y][target.x] !== 'white') return false;
  const block = new Set(getGroup(board, target).map(pointKey)), visited = new Set();
  let eyes = 0;
  for (let y = 0; y < board.length; y++) for (let x = 0; x < board.length; x++) {
    if (board[y][x] !== null || visited.has(`${x},${y}`)) continue;
    const region = [], pending = [{ x, y }];
    let enclosed = true, vital = true;
    while (pending.length) {
      const current = pending.pop(), key = pointKey(current);
      if (visited.has(key)) continue;
      visited.add(key); region.push(current);
      const adjacent = getNeighbors(board, current);
      if (!adjacent.some((p) => block.has(pointKey(p)))) vital = false;
      for (const p of adjacent) {
        if (board[p.y][p.x] === null) { if (!visited.has(pointKey(p))) pending.push(p); }
        else if (!block.has(pointKey(p))) enclosed = false;
      }
    }
    if (region.length && enclosed && vital && ++eyes >= 2) return true;
  }
  return false;
}

// A second rules implementation replays physical boards, captures, repetition
// and every terminal. It does not use bitmask groups or the solver's eye test.
export function auditPuzzle(puzzle, { reSolve = false } = {}) {
  verifyPuzzle(puzzle);
  const physical = materialize(puzzle);
  const base = physical.board.map((row) => row.map((s) => s === BLACK ? 'black' : s === WHITE ? 'white' : null));
  const target = { x: physical.target[0], y: physical.target[1] };
  const wall = new Set(getGroup(base, { x: 0, y: 0 }).map(pointKey));
  for (const [x, y] of physical.wallEyes) if (base[y][x] !== null || !getNeighbors(base, { x, y }).every((p) => wall.has(pointKey(p)))) throw new Error('Outer group has no certified physical eyes.');
  let nodes = 0, lifeLeaves = 0, captureLeaves = 0;
  const moveBoard = (board, color, move) => {
    if (move === -1) return board;
    const [x, y] = puzzle.cells[move];
    const result = applyMove(board, color === BLACK ? 'black' : 'white', x + 2, y + 2);
    if (!result.ok) throw new Error(`Independent engine rejects move ${move}: ${result.error}`);
    return result.board;
  };
  const walk = (tree, board, history) => {
    nodes++;
    if (tree.outcome === 'captured') {
      if (board[target.y][target.x] === 'white') throw new Error('Independent engine rejects capture terminal.');
      captureLeaves++; return;
    }
    if (tree.outcome === 'alive') {
      if (!whiteHasTwoEyes(board, target)) throw new Error('Independent engine rejects two-eye terminal.');
      lifeLeaves++; return;
    }
    for (const branch of tree.branches) {
      const next = moveBoard(board, tree.color, branch.move), key = boardHash(next);
      if (branch.move !== -1 && history.includes(key)) throw new Error('Physical superko violation.');
      walk(branch.next, next, branch.move === -1 ? history : [...history, key]);
    }
  };
  const history = [boardHash(base)];
  walk(puzzle.proof, base, history);
  if (puzzle.activeDefenseProof) walk(puzzle.activeDefenseProof, base, history);
  walk(puzzle.passRefutation, base, history);
  for (const wrong of puzzle.wrongPaths) {
    const next = moveBoard(base, BLACK, wrong.firstMove);
    walk(wrong.proof, next, [...history, boardHash(next)]);
  }
  if (reSolve) {
    const fresh = analyze({ chamber: new Chamber(puzzle.cells), state: puzzle.initial, target: puzzle.target }, { ownMoves: puzzle.ownMoves, maxNodes: 2000000, maxMs: 10000 });
    if (!fresh.puzzle) throw new Error(`Fresh quality search rejects task: ${fresh.reason}`);
  }
  return { nodes, captureLeaves, lifeLeaves };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback;
  const directory = option('directory', null);
  let puzzles;
  if (directory) puzzles = readdirSync(directory).filter((file) => /puzzle.*\.json$/.test(file)).map((file) => JSON.parse(readFileSync(join(directory, file), 'utf8')));
  else {
    const root = resolve(option('root', '.cache/puzzle-lab'));
    if (!existsSync(join(root, 'catalog.json'))) throw new Error('No catalog to audit.');
    const store = new Store(root); puzzles = store.list().filter((p) => p.review !== 'rejected').map((p) => store.load(p.number));
  }
  const diversity = new DiversityIndex();
  let nodes = 0;
  for (const puzzle of puzzles) {
    const result = auditPuzzle(puzzle, { reSolve: args.includes('--re-solve') }); nodes += result.nodes;
    const duplicate = diversity.duplicate(puzzle);
    if (duplicate) throw new Error(`Duplicate/core variant in audit: ${duplicate}`);
    diversity.add(puzzle);
    console.log(`Puzzle ${puzzle.number ?? puzzle.fingerprints.family.slice(0, 8)}: ${puzzle.ownMoves} eigene Züge, ${result.nodes} Vollbrett-Prüfknoten, ${result.lifeLeaves} Lebens-Endstellungen.`);
  }
  console.log(`${puzzles.length} Aufgaben unabhängig geprüft; ${nodes} Vollbrett-Prüfknoten. Kyu-Ränge bleiben unkalibriert.`);
}
