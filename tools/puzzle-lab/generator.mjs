import { createHash } from 'node:crypto';
import { BLACK, WHITE, Chamber, Solver, BudgetExceeded, bit, indices, popcount, principalLine, bestDefense, verifyTree, positionKey } from './engine.mjs';

export const VERSION = 'gostone-local-puzzle-lab/1';
export const PRESENTATION_VERSION = 'gostone-puzzle-presentation/3';
export function random(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rng, array) => array[Math.floor(rng() * array.length)];
const chambers = new Map();
// Original positions found by this lab's procedural search, also covered by
// independent full-board regression tests. They seed SEARCH only; they are
// never copied into a job's output or counted as newly generated tasks.
export function originalSearchBases() {
  return [
    { cells:[[0,0],[1,0],[2,0],[3,0],[0,1],[1,1],[2,1],[3,1],[0,2],[1,2],[0,3],[1,3]], initial:{black:65,white:3746,ko:-1,passes:0}, target:1, kind:'corner' },
    { cells:[[0,0],[1,0],[2,0],[3,0],[0,1],[1,1],[2,1],[3,1],[0,2],[1,2],[2,2],[3,2],[0,3],[1,3],[2,3]], initial:{black:1024,white:31161,ko:-1,passes:0}, target:0, kind:'edge' },
    { cells:Array.from({length:19},(_,i)=>[i%4,Math.floor(i/4)]),initial:{black:16392,white:494835,ko:-1,passes:0},target:0,kind:'corner',support:'bottom-left' },
  ].map(({kind,support,...base})=>{
    const layout={version:'compact-edge-v2',kind,boardSize:9,offset:kind==='corner'?[0,0]:[2,0],support:support??(kind==='corner'?'top-right':'left-corner')};
    return {...base,layout,ownMoves:4,fingerprints:fingerprints(chamberFor(base.cells,layout),base.initial)};
  });
}
function chamberFor(cells, layout) {
  const key = `${JSON.stringify(layout ?? {})}:${cells.map((point) => point.join(',')).join(';')}`;
  let chamber = chambers.get(key);
  if (!chamber) { chamber = new Chamber(cells, layout); if (chambers.size < 512) chambers.set(key, chamber); }
  return chamber;
}
export function candidate(rng, ownMoves, bases = [], layoutKind = null) {
  bases = bases.filter((base) => ['compact-edge-v1', 'compact-edge-v2'].includes(base.layout?.version) && (!layoutKind || base.layout.kind === layoutKind));
  if (bases.length && rng() < 0.6) {
    const matching = bases.filter((base) => base.ownMoves === ownMoves);
    return mutate(rng, ownMoves, pick(rng, matching.length && rng() < .75 ? matching : bases));
  }
  // Fresh random polyomino eye spaces, connected white shapes and sacrifice
  // stones. No downloaded shapes or copied solutions.
  const [width, height] = pick(rng, ownMoves >= 4 ? [[3, 4], [4, 3], [4, 4], [4, 5], [5, 4], [5, 5]] : [[3, 3], [3, 4], [4, 3], [4, 4], [4, 5]]);
  const layout = { version: 'compact-edge-v2', kind: layoutKind ?? (rng() < .5 ? 'corner' : 'edge'), boardSize: 9,
    support: rng() < .5 ? 'top-right' : 'bottom-left' };
  layout.offset = layout.kind === 'corner' ? [0, 0] : [2, 0];
  if (layout.kind === 'edge') layout.support = 'left-corner';
  let cells = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) cells.push([x, y]);
  // Open real top/left board edges and stepped outer contours. Keep edge
  // cells intact; varying upper/right and lower corners changes the problem.
  if (rng() < .55) cells = cells.filter(([x, y]) => !(x === width - 1 && y === height - 1 && rng() < .8));
  if (width >= 4 && height >= 4 && rng() < .3) cells = cells.filter(([x, y]) => !(x >= width - 2 && y >= height - 2));
  let chamber;
  try {
    chamber = chamberFor(cells, layout);
  } catch { return null; }
  let white = 0, black = 0;
  if (rng() < 0.75) {
    // Grow an interior eye space; the surrounding white chain can have cuts,
    // short liberties and internal black sacrifice stones.
    const internal = cells.map(([x, y], i) => ({ x, y, i })).filter(({ x, y }) => x < width - 1 && y < height - 1);
    if (!internal.length) return null;
    let eye = bit(pick(rng, internal).i);
    const desired = Math.min(internal.length + 2, pick(rng, ownMoves >= 5 ? [6, 7, 8, 9, 10, 11] : ownMoves >= 4 ? [5, 6, 7, 8, 9, 10] : [2, 3, 4, 5, 6, 7]));
    const splitEyes = rng() < 0.2;
    for (let j = 1; j < desired; j++) {
      const options = indices((chamber.adjacent(eye) & ~eye) >>> 0);
      const interiorOptions = options.filter((i) => !(bit(i) & chamber.rim));
      const separated = internal.filter(({ i }) => !(eye & bit(i)) && !(chamber.adjacent(eye) & bit(i)));
      eye |= bit(splitEyes && j === 2 && separated.length ? pick(rng, separated).i : pick(rng, interiorOptions.length && rng() < 0.82 ? interiorOptions : options));
    }
    white = (chamber.mask & ~eye) >>> 0;
    if (rng() < 0.75 && popcount(eye) > 3) {
      const count = ownMoves >= 4 ? pick(rng, [1, 1, 2, 2, 3]) : 1;
      for (let stone = 0; stone < count; stone++) {
        const options = indices((eye & ~black) >>> 0);
        const rimOptions = options.filter((i) => chamber.rim & bit(i));
        if (options.length) black |= bit(pick(rng, rimOptions.length && stone === 0 && rng() < 0.5 ? rimOptions : options));
      }
    }
    if (rng() < 0.35) {
      const holes = indices(white & chamber.rim);
      if (holes.length) white = (white & ~bit(pick(rng, holes))) >>> 0;
    }
  } else {
    const density = 0.52 + rng() * 0.26;
    for (let i = 0; i < cells.length; i++) if (rng() < density) white |= bit(i);
    const empty = indices((chamber.mask & ~white) >>> 0);
    if (empty.length > 4 && rng() < 0.8) {
      const count = pick(rng, [1, 2, 3]);
      for (let i = 0; i < count; i++) black |= bit(pick(rng, empty));
    }
  }
  const state = { black: black >>> 0, white: white >>> 0, ko: -1, passes: 0 };
  return validateCandidate(chamber, state, ownMoves);
}

