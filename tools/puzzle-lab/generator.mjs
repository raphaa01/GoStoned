import { createHash } from 'node:crypto';
import { BLACK, WHITE, Chamber, Solver, BudgetExceeded, bit, indices, popcount, principalLine, verifyTree, positionKey } from './engine.mjs';

export const VERSION = 'gostone-local-puzzle-lab/1';
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
export function candidate(rng, ownMoves) {
  // Fresh random polyomino eye spaces, connected white shapes and sacrifice
  // stones. No downloaded shapes, position templates or copied solutions.
  const width = pick(rng, ownMoves >= 4 ? [4, 5, 5] : [3, 4, 4, 5]);
  const height = width === 5 ? pick(rng, [4, 5, 5]) : pick(rng, [3, 4, 5]);
  let cells = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) cells.push([x, y]);
  if (rng() < 0.45) cells = cells.filter(([x, y]) => !((x === 0 || x === width - 1) && (y === 0 || y === height - 1) && rng() < 0.5));
  let chamber;
  try { chamber = new Chamber(cells); } catch { return null; }
  let white = 0, black = 0;
  if (rng() < 0.75) {
    // Grow an interior eye space; the surrounding white chain can have cuts,
    // short liberties and internal black sacrifice stones.
    const internal = cells.map(([x, y], i) => ({ x, y, i })).filter(({ x, y }) => x > 0 && y > 0 && x < width - 1 && y < height - 1);
    if (!internal.length) return null;
    let eye = bit(pick(rng, internal).i);
    const desired = Math.min(internal.length + 2, pick(rng, ownMoves >= 4 ? [5, 6, 7, 8, 9] : [2, 3, 4, 5, 6]));
    for (let j = 1; j < desired; j++) {
      const options = indices((chamber.adjacent(eye) & ~eye) >>> 0);
      const interiorOptions = options.filter((i) => !(bit(i) & chamber.rim));
      eye |= bit(pick(rng, interiorOptions.length && rng() < 0.82 ? interiorOptions : options));
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
  if (!chamber.valid(state)) return null;
  let rest = state.white, targetGroup = 0, target = 0;
  while (rest) {
    const first = indices(rest)[0], group = chamber.group(state.white, first);
    if (popcount(group) > popcount(targetGroup)) { targetGroup = group; target = first; }
    rest = (rest & ~group) >>> 0;
  }
  if (chamber.alive(state, target)) return null;
  const liberties = popcount(chamber.liberties(state, targetGroup));
  if (liberties < (ownMoves === 1 ? 1 : 2) || liberties > 9 || popcount(targetGroup) < 4) return null;
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
    // An incorrect move must have a proof of life, not just exceed a move
    // deadline. All initial choices, including pass, must be resolved.
    const auditPlies = requested * 2 + 5;
    const choices = solver.classify(state, auditPlies);
    if (choices.some((c) => c.value === 0)) return { reason: 'unresolved' };
    const winners = choices.filter((c) => c.value === 1);
    if (winners.length !== 1 || winners[0].move < 0) return { reason: 'ambiguous' };
    const proof = solver.tree(state, BLACK, requested * 2 - 1);
    const checked = verifyTree(chamber, state, target, proof);
    const solution = principalLine(proof);
    const actualMoves = solution.filter((ply) => ply.color === BLACK).length;
    if (actualMoves !== requested || solution.some((ply) => ply.move === -1 && ply.color === BLACK)) return { reason: 'depth' };
    // Long cleanup sequences against a passing defender are not deep reading
    // problems. A single tactical pass is allowed only with real resistance.
    const defendingMoves = solution.filter((ply) => ply.color === WHITE && ply.move >= 0).length;
    const defenderPasses = solution.filter((ply) => ply.color === WHITE && ply.move < 0).length;
    if (requested > 1 && (defendingMoves < Math.max(1, requested - 2) || defenderPasses > 1)) return { reason: 'cleanup' };
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
    let replay = state, sacrifices = 0;
    for (const ply of solution) {
      const next = chamber.play(replay, ply.color, ply.move);
      if (ply.color === WHITE && popcount(next.black) < popcount(replay.black)) sacrifices++;
      replay = next;
    }
    const branches = countBranches(proof);
    const difficulty = assessDifficulty({ ownMoves: actualMoves, proofNodes: checked.nodes, branches, refutations: wrongPaths.length, sacrifices });
    const category = sacrifices ? 'Opfer & Rückfang' : actualMoves >= 4 ? 'Mehrzügiges Leben & Tod' : 'Vitalpunkt & Augen';
    return { puzzle: { schemaVersion: VERSION, cells: chamber.cells, initial: state, target, goal: 'capture', toPlay: 'B', ownMoves: actualMoves,
      category, difficulty, fingerprints: fingerprints(chamber, state), solution, proof, wrongPaths, passRefutation,
      verification: { status: 'proven', rules: 'local capture; positional superko; passes allowed', enclosure: 'unconditionally alive attacker wall; chamber-only play', minimumAttackerTurns: minimum, uniqueFirstMove: winners[0].move,
        allInitialMovesResolved: true, proofNodes: checked.nodes, defensiveBranches: branches, defendingMoves, defenderPasses, sacrifices, searchNodes: solver.nodes, cacheHits: solver.hits, elapsedMs: Math.round(performance.now() - started), engine: VERSION },
      provenance: { source: 'original-procedural-generation', foreignPuzzleData: false } } };
  } catch (error) {
    if (error instanceof BudgetExceeded) return { reason: 'budget' };
    throw error;
  }
}
function countBranches(tree) {
  return tree.branches ? Math.max(0, tree.branches.length - 1) + tree.branches.reduce((sum, b) => sum + countBranches(b.next), 0) : 0;
}

