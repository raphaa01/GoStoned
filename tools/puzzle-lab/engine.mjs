// Original, dependency-free GoStone local capture solver. No book/database seeds.
export const BLACK = 1;
export const WHITE = 2;
export const bit = (index) => (1 << index) >>> 0;
export function popcount(value) {
  value >>>= 0;
  value -= (value >>> 1) & 0x55555555;
  value = (value & 0x33333333) + ((value >>> 2) & 0x33333333);
  return (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
export function indices(mask) {
  const result = [];
  while (mask) {
    const next = mask & -mask;
    result.push(31 - Math.clz32(next));
    mask = (mask ^ next) >>> 0;
  }
  return result;
}

// Points outside the chamber are a connected, unconditionally living black
// enclosure. This explicit local model is also materialised in every export.
export class Chamber {
  constructor(cells) {
    if (cells.length < 3 || cells.length > 30) throw new Error('A chamber needs 3–30 intersections.');
    this.cells = cells.map(([x, y]) => [x, y]);
    this.index = new Map(cells.map(([x, y], i) => [`${x},${y}`, i]));
    if (this.index.size !== cells.length) throw new Error('Duplicate chamber point.');
    this.mask = (2 ** cells.length - 1) >>> 0;
    this.neighbors = [];
    this.rim = 0;
    for (let i = 0; i < cells.length; i++) {
      const [x, y] = cells[i];
      let neighbors = 0;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const adjacent = this.index.get(`${x + dx},${y + dy}`);
        if (adjacent === undefined) this.rim |= bit(i);
        else neighbors |= bit(adjacent);
      }
      this.neighbors.push(neighbors >>> 0);
    }
    this.rim >>>= 0;
    this.adjacency = Array.from({ length: 4 }, (_, byte) => {
      const table = new Uint32Array(256);
      for (let mask = 1; mask < 256; mask++) {
        const low = mask & -mask;
        table[mask] = table[mask ^ low] | (this.neighbors[byte * 8 + 31 - Math.clz32(low)] ?? 0);
      }
      return table;
    });
    if (this.group(this.mask, 0) !== this.mask) throw new Error('The chamber must be connected.');
    // A missing interior point would be an isolated Black stone rather than
    // part of the living outer enclosure. Never grant it wall immunity.
    const minX = Math.min(...cells.map(([x]) => x)) - 1, maxX = Math.max(...cells.map(([x]) => x)) + 1;
    const minY = Math.min(...cells.map(([, y]) => y)) - 1, maxY = Math.max(...cells.map(([, y]) => y)) + 1;
    const outside = new Set(), pending = [[minX, minY]];
    while (pending.length) {
      const [x, y] = pending.pop(), key = `${x},${y}`;
      if (outside.has(key) || this.index.has(key)) continue;
      outside.add(key);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) if (x + dx >= minX && x + dx <= maxX && y + dy >= minY && y + dy <= maxY) pending.push([x + dx, y + dy]);
    }
    for (const [x, y] of cells) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) if (!this.index.has(`${x + dx},${y + dy}`) && !outside.has(`${x + dx},${y + dy}`)) throw new Error('The chamber cannot contain an enclosed hole.');
  }
  adjacent(mask) {
    return (this.adjacency[0][mask & 255] | this.adjacency[1][(mask >>> 8) & 255] | this.adjacency[2][(mask >>> 16) & 255] | this.adjacency[3][mask >>> 24]) >>> 0;
  }
  group(stones, start) {
    let group = bit(start), frontier = group;
    while (frontier) {
      frontier = (this.adjacent(frontier) & stones & ~group) >>> 0;
      group = (group | frontier) >>> 0;
    }
    return group;
  }
  liberties(state, group) {
    return (this.adjacent(group) & ~(state.black | state.white) & this.mask) >>> 0;
  }
  valid(state) {
    if ((state.black & state.white) || ((state.black | state.white) & ~this.mask) || !state.white) return false;
    for (const color of [BLACK, WHITE]) {
      let rest = color === BLACK ? state.black : state.white;
      while (rest) {
        const group = this.group(rest, indices(rest)[0]);
        rest = (rest & ~group) >>> 0;
        if (!this.liberties(state, group) && !(color === BLACK && (group & this.rim))) return false;
      }
    }
    return true;
  }
  play(state, color, move) {
    if (move === -1) return { ...state, ko: -1, passes: (state.passes ?? 0) + 1 };
    if (!Number.isInteger(move) || move < 0 || move >= this.cells.length) return null;
    const point = bit(move);
    if ((state.black | state.white) & point || state.ko === move) return null;
    const next = { black: state.black, white: state.white, ko: -1, passes: 0 };
    const own = color === BLACK ? 'black' : 'white';
    const enemy = color === BLACK ? 'white' : 'black';
    next[own] = (next[own] | point) >>> 0;
    let checked = 0, captured = 0;
    for (const adjacent of indices(this.neighbors[move] & next[enemy])) {
      if (checked & bit(adjacent)) continue;
      const group = this.group(next[enemy], adjacent);
      checked |= group;
      if (enemy === 'black' && (group & this.rim)) continue;
      if (!this.liberties(next, group)) {
        next[enemy] = (next[enemy] & ~group) >>> 0;
        captured |= group;
      }
    }
    const ownGroup = this.group(next[own], move);
    const liberties = this.liberties(next, ownGroup);
    if (!liberties && !(color === BLACK && (ownGroup & this.rim))) return null;
    if (popcount(captured) === 1 && popcount(ownGroup) === 1 && popcount(liberties) === 1 && !(color === BLACK && (ownGroup & this.rim))) next.ko = indices(captured)[0];
    return next;
  }
  // Conservative one-block Benson certificate: two disjoint empty regions,
  // each bounded only by the target block, every point a liberty of that block.
  alive(state, target) {
    if (!(state.white & bit(target))) return false;
    const group = this.group(state.white, target);
    const liberties = this.liberties(state, group);
    let empty = (this.mask & ~(state.black | state.white)) >>> 0, eyes = 0;
    while (empty) {
      const region = this.group(empty, indices(empty)[0]);
      empty = (empty & ~region) >>> 0;
      const boundary = (this.adjacent(region) & ~region) >>> 0;
      if (!(region & this.rim) && !(boundary & ~group) && !(region & ~liberties) && ++eyes >= 2) return true;
    }
    return false;
  }
}