// Search around independently generated, proven positions. Change several
// active intersections, never just orientation, location or enclosure size.
// Novelty and proof filters still run on the resulting problem from scratch.
export function mutate(rng, ownMoves, base) {
  const layout = base.layout ? { ...base.layout, version:'compact-edge-v2', offset:base.layout.kind==='corner'?[0,0]:[2,0],
    support:base.layout.kind==='edge'?'left-corner':rng()<.5?'top-right':'bottom-left' } : undefined;
  const chamber = chamberFor(base.cells, layout);
  let { black, white } = base.initial;
  const active = (chamber.mask & ~white) >>> 0;
  // Include White stones along the actual fighting boundary. Preserving
  // those stones froze the target outline and repeatedly produced the same
  // small core, even when internal Black stones changed.
  const area = (active | chamber.adjacent(active)) >>> 0;
  const choices = indices(area), shuffled = [...choices];
  const changes = Math.min(choices.length, pick(rng, [3, 4, 4, 5, 5, 6]));
  for (let j = 0; j < changes; j++) {
    const k = j + Math.floor(rng() * (shuffled.length - j));
    [shuffled[j], shuffled[k]] = [shuffled[k], shuffled[j]];
    const point = bit(shuffled[j]);
    const previous = white & point ? WHITE : black & point ? BLACK : 0;
    const replacement = pick(rng, [0, BLACK, WHITE].filter((color) => color !== previous));
    black = (black & ~point) >>> 0; white = (white & ~point) >>> 0;
    if (replacement === BLACK) black |= point;
    if (replacement === WHITE) white |= point;
  }
  return validateCandidate(chamber, { black: black >>> 0, white: white >>> 0, ko: -1, passes: 0 }, ownMoves);
}

function validateCandidate(chamber, state, ownMoves) {
  if (!chamber.valid(state)) return null;
  if (chamber.geometry.version?.startsWith('compact-edge-') && (popcount(state.white) > 16 || popcount(state.black) > 4)) return null;
  let rest = state.white, targetGroup = 0, target = 0;
  while (rest) {
    const first = indices(rest)[0], group = chamber.group(state.white, first);
    if (popcount(group) > popcount(targetGroup)) { targetGroup = group; target = first; }
    rest = (rest & ~group) >>> 0;
  }
  if (chamber.alive(state, target)) return null;
  const liberties = popcount(chamber.liberties(state, targetGroup));
  if (liberties < (ownMoves === 1 ? 1 : 2) || liberties > 9 || popcount(targetGroup) < 4) return null;
  if (chamber.geometry.version?.startsWith('compact-edge-')) {
    const presentation = assessPresentation({ cells: chamber.cells, initial: state, target, layout: chamber.geometry, toPlay: 'B' });
    // Reject visual clutter BEFORE spending the proof budget. Four-turn
    // tasks should remain small; additional depth may need more context.
    if (!presentation.accepted || presentation.totalStones > (ownMoves <= 4 ? 28 : 32)) return null;
  }
  return { chamber, state, target };
}