// A genuine Go board with a two-eye outer black group. The lab highlights the
// playable chamber; the two eyes make the solver's immutable wall assumption
// independently checkable rather than hiding a capturable border in an SGF.
export function materialize(puzzle) {
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
  return { size, board, offset: [2, 2], target: puzzle.cells[puzzle.target].map((n) => n + 2), wallEyes: [[eyeX, 1], [eyeX, 3]] };
}

export function toSgf(puzzle) {
  const { size, board } = materialize(puzzle);
  const point = ([x, y]) => String.fromCharCode(97 + x, 97 + y);
  const move = (index) => index < 0 ? '' : point(puzzle.cells[index].map((n) => n + 2));
  const setup = (color) => board.flatMap((row, y) => row.flatMap((stone, x) => stone === color ? [`[${point([x, y])}]`] : [])).join('');
  const encode = (tree) => tree.outcome ? `C[${tree.outcome === 'captured' ? 'CORRECT: marked group captured.' : 'INCORRECT: White has two unconditional eyes.'}]` : tree.branches.map((b) => `(;${tree.color === BLACK ? 'B' : 'W'}[${move(b.move)}]${encode(b.next)})`).join('');
  return `(;GM[1]FF[4]CA[UTF-8]SZ[${size}]PL[B]GN[GoStone Lab Puzzle ${puzzle.number ?? ''}]AB${setup(BLACK)}AW${setup(WHITE)}MA[${point(puzzle.cells[puzzle.target].map((n) => n + 2))}]C[Black to capture the marked group. Play only in the chamber. ${puzzle.ownMoves} black turns in the longest defense. Estimated ${puzzle.difficulty.kyu} kyu, uncalibrated. Outer black wall has two eyes.]${encode(puzzle.proof)}${puzzle.wrongPaths.map((wrong) => `(;B[${move(wrong.firstMove)}]${encode(wrong.proof)})`).join('')})\n`;
}

export function verifyPuzzle(puzzle) {
  if (puzzle.schemaVersion !== VERSION || puzzle.goal !== 'capture' || puzzle.toPlay !== 'B') throw new Error('Unsupported puzzle format.');
  if (!Array.isArray(puzzle.cells) || puzzle.cells.some((point) => !Array.isArray(point) || point.length !== 2 || point.some((n) => !Number.isInteger(n) || n < 0 || n > 6))) throw new Error('Invalid physical chamber coordinates.');
  const chamber = new Chamber(puzzle.cells);
  if (!Number.isInteger(puzzle.target) || puzzle.target < 0 || puzzle.target >= puzzle.cells.length) throw new Error('Invalid target.');
  if (!Number.isInteger(puzzle.initial.black) || !Number.isInteger(puzzle.initial.white) || puzzle.initial.black < 0 || puzzle.initial.white < 0 || puzzle.initial.black > chamber.mask || puzzle.initial.white > chamber.mask || puzzle.initial.ko !== -1 || puzzle.initial.passes !== 0) throw new Error('Invalid initial bitboards.');
  if (!chamber.valid(puzzle.initial) || !(puzzle.initial.white & bit(puzzle.target))) throw new Error('Invalid initial position.');
  const outcome = (tree) => tree.outcome ?? outcome(tree.branches[0].next);
  if (puzzle.proof.color !== BLACK || puzzle.proof.branches?.length !== 1 || outcome(puzzle.proof) !== 'captured') throw new Error('Expected one certified winning first move.');
  const checked = verifyTree(chamber, puzzle.initial, puzzle.target, puzzle.proof);
  const line = principalLine(puzzle.proof);
  if (JSON.stringify(line) !== JSON.stringify(puzzle.solution)) throw new Error('Solution line differs from certificate.');
  if (line.filter((p) => p.color === BLACK).length !== puzzle.ownMoves) throw new Error('Incorrect own-move count.');
  if (puzzle.ownMoves > 1 && (line.filter((p) => p.color === WHITE && p.move >= 0).length < Math.max(1, puzzle.ownMoves - 2) || line.filter((p) => p.color === WHITE && p.move < 0).length > 1)) throw new Error('Only cleanup, not a tactical reading puzzle.');
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
  return checked;
}