export class BudgetExceeded extends Error {}
export const positionKey = (state) => `${state.black.toString(36)}.${state.white.toString(36)}`;
const unknown = Object.freeze({ value: 0, distance: 0, move: -1 });
// Two 25-bit boards fit exactly in a JavaScript number. These caches store
// history-independent geometry ONLY; proven outcomes still include history.
const boardNumber = (state) => state.black * 33554432 + state.white;

export class Solver {
  constructor(chamber, target, { maxNodes = 250_000, maxMs = 1200, allowWhitePass = true } = {}) {
    this.chamber = chamber;
    this.target = target;
    this.maxNodes = maxNodes;
    this.allowWhitePass = allowWhitePass;
    this.deadline = performance.now() + maxMs;
    this.nodes = 0;
    this.hits = 0;
    this.cache = new Map();
    this.moveCache = new Map();
    this.lifeCache = new Map();
    this.sawKo = false;
  }
  moves(state, color) {
    const cacheKey = this.chamber.cells.length <= 25 ? boardNumber(state) * 2 + color - 1 : `${positionKey(state)}:${color}`;
    let choices = this.moveCache.get(cacheKey);
    if (!choices) {
      const possible = indices((this.chamber.mask & ~(state.black | state.white)) >>> 0);
      const targetGroup = state.white & bit(this.target) ? this.chamber.group(state.white, this.target) : 0;
      const targetLiberties = this.chamber.liberties(state, targetGroup);
      choices = possible.map((move) => {
        const next = this.chamber.play({ ...state, ko: -1 }, color, move);
        if (!next) return null;
        if (next.ko !== -1) this.sawKo = true;
        const captures = popcount(state.white) - popcount(next.white) + popcount(state.black) - popcount(next.black);
        const degree = popcount(this.chamber.neighbors[move]);
        const eyePriority = color === WHITE ? (this.alive(next) ? 10000 : 4 * popcount(this.chamber.neighbors[move] & ~(state.black | state.white))) : 0;
        return { move, next, priority: eyePriority + captures * 40 + ((targetLiberties & bit(move)) ? 8 : 0) + degree };
      }).filter(Boolean).sort((a, b) => b.priority - a.priority);
      if (this.moveCache.size < 20_000) this.moveCache.set(cacheKey, choices);
    }
    const legal = choices.filter((choice) => choice.move !== state.ko);
    return !this.allowWhitePass && color === WHITE ? legal : legal.concat([{ move: -1, next: this.chamber.play(state, color, -1), priority: -1 }]);
  }
  alive(state) {
    const key = this.chamber.cells.length <= 25 ? boardNumber(state) : positionKey(state);
    const cached = this.lifeCache.get(key);
    if (cached !== undefined) return cached;
    const value = this.chamber.alive(state, this.target);
    if (this.lifeCache.size < 60_000) this.lifeCache.set(key, value);
    return value;
  }
  remember(key, result, plies) {
    let entry = this.cache.get(key);
    if (!entry) {
      if (this.cache.size >= 60_000) return;
      entry = { proven: null, unknownThrough: -1 };
      this.cache.set(key, entry);
    }
    if (!result.value) entry.unknownThrough = Math.max(entry.unknownThrough, plies);
    else if (!entry.proven || result.distance < entry.proven.distance) entry.proven = result;
  }
  solve(state, color, plies, history = [positionKey(state)]) {
    if (++this.nodes > this.maxNodes || ((this.nodes & 1023) === 0 && performance.now() > this.deadline)) throw new BudgetExceeded('Search budget exhausted.');
    if (!(state.white & bit(this.target))) return { value: 1, distance: 0, move: -1 };
    if (this.alive(state)) return { value: -1, distance: 0, move: -1 };
    if ((state.passes ?? 0) >= 2 || plies <= 0) return unknown;
    // Exact history is part of the key: superko results must never be reused
    // under a different repetition history, even when the board is identical.
    const key = `${positionKey(state)}:${color}:${state.ko}:${state.passes ?? 0}:${history.join('/')}`;
    const cached = this.cache.get(key);
    // A proof reaching its terminal within N plies remains a proof with a
    // larger horizon. A fully searched unknown horizon stays unknown at a
    // smaller horizon. Neither inference changes the repetition history.
    if (cached?.proven && cached.proven.distance <= plies) { this.hits++; return cached.proven; }
    if (cached?.unknownThrough >= plies) { this.hits++; return unknown; }
    let best = null, hasUnknown = false;
    for (const choice of this.moves(state, color)) {
      const nextKey = positionKey(choice.next);
      if (choice.move !== -1 && history.includes(nextKey)) continue;
      const nextHistory = choice.move === -1 ? history : [...history, nextKey];
      const result = this.solve(choice.next, 3 - color, plies - 1, nextHistory);
      if (result.value === 0) { hasUnknown = true; continue; }
      const candidate = { value: result.value, distance: result.distance + 1, move: choice.move };
      if (result.value === (color === BLACK ? 1 : -1)) {
        this.remember(key, candidate, plies);
        return candidate;
      }
      if (!best || candidate.distance > best.distance) best = candidate;
    }
    const result = hasUnknown || !best ? unknown : best;
    this.remember(key, result, plies);
    return result;
  }
  classify(state, plies, { stopOnFailure = false } = {}) {
    const history = [positionKey(state)];
    const choices = [];
    let winners = 0;
    for (const { move, next } of this.moves(state, BLACK)) {
      const key = positionKey(next);
      const nextHistory = move === -1 ? history : [...history, key];
      const result = this.solve(next, WHITE, plies - 1, nextHistory);
      choices.push({ move, value: result.value, distance: result.distance + 1 });
      if (result.value === 1) winners++;
      if (stopOnFailure && (result.value === 0 || winners > 1)) break;
    }
    return choices;
  }
  tree(state, color, plies, history = [positionKey(state)], remaining = { count: 0, limit: 12_000 }) {
    if (++remaining.count > remaining.limit) throw new BudgetExceeded('Proof tree is too large.');
    if (!(state.white & bit(this.target))) return { outcome: 'captured' };
    if (this.chamber.alive(state, this.target)) return { outcome: 'alive' };
    const branches = [];
    let expected = this.solve(state, color, plies, history);
    if (!expected.value) throw new Error('Cannot export an unresolved proof.');
    if (expected.value === 1 && color === BLACK) {
      // Minimise Black's work at EVERY position, not just at the root. Taking
      // the first winning continuation can artificially pad a solution.
      for (let depth = 1; depth < plies; depth += 2) {
        const shortest = this.solve(state, color, depth, history);
        if (shortest.value === 1) { expected = shortest; plies = depth; break; }
      }
    }
    for (const { move, next } of this.moves(state, color)) {
      if (expected.value === 1 && color === BLACK && move !== expected.move) continue;
      const key = positionKey(next);
      if (move !== -1 && history.includes(key)) continue;
      const nextHistory = move === -1 ? history : [...history, key];
      const result = this.solve(next, 3 - color, plies - 1, nextHistory);
      if (color === BLACK && expected.value === 1 && result.value !== 1) continue;
      if (color === WHITE && expected.value === -1 && result.value !== -1) continue;
      if (result.value !== expected.value) throw new Error('Incomplete proof branch.');
      branches.push({ move, next: this.tree(next, 3 - color, plies - 1, nextHistory, remaining) });
      // One proven strategy move suffices for the side with the winning goal;
      // the opposing side must have EVERY legal reply in the proof certificate.
      if ((expected.value === 1 && color === BLACK) || (expected.value === -1 && color === WHITE)) break;
    }
    if (!branches.length) throw new Error('Empty proof branch.');
    return { color, branches };
  }
}