function transforms(points) {
  return Array.from({ length: 8 }, (_, symmetry) => {
    let transformed = points.map(([x, y, label]) => {
      if (symmetry & 4) x = -x;
      for (let i = 0; i < (symmetry & 3); i++) [x, y] = [-y, x];
      return [x, y, label];
    });
    const minX = Math.min(...transformed.map(([x]) => x));
    const minY = Math.min(...transformed.map(([, y]) => y));
    transformed = transformed.map(([x, y, label]) => [x - minX, y - minY, label]);
    return transformed.sort((a, b) => a[1] - b[1] || a[0] - b[0]).map(([x, y, label]) => `${x},${y}:${label}`).join(';');
  });
}
const hash = (value) => createHash('sha256').update(value).digest('hex');
export function fingerprints(chamber, state) {
  const full = chamber.cells.map(([x, y], i) => [x, y, state.white & bit(i) ? 'W' : state.black & bit(i) ? 'B' : '.']);
  const active = (chamber.mask & ~state.white) >>> 0;
  // Ignore added outer white stones and the enclosure's location. This is
  // intentionally stricter than board equality: the same eye/sacrifice motif
  // may be admitted only once, even in a differently sized surrounding group.
  const tactical = full.filter((_, i) => active & bit(i));
  return { position: hash(transforms(full).sort()[0]), family: hash(transforms(tactical).sort()[0]) };
}

export function assessDifficulty({ ownMoves, proofNodes, branches, refutations, sacrifices }) {
  const complexity = Math.log2(1 + proofNodes) * 0.55 + Math.log2(1 + branches) * 0.8;
  const score = ownMoves * 2.4 + complexity + sacrifices * 2 + Math.min(3, refutations * 0.25);
  const kyu = Math.max(1, Math.min(30, Math.round(33 - score)));
  return { kyu, status: 'estimated', method: 'reading-depth-and-proof-complexity-v1', confidence: 'uncalibrated', score: Math.round(score * 100) / 100,
    factors: { ownMoves, proofNodes, defensiveBranches: branches, refutations, sacrifices },
    note: 'Geschätzter Kyu-Rang. Erst Lösungsquoten echter Spieler können ihn kalibrieren.' };
}

export function analyze(item, options) {
  const { chamber, state, target } = item;
  const started = performance.now();
  const solver = new Solver(chamber, target, options);
  const requested = options.ownMoves;
  let firstWin = null, minimum = 0;
  try {
    for (let moves = 1; moves <= requested; moves++) {
      const result = solver.solve(state, BLACK, moves * 2 - 1);
      if (result.value === -1) return { reason: 'alive' };
      if (result.value === 1) { firstWin = result; minimum = moves; break; }
    }
    if (!firstWin || minimum !== requested) return { reason: firstWin ? 'depth' : 'unresolved' };
    // A weaker Black continuation can make a diagram look deeper. Prove that
    // White really forces this depth even when passing is removed from the
    // quality-control game. The normal certificate still includes ALL passes.
    const activeSolver = new Solver(chamber, target, { ...options, allowWhitePass: false });
    activeSolver.deadline = solver.deadline;
    const nodeBudget = options.maxNodes ?? 250_000;
    activeSolver.maxNodes = Math.max(0, nodeBudget - solver.nodes);
    activeSolver.moveCache = solver.moveCache; activeSolver.lifeCache = solver.lifeCache;
    let activeDepth = 0;
    for (let moves = 1; moves <= requested; moves++) {
      if (activeSolver.solve(state, BLACK, moves * 2 - 1).value === 1) { activeDepth = moves; break; }
    }
    if (activeDepth !== requested) return { reason: 'pass-inflated-depth' };
    solver.maxNodes = Math.max(0, nodeBudget - activeSolver.nodes);
    // An incorrect move must have a proof of life, not just exceed a move
    // deadline. All initial choices, including pass, must be resolved.
    const proof = solver.tree(state, BLACK, requested * 2 - 1);
    const checked = verifyTree(chamber, state, target, proof);
    const solution = principalLine(proof);
    const actualMoves = solution.filter((ply) => ply.color === BLACK).length;
    if (actualMoves !== requested || solution.some((ply) => ply.move === -1 && ply.color === BLACK)) return { reason: 'depth' };
    // The advertised depth must consist of actual fighting. Passing to make
    // Black fill already dead spaces is mathematically valid but not useful.
    const defendingMoves = solution.filter((ply) => ply.color === WHITE && ply.move >= 0).length;
    const defenderPasses = solution.filter((ply) => ply.color === WHITE && ply.move < 0).length;
    if (requested > 1 && (defendingMoves !== requested - 1 || defenderPasses !== 0)) return { reason: 'cleanup' };
    const auditPlies = requested * 2 + 5;
    const choices = solver.classify(state, auditPlies, { stopOnFailure: true });
    if (choices.some((c) => c.value === 0)) return { reason: 'unresolved' };
    const winners = choices.filter((c) => c.value === 1);
    if (winners.length !== 1 || winners[0].move < 0) return { reason: 'ambiguous' };
    const wrongPaths = [];
    let passRefutation;
    for (const choice of choices.filter((c) => c.value === -1)) {
      const next = chamber.play(state, BLACK, choice.move);
      const history = choice.move < 0 ? [positionKey(state)] : [positionKey(state), positionKey(next)];
      const refutation = solver.tree(next, WHITE, auditPlies - 1, history);
      verifyTree(chamber, next, target, refutation, WHITE, history);
      if (choice.move < 0) { passRefutation = refutation; continue; }
      wrongPaths.push({ firstMove: choice.move, proof: refutation, line: [{ color: BLACK, move: choice.move }, ...principalLine(refutation)], explanation: 'Weiß kann nach diesem Zug zwei sichere Augen erzwingen.' });
    }
    if (wrongPaths.length < 2) return { reason: 'quality' };
    activeSolver.maxNodes = Math.max(0, nodeBudget - solver.nodes);
    const activeDefenseProof = activeSolver.tree(state, BLACK, requested * 2 - 1);
    verifyTree(chamber, state, target, activeDefenseProof, BLACK, [positionKey(state)], { allowWhitePass: false });
    const quality = assessQuality(chamber, state, target, solution, activeDepth);
    const { sacrifices, decisionTurns, earlyCaptures } = quality;
    if (requested >= 3 && decisionTurns < 2) return { reason: 'forced-cleanup' };
    const branches = countBranches(proof);
    const difficulty = assessDifficulty({ ownMoves: actualMoves, proofNodes: checked.nodes, branches, refutations: wrongPaths.length, sacrifices });
    const layout = chamber.geometry.version?.startsWith('compact-edge-') ? chamber.geometry : undefined;
    if (layout && (hasLocalKo(chamber, state, proof) || hasLocalKo(chamber, state, activeDefenseProof) || hasLocalKo(chamber, state, passRefutation) ||
      wrongPaths.some((wrong) => hasLocalKo(chamber, chamber.play(state, BLACK, wrong.firstMove), wrong.proof)))) return { reason: 'ko-dependent' };
    const category = sacrifices >= 2 ? 'Mehrfaches Opfer & Rückfang' : sacrifices ? 'Opfer & Rückfang' : earlyCaptures ? 'Abtrennen & Fangen' : actualMoves >= 4 ? 'Mehrzügige Augenform' : 'Vitalpunkt & Augen';
    const presentationQuality = layout ? assessPresentation({ cells: chamber.cells, initial: state, target, layout, toPlay: 'B' }) : undefined;
    if (layout && !presentationQuality.accepted) return { reason: 'visual-format' };
    return { puzzle: preparePuzzle({ schemaVersion: VERSION, cells: chamber.cells, initial: state, target, goal: 'capture', toPlay: 'B', ownMoves: actualMoves,
      ...(layout ? { layout, presentationQuality } : {}),
      category, difficulty, fingerprints: fingerprints(chamber, state), solution, proof, wrongPaths, passRefutation, activeDefenseProof, quality,
      verification: { status: 'proven', rules: 'local capture; positional superko; passes allowed', enclosure: 'unconditionally alive attacker wall; chamber-only play', minimumAttackerTurns: minimum, uniqueFirstMove: winners[0].move,
        allInitialMovesResolved: true, proofNodes: checked.nodes, defensiveBranches: branches, defendingMoves, defenderPasses, sacrifices, searchNodes: solver.nodes + activeSolver.nodes, cacheHits: solver.hits + activeSolver.hits, elapsedMs: Math.round(performance.now() - started), engine: VERSION },
      provenance: { source: 'original-procedural-generation', foreignPuzzleData: false } }) };
  } catch (error) {
    if (error instanceof BudgetExceeded) return { reason: 'budget' };
    throw error;
  }
}

export function assessQuality(chamber, state, target, solution, activeDepth = null) {
    let replay = state, sacrifices = 0, decisionTurns = 0, earlyCaptures = 0;
    const blackPoints = new Set();
    for (const ply of solution) {
      if (ply.color === BLACK) {
        blackPoints.add(ply.move);
        const legal = indices((chamber.mask & ~(replay.black | replay.white)) >>> 0).filter((i) => chamber.play(replay, BLACK, i));
        if (legal.length >= 2) decisionTurns++;
      }
      const next = chamber.play(replay, ply.color, ply.move);
      if (ply.color === WHITE && popcount(next.black) < popcount(replay.black)) sacrifices++;
      if (ply.color === BLACK && popcount(next.white) < popcount(replay.white) && (next.white & bit(target))) earlyCaptures++;
      replay = next;
    }
    return { version: activeDepth === null ? 'actual-resistance-v2' : 'active-defense-v3', ...(activeDepth === null ? {} : { activeDefenseDepth: activeDepth }), decisionTurns, distinctBlackPoints: blackPoints.size, defendingMoves: solution.filter((p) => p.color === WHITE && p.move >= 0).length,
      defenderPasses: solution.filter((p) => p.color === WHITE && p.move < 0).length, sacrifices, earlyCaptures };
}
function countBranches(tree) {
  return tree.branches ? Math.max(0, tree.branches.length - 1) + tree.branches.reduce((sum, b) => sum + countBranches(b.next), 0) : 0;
}
function hasLocalKo(chamber, state, tree) {
  if (state.ko >= 0) return true;
  return tree.branches?.some((branch) => hasLocalKo(chamber, chamber.play(state, tree.color, branch.move), branch.next)) ?? false;
}