export function principalLine(tree) {
  if (!tree.branches) return [];
  const lines = tree.branches.map(({ move, next }) => [{ color: tree.color, move }, ...principalLine(next)]);
  const passes = (line) => line.filter((p) => p.color === WHITE && p.move === -1).length;
  return lines.reduce((a, b) => b.length > a.length || (b.length === a.length && passes(b) < passes(a)) ? b : a, []);
}

// White's capture-proof nodes contain every legal answer and shortest Black
// strategies below each answer. Their longest line is a minimax defence.
// In a life refutation, White's sole certified strategy already forces life
// against every possible Black continuation.
export function bestDefense(tree) {
  if (tree.outcome) return null;
  if (tree.color !== WHITE) throw new Error('Expected a White response node.');
  const move = principalLine(tree)[0].move;
  return tree.branches.find((branch) => branch.move === move);
}

export function verifyTree(chamber, state, target, tree, color = BLACK, history = [positionKey(state)], { allowWhitePass = true } = {}) {
  if (tree.outcome === 'captured') {
    if (state.white & bit(target)) throw new Error('False capture certificate.');
    return { leaves: 1, nodes: 1 };
  }
  if (tree.outcome === 'alive') {
    if (!chamber.alive(state, target)) throw new Error('False life certificate.');
    return { leaves: 1, nodes: 1 };
  }
  if (tree.color !== color || !Array.isArray(tree.branches) || !tree.branches.length) throw new Error('Malformed proof tree.');
  const seen = new Set();
  const outcome = findOutcome(tree);
  let leaves = 0, nodes = 1;
  for (const branch of tree.branches) {
    if (seen.has(branch.move)) throw new Error('Duplicate proof move.');
    if (!allowWhitePass && color === WHITE && branch.move === -1) throw new Error('White pass in active-defense certificate.');
    seen.add(branch.move);
    const next = chamber.play(state, color, branch.move);
    if (!next) throw new Error('Illegal move in proof.');
    const key = positionKey(next);
    if (branch.move !== -1 && history.includes(key)) throw new Error('Superko violation in proof.');
    if (findOutcome(branch.next) !== outcome) throw new Error('Mixed certificate outcomes.');
    const checked = verifyTree(chamber, next, target, branch.next, 3 - color, branch.move === -1 ? history : [...history, key], { allowWhitePass });
    leaves += checked.leaves; nodes += checked.nodes;
  }
  if ((outcome === 'captured' && color === WHITE) || (outcome === 'alive' && color === BLACK)) {
    for (const move of [...indices((chamber.mask & ~(state.black | state.white)) >>> 0), -1]) {
      if (!allowWhitePass && color === WHITE && move === -1) continue;
      const next = chamber.play(state, color, move);
      if (!next || (move !== -1 && history.includes(positionKey(next)))) continue;
      if (!seen.has(move)) throw new Error('A legal defensive reply is missing.');
    }
  }
  return { leaves, nodes };
}

function findOutcome(tree) {
  if (tree.outcome) return tree.outcome;
  if (!tree.branches?.length) throw new Error('Missing certificate outcome.');
  return findOutcome(tree.branches[0].next);
}