// A genuine Go board with a two-eye outer black group. The lab highlights the
// playable chamber; the two eyes make the solver's immutable wall assumption
// independently checkable rather than hiding a capturable border in an SGF.
export function materialize(puzzle) {
  if (puzzle.layout?.version?.startsWith('compact-edge-')) return compactBoard(puzzle);
  const maxX = Math.max(...puzzle.cells.map(([x]) => x));
  const maxY = Math.max(...puzzle.cells.map(([, y]) => y));
  const size = Math.max(maxX + 7, maxY + 7) <= 9 ? 9 : 13;
  const board = Array.from({ length: size }, () => Array(size).fill(0));
  const chamberPoints = new Set(puzzle.cells.map(([x, y]) => `${x + 2},${y + 2}`));
  // Thick connected enclosure, with two separate one-point eyes on its right.
  for (let y = 0; y <= maxY + 4; y++) for (let x = 0; x <= maxX + 4; x++) if (!chamberPoints.has(`${x},${y}`)) board[y][x] = BLACK;
  const eyeX = maxX + 5;
  for (let y = 0; y <= Math.max(4, maxY + 4); y++) for (let x = maxX + 4; x <= maxX + 6; x++) board[y][x] = BLACK;
  board[1][eyeX] = 0; board[3][eyeX] = 0;
  for (let i = 0; i < puzzle.cells.length; i++) {
    const [x, y] = puzzle.cells[i];
    board[y + 2][x + 2] = puzzle.initial.black & bit(i) ? BLACK : puzzle.initial.white & bit(i) ? WHITE : 0;
  }
  if (puzzle.toPlay === 'W') for (const row of board) for (let x = 0; x < row.length; x++) if (row[x]) row[x] = 3 - row[x];
  return { size, board, offset: [2, 2], target: puzzle.cells[puzzle.target].map((n) => n + 2), wallEyes: [[eyeX, 1], [eyeX, 3]] };
}

function compactBoard(puzzle) {
  const { boardSize: size, offset } = puzzle.layout;
  const board = Array.from({ length: size }, () => Array(size).fill(0));
  const points = new Set(puzzle.cells.map(([x, y]) => `${x + offset[0]},${y + offset[1]}`));
  // Only the one-stone contour is present. Off-board sides are real edges.
  for (const [x, y] of puzzle.cells) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const px = x + offset[0] + dx, py = y + offset[1] + dy;
    if (px >= 0 && py >= 0 && px < size && py < size && !points.has(`${px},${py}`)) board[py][px] = BLACK;
  }
  // A small, connected two-eye continuation makes the surrounding chain
  // independently alive. It replaces the old 100-stone filled rectangle.
  const wallX = Math.max(...puzzle.cells.map(([x]) => x)) + offset[0] + 1;
  const wallY = Math.max(...puzzle.cells.map(([, y]) => y)) + offset[1] + 1;
  const bottom = puzzle.layout.support === 'bottom-left';
  const left = puzzle.layout.support === 'left-corner';
  let wallEyes;
  if (puzzle.layout.version === 'compact-edge-v2') {
    if (!left && (bottom ? wallY : wallX) + 3 >= size) throw new Error('Minimal support exceeds board.');
    if (left) {
      // The real upper-left board corner needs only TWO additional stones
      // alongside the existing left contour to form two unconditional eyes.
      board[1][0] = BLACK; board[3][0] = BLACK;
      wallEyes = [[0, 0], [0, 2]];
    } else if (bottom) {
      const end = Math.min(size - 1, wallY + 4);
      for (let y = wallY; y <= end; y++) for (let x = 0; x <= 1; x++) board[y][x] = BLACK;
      wallEyes = [[0, wallY + 1], [0, wallY + 3]];
    } else {
      const end = Math.min(size - 1, wallX + 4);
      for (let x = wallX; x <= end; x++) for (let y = 0; y <= 1; y++) board[y][x] = BLACK;
      wallEyes = [[wallX + 1, 0], [wallX + 3, 0]];
    }
  } else {
    if ((bottom ? wallY : wallX) + 2 >= size) throw new Error('Compact support exceeds board.');
    if (bottom) for (let y = wallY; y <= wallY + 2; y++) for (let x = 0; x <= 3; x++) board[y][x] = BLACK;
    else for (let y = 0; y <= 3; y++) for (let x = wallX; x <= wallX + 2; x++) board[y][x] = BLACK;
    wallEyes = bottom ? [[0, wallY + 1], [2, wallY + 1]] : [[wallX + 1, 0], [wallX + 1, 2]];
  }
  for (const [x, y] of wallEyes) board[y][x] = 0;
  for (const [i, [x, y]] of puzzle.cells.entries()) board[y + offset[1]][x + offset[0]] = puzzle.initial.black & bit(i) ? BLACK : puzzle.initial.white & bit(i) ? WHITE : 0;
  if (puzzle.toPlay === 'W') for (const row of board) for (let x = 0; x < size; x++) if (row[x]) row[x] = 3 - row[x];
  return { size, board, offset, target: puzzle.cells[puzzle.target].map((n, axis) => n + offset[axis]), wallEyes,
    wallAnchor: left ? [1, 0] : bottom ? [0, wallY] : [wallX, 0], kind: puzzle.layout.kind };
}

export function assessPresentation(puzzle) {
  const { board } = materialize(puzzle);
  const totalStones = board.flat().filter(Boolean).length;
  const supportStones = totalStones - popcount(puzzle.initial.black | puzzle.initial.white);
  const targetStones = popcount(new Chamber(puzzle.cells, puzzle.layout).group(puzzle.initial.white, puzzle.target));
  const maxSameColorSquare = [BLACK, WHITE].reduce((maximum, color) => {
    for (let y = 0; y < board.length - 2; y++) for (let x = 0; x < board.length - 2; x++) {
      if ([0, 1, 2].every((dy) => [0, 1, 2].every((dx) => board[y + dy][x + dx] === color))) maximum = Math.max(maximum, 3);
    }
    return maximum;
  }, 0);
  return { version: 'compact-diagram-v1', accepted: totalStones <= 36 && supportStones <= 24 && targetStones <= 16 && maxSameColorSquare < 3,
    totalStones, supportStones, targetStones, maxSameColorSquare };
}

// Certificates use role-normalized bitboards: BLACK is always the attacker.
// Public boards and sequences use the actual stone colors, including White start.
export const physicalColor = (puzzle, color) => puzzle.toPlay === 'W' ? 3 - color : color;
function playableErrorLine(wrong) {
  const line = [{ color: BLACK, move: wrong.firstMove }];
  let tree = wrong.proof;
  while (!tree.outcome && line.length < 4) {
    const branch = tree.color === WHITE ? bestDefense(tree) : tree.branches.filter((b) => b.move >= 0)
      .sort((a, b) => principalLine(b.next).length - principalLine(a.next).length || a.move - b.move)[0];
    // A forced-life position with no legal stone placement is already a
    // meaningful refutation. Do not pad its demonstration with a Black pass.
    if (!branch) break;
    line.push({ color: tree.color, move: branch.move }); tree = branch.next;
  }
  return line;
}
export function shortAlternatives(puzzle) {
  return puzzle.wrongPaths.map((wrong) => ({ ...wrong, preview: playableErrorLine(wrong) }))
    .sort((a, b) => b.preview.length - a.preview.length || a.firstMove - b.firstMove).slice(0, 2).map((wrong, i) => {
    const line = wrong.preview;
    let remaining = wrong.proof;
    for (const ply of line.slice(1)) remaining = remaining.branches.find((branch) => branch.move === ply.move).next;
    return { id: `error-${i + 1}`, firstMove: wrong.firstMove, status: 'incorrect', line,
      feedbackAfterPly: line.length, endpoint: { outcome: remaining.outcome === 'alive' ? 'alive' : 'life-forced',
        reason: remaining.outcome === 'alive' ? 'Die markierte Gruppe hat zwei sichere Augen.' : 'Der Gegner kann jetzt gegen jede Fortsetzung zwei sichere Augen erzwingen.',
        certificate: { firstMove: wrong.firstMove, path: line.slice(1).map((ply) => ply.move) } } };
  });
}
export function preparePuzzle(puzzle, toPlay = puzzle.toPlay ?? 'B') {
  const result = { ...puzzle, toPlay };
  const physical = materialize(result);
  const sequence = (line) => line.map((ply, i) => ({ ply: i + 1, color: physicalColor(result, ply.color) === BLACK ? 'B' : 'W',
    point: ply.move < 0 ? null : result.cells[ply.move].map((n, axis) => n + physical.offset[axis]), pass: ply.move < 0 }));
  result.alternatives = shortAlternatives(result);
  result.exportVersion = PRESENTATION_VERSION;
  result.solverEncoding = { attacker: 'B', defender: 'W', colors: 'role-normalized', actualAttacker: toPlay };
  result.startingPosition = { size: physical.size, board: physical.board, target: physical.target,
    playablePoints: result.cells.map((point) => point.map((n, axis) => n + physical.offset[axis])), toPlay };
  result.kyu = result.difficulty.kyu;
  result.solutionSequence = { status: 'correct', moves: sequence(result.solution), ownMoves: result.ownMoves };
  result.alternativeSequences = result.alternatives.map(({ line, ...alternative }) => ({ ...alternative, moves: sequence(line), maximumPlies: 4 }));
  return result;
}

export function toSgf(puzzle) {
  const { size, board, offset, target } = materialize(puzzle);
  const point = ([x, y]) => String.fromCharCode(97 + x, 97 + y);
  const move = (index) => index < 0 ? '' : point(puzzle.cells[index].map((n, axis) => n + offset[axis]));
  const setup = (color) => board.flatMap((row, y) => row.flatMap((stone, x) => stone === color ? [`[${point([x, y])}]`] : [])).join('');
  const color = (role) => physicalColor(puzzle, role) === BLACK ? 'B' : 'W';
  const encode = (tree) => tree.outcome ? 'C[CORRECT: marked group captured.]' : tree.branches.map((b) => `(;${color(tree.color)}[${move(b.move)}]${encode(b.next)})`).join('');
  const alternatives = shortAlternatives(puzzle).map((alternative) => `(${alternative.line.map((ply) => `;${color(ply.color)}[${move(ply.move)}]`).join('')}C[INCORRECT: ${alternative.endpoint.outcome === 'alive' ? 'marked group has two unconditional eyes.' : 'opponent can force two unconditional eyes against every continuation.'} Feedback after ply ${alternative.feedbackAfterPly}; maximum 4 plies.])`).join('');
  return `(;GM[1]FF[4]CA[UTF-8]SZ[${size}]PL[${puzzle.toPlay}]GN[GoStone Lab Puzzle ${puzzle.number ?? ''}]AB${setup(BLACK)}AW${setup(WHITE)}MA[${point(target)}]C[${puzzle.toPlay === 'W' ? 'White' : 'Black'} to capture the marked group. Play only in the marked local region. ${puzzle.ownMoves} own turns in the longest defense. Estimated ${puzzle.difficulty.kyu} kyu, uncalibrated. Surrounding attacker chain has two eyes.]${encode(puzzle.proof)}${alternatives})\n`;
}

export function verifyPuzzle(puzzle, { requireCurrentQuality = false } = {}) {
  if (puzzle.schemaVersion !== VERSION || puzzle.goal !== 'capture' || !['B', 'W'].includes(puzzle.toPlay)) throw new Error('Unsupported puzzle format.');
  if (requireCurrentQuality && (puzzle.quality?.version !== 'active-defense-v3' || !puzzle.activeDefenseProof)) throw new Error('Diese Aufgabe hat keinen aktuellen Nachweis der aktiven Verteidigungstiefe.');
  if (requireCurrentQuality && (puzzle.layout?.version !== 'compact-edge-v2' || !puzzle.presentationQuality?.accepted ||
    puzzle.presentationQuality.totalStones > (puzzle.ownMoves <= 4 ? 28 : 32))) throw new Error('Diese Aufgabe hat kein aktuelles kompaktes Brettformat und kann nicht freigegeben oder exportiert werden.');
  if (!Array.isArray(puzzle.cells) || puzzle.cells.some((point) => !Array.isArray(point) || point.length !== 2 || point.some((n) => !Number.isInteger(n) || n < 0 || n > 6))) throw new Error('Invalid physical chamber coordinates.');
  const chamber = new Chamber(puzzle.cells, puzzle.layout);
  if (puzzle.layout) {
    const modern = puzzle.layout.version === 'compact-edge-v2';
    if (!['compact-edge-v1','compact-edge-v2'].includes(puzzle.layout.version) || !['corner', 'edge'].includes(puzzle.layout.kind) ||
      (puzzle.layout.kind === 'edge' && modern ? puzzle.layout.support !== 'left-corner' : puzzle.layout.support && !['top-right','bottom-left'].includes(puzzle.layout.support)) ||
      puzzle.layout.boardSize !== 9 || JSON.stringify(puzzle.layout.offset) !== JSON.stringify(puzzle.layout.kind === 'corner' ? [0, 0] : [modern ? 2 : 1, 0])) throw new Error('Invalid compact layout.');
    const presentation = assessPresentation(puzzle);
    if (!presentation.accepted || JSON.stringify(presentation) !== JSON.stringify(puzzle.presentationQuality)) throw new Error('Invalid compact visual quality.');
  }
  if (!Number.isInteger(puzzle.target) || puzzle.target < 0 || puzzle.target >= puzzle.cells.length) throw new Error('Invalid target.');
  if (!Number.isInteger(puzzle.initial.black) || !Number.isInteger(puzzle.initial.white) || puzzle.initial.black < 0 || puzzle.initial.white < 0 || puzzle.initial.black > chamber.mask || puzzle.initial.white > chamber.mask || puzzle.initial.ko !== -1 || puzzle.initial.passes !== 0) throw new Error('Invalid initial bitboards.');
  if (!chamber.valid(puzzle.initial) || !(puzzle.initial.white & bit(puzzle.target))) throw new Error('Invalid initial position.');
  const outcome = (tree) => tree.outcome ?? outcome(tree.branches[0].next);
  if (puzzle.proof.color !== BLACK || puzzle.proof.branches?.length !== 1 || outcome(puzzle.proof) !== 'captured') throw new Error('Expected one certified winning first move.');
  const checked = verifyTree(chamber, puzzle.initial, puzzle.target, puzzle.proof);
  const line = principalLine(puzzle.proof);
  if (JSON.stringify(line) !== JSON.stringify(puzzle.solution)) throw new Error('Solution line differs from certificate.');
  if (line.filter((p) => p.color === BLACK).length !== puzzle.ownMoves) throw new Error('Incorrect own-move count.');
  const active = puzzle.quality?.version === 'active-defense-v3';
  const strict = active || puzzle.quality?.version === 'actual-resistance-v2';
  if (strict && (JSON.stringify(assessQuality(chamber, puzzle.initial, puzzle.target, line, active ? puzzle.quality.activeDefenseDepth : null)) !== JSON.stringify(puzzle.quality) || (puzzle.ownMoves >= 3 && puzzle.quality.decisionTurns < 2))) throw new Error('Incorrect tactical quality assessment.');
  if (active) {
    if (puzzle.quality.activeDefenseDepth !== puzzle.ownMoves || !puzzle.activeDefenseProof || outcome(puzzle.activeDefenseProof) !== 'captured') throw new Error('Missing active-defense depth certificate.');
    verifyTree(chamber, puzzle.initial, puzzle.target, puzzle.activeDefenseProof, BLACK, [positionKey(puzzle.initial)], { allowWhitePass: false });
    if (principalLine(puzzle.activeDefenseProof).filter((p) => p.color === BLACK).length !== puzzle.ownMoves) throw new Error('Incorrect active-defense depth.');
  }
  if (puzzle.ownMoves > 1 && (line.filter((p) => p.color === WHITE && p.move >= 0).length < (strict ? puzzle.ownMoves - 1 : Math.max(1, puzzle.ownMoves - 2)) || line.filter((p) => p.color === WHITE && p.move < 0).length > (strict ? 0 : 1))) throw new Error('Only cleanup, not a tactical reading puzzle.');
  if (JSON.stringify(fingerprints(chamber, puzzle.initial)) !== JSON.stringify(puzzle.fingerprints)) throw new Error('Fingerprint mismatch.');
  if (!Number.isInteger(puzzle.difficulty.kyu) || puzzle.difficulty.kyu < 1 || puzzle.difficulty.kyu > 30 || puzzle.difficulty.status !== 'estimated') throw new Error('Invalid rank.');
  const firstMoves = new Set([puzzle.proof.branches[0].move]);
  if (!puzzle.passRefutation) throw new Error('Missing pass refutation.');
  if (outcome(puzzle.passRefutation) !== 'alive') throw new Error('Pass is not refuted by life.');
  verifyTree(chamber, chamber.play(puzzle.initial, BLACK, -1), puzzle.target, puzzle.passRefutation, WHITE, [positionKey(puzzle.initial)]);
  for (const wrong of puzzle.wrongPaths) {
    if (outcome(wrong.proof) !== 'alive' || JSON.stringify(wrong.line) !== JSON.stringify([{ color: BLACK, move: wrong.firstMove }, ...principalLine(wrong.proof)])) throw new Error('Invalid refutation outcome or playback.');
    const next = chamber.play(puzzle.initial, BLACK, wrong.firstMove);
    if (!next || firstMoves.has(wrong.firstMove)) throw new Error('Invalid refutation.');
    firstMoves.add(wrong.firstMove);
    verifyTree(chamber, next, puzzle.target, wrong.proof, WHITE, [positionKey(puzzle.initial), positionKey(next)]);
  }
  // Every non-pass legal first move must have either a winning proof or a
  // losing certificate. This independently verifies the unique first move.
  for (const i of indices((chamber.mask & ~(puzzle.initial.black | puzzle.initial.white)) >>> 0)) if (chamber.play(puzzle.initial, BLACK, i) && !firstMoves.has(i)) throw new Error('An initial move is not certified.');
  if (puzzle.exportVersion) {
    if (puzzle.wrongPaths.length < 2) throw new Error('Two alternative paths are required.');
    const expected = preparePuzzle(puzzle);
    for (const field of ['exportVersion', 'solverEncoding', 'startingPosition', 'kyu', 'solutionSequence', 'alternatives', 'alternativeSequences']) {
      if (JSON.stringify(puzzle[field]) !== JSON.stringify(expected[field])) throw new Error(`Invalid exported ${field}.`);
    }
  }
  if (puzzle.layout && (hasLocalKo(chamber, puzzle.initial, puzzle.proof) || hasLocalKo(chamber, puzzle.initial, puzzle.activeDefenseProof) || hasLocalKo(chamber, puzzle.initial, puzzle.passRefutation) ||
    puzzle.wrongPaths.some((wrong) => hasLocalKo(chamber, chamber.play(puzzle.initial, BLACK, wrong.firstMove), wrong.proof)))) throw new Error('Compact task contains a local ko.');
  return checked;
}
