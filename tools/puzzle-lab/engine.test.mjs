import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { BLACK, WHITE, bit, indices, Chamber, Solver, BudgetExceeded, principalLine, verifyTree, positionKey, bestDefense } from './engine.mjs';
import { analyze, candidate, mutate, random, fingerprints, materialize, toSgf, verifyPuzzle, preparePuzzle, shortAlternatives, assessPresentation, originalSearchBases } from './generator.mjs';
import { DiversityIndex, solutionPattern, targetViews } from './diversity.mjs';
import { Store } from './store.mjs';
import { Jobs, validateConfig } from './jobs.mjs';
import { createLab } from './server.mjs';
import { acquireLock } from './lock.mjs';
import { auditPuzzle } from './audit.mjs';
import { applyMove, getGroup, getNeighbors } from '../../lib/game/goEngine.ts';

const rectangle = (w, h) => Array.from({ length: w * h }, (_, i) => [i % w, Math.floor(i / w)]);
// Original lab output from a procedural search during development; no external
// collection. Two sacrifices, four real White defences, five Black turns.
const originalFive = () => ({ chamber: new Chamber(rectangle(5, 5)), state: { black: 132160, white: 24695487, ko: -1, passes: 0 }, target: 0 });
const originalFour = () => ({ chamber: new Chamber(rectangle(5, 5)), state: { black: 394240, white: 33145791, ko: -1, passes: 0 }, target: 0 });
let five;
function puzzle() {
  if (!five) {
    const result = analyze(originalFive(), { ownMoves: 5, maxNodes: 500000, maxMs: 5000 });
    assert.ok(result.puzzle, result.reason); five = result.puzzle;
  }
  return structuredClone(five);
}
let compact;
function modernPuzzle() {
  if(!compact) {
    const base=originalSearchBases()[0];
    compact=analyze({chamber:new Chamber(base.cells,base.layout),state:base.initial,target:base.target},{ownMoves:4,maxNodes:1000000,maxMs:5000}).puzzle;
  }
  return structuredClone(compact);
}

test('capture, suicide, immutable living wall and simple ko obey Go rules', () => {
  assert.throws(() => new Chamber(rectangle(3, 3).filter(([x, y]) => x !== 1 || y !== 1)), /enclosed hole/);
  const c = new Chamber(rectangle(3, 3));
  const state = { black: bit(1) | bit(3) | bit(5), white: bit(4), ko: -1, passes: 0 };
  assert.equal(c.play(state, BLACK, 7).white, 0);
  assert.equal(c.play(state, WHITE, 0), null);
  assert.equal(c.play(state, BLACK, 1), null);
  const big = new Chamber(rectangle(5, 5));
  const ko = { black: bit(12) | bit(16) | bit(18) | bit(22), white: bit(7) | bit(11) | bit(13), ko: -1, passes: 0 };
  const taken = big.play(ko, WHITE, 17);
  assert.equal(taken.ko, 12);
  assert.equal(big.play(taken, BLACK, 12), null);
  assert.equal(big.play(taken, BLACK, -1).ko, -1);
});

test('real corner edges allow edge eyes and do not grant imaginary Black wall immunity', () => {
  const cells = rectangle(4, 3), chamber = new Chamber(cells, { boardSize: 9, offset: [0, 0] });
  const state = { black: 0, white: (chamber.mask & ~bit(0) & ~bit(2)) >>> 0, ko: -1, passes: 0 };
  assert.equal(chamber.alive(state, 1), true, 'Two real eyes touch the top board edge');
  assert.equal(new Chamber(cells).alive(state, 1), false, 'The old all-sided enclosure is a different game');
  assert.equal(chamber.play(state, BLACK, 0), null, 'A corner suicide cannot inherit immunity from an imaginary wall');
});

test('original search seeds are small independently proved four-turn tasks, not unverified imported templates', () => {
  for(const base of originalSearchBases()) {
    const result=analyze({chamber:new Chamber(base.cells,base.layout),state:base.initial,target:base.target},{ownMoves:4,maxNodes:2000000,maxMs:10000});
    assert.ok(result.puzzle,result.reason); auditPuzzle(result.puzzle);
    assert.ok(result.puzzle.presentationQuality.totalStones<=28);
  }
});

test('mutation changes actual White boundary stones instead of freezing the same target outline', () => {
  const base=originalSearchBases()[2], chamber=new Chamber(base.cells,base.layout), rng=random(725);
  let changedBoundary=false;
  for(let attempt=0;attempt<150;attempt++) {
    const item=mutate(rng,4,base);
    if(item && (base.initial.white & chamber.rim & ~item.state.white)) {changedBoundary=true;break;}
  }
  assert.ok(changedBoundary,'White stones adjacent to the fight at the chamber boundary must be mutable');
});

test('compact corner and edge tasks replay independently and reject oversized dense diagrams', () => {
  const cases = [
    { cells: [[0,0],[1,0],[2,0],[3,0],[0,1],[1,1],[2,1],[3,1],[0,2],[1,2],[0,3],[1,3]], initial: {black:65,white:3746,ko:-1,passes:0}, target:1, kind:'corner' },
    { cells: [[0,0],[1,0],[2,0],[3,0],[0,1],[1,1],[2,1],[3,1],[0,2],[1,2],[2,2],[3,2],[0,3],[1,3],[2,3]], initial: {black:1024,white:31161,ko:-1,passes:0}, target:0, kind:'edge' },
  ];
  for (const raw of cases) for (const layout of [
    ...['top-right','bottom-left'].map((support)=>({version:'compact-edge-v1',kind:raw.kind,boardSize:9,offset:raw.kind==='corner'?[0,0]:[1,0],support})),
    ...(raw.kind==='corner' ? ['top-right','bottom-left'] : ['left-corner']).map((support)=>({version:'compact-edge-v2',kind:raw.kind,boardSize:9,offset:raw.kind==='corner'?[0,0]:[2,0],support})),
  ]) {
    const result = analyze({ chamber:new Chamber(raw.cells,layout),state:raw.initial,target:raw.target },{ownMoves:4,maxNodes:1000000,maxMs:5000});
    assert.ok(result.puzzle,result.reason);
    const p = result.puzzle; verifyPuzzle(p); auditPuzzle(p,{reSolve:true});
    assert.ok(p.presentationQuality.totalStones<=36);
    assert.ok(p.presentationQuality.supportStones<=24);
    if (layout.version==='compact-edge-v2') assert.ok(p.presentationQuality.totalStones<=28, 'Minimal living support keeps a real four-turn task small');
    for (const alternative of p.alternatives) assert.ok(alternative.line.every((ply)=>ply.color!==BLACK || ply.move>=0), 'Every own error move can be placed in the UI');
    const white=preparePuzzle(p,'W'); verifyPuzzle(white); auditPuzzle(white);
    assert.deepEqual(p.startingPosition.playablePoints[0],layout.offset);
    const invalid=structuredClone(p); invalid.presentationQuality.totalStones=100;
    assert.throws(()=>verifyPuzzle(invalid),/visual quality/);
  }
  const old=puzzle(); assert.equal(assessPresentation(old).accepted,false,'The old giant rectangle must fail the new diagram gate');
});

test('target shape comparison rejects the same small group despite different surrounding stones', () => {
  const p=puzzle(), index=new DiversityIndex([p]);
  const different=puzzle(); different.solution=undefined;
  const empty=indices((2**p.cells.length-1)&~(p.initial.black|p.initial.white))[0];
  different.initial.black=(different.initial.black|bit(empty))>>>0;
  different.fingerprints=fingerprints({cells:different.cells,mask:2**different.cells.length-1},different.initial);
  // Remove stronger earlier checks to isolate the group-shape rejection.
  index.exact.clear(); index.families.clear(); index.cores.clear(); index.patterns.clear(); index.moveShapes=[];
  assert.equal(index.duplicate(different),'same-target-shape');
  assert.deepEqual(targetViews(different),targetViews(p));
});

test('adding an outer target stone cannot hide the same core by moving its bounding-box origin', () => {
  const cells=rectangle(4,4), c=new Chamber(cells);
  const white=[[0,1],[1,1],[0,2],[0,3],[1,3],[2,3]].reduce((mask,[x,y])=>mask|bit(y*4+x),0);
  const p={cells,initial:{black:0,white,ko:-1,passes:0},target:4,ownMoves:4};
  p.fingerprints=fingerprints(c,p.initial);
  const added=structuredClone(p); added.initial.white|=bit(0); added.fingerprints=fingerprints(c,added.initial);
  assert.equal(new DiversityIndex([p]).duplicate(added),'similar-target-shape');
});

test('two-eye certificate is conservative; deadline is unknown, never a false refutation', () => {
  const c = new Chamber(rectangle(5, 3));
  const live = { black: 0, white: c.mask & ~bit(6) & ~bit(8), ko: -1, passes: 0 };
  assert.equal(c.alive(live, 0), true);
  const dead = { black: 0, white: c.mask & ~bit(6), ko: -1, passes: 0 };
  assert.equal(c.alive(dead, 0), false);
  const solver = new Solver(c, 0);
  assert.equal(solver.solve(dead, BLACK, 0).value, 0);
  assert.equal(solver.solve(dead, BLACK, 1).value, 1);
  assert.throws(() => new Solver(c, 0, { maxNodes: 0 }).solve(dead, BLACK, 5), BudgetExceeded);
});

test('cached proofs respect horizons, ko, superko histories, and 30-point board precision', () => {
  const c = new Chamber(rectangle(5, 3));
  const state = { black: 0, white: c.mask & ~bit(6), ko: -1, passes: 0 };
  const solver = new Solver(c, 0);
  assert.equal(solver.solve(state, BLACK, 1).value, 1);
  const hits = solver.hits;
  assert.equal(solver.solve(state, BLACK, 5).value, 1);
  assert.ok(solver.hits > hits, 'A proved shorter horizon is reusable');
  assert.equal(solver.solve(state, BLACK, 0).value, 0);
  const forbidden = positionKey(c.play(state, BLACK, 6));
  assert.equal(solver.solve(state, BLACK, 1, [positionKey(state), forbidden]).value, 0, 'Repetition history cannot inherit a cached win');
  assert.equal(solver.solve({ ...state, ko: 6 }, BLACK, 1).value, 0, 'Move cache must respect a changed ko');
  const large = new Chamber(rectangle(6, 5)), largeSolver = new Solver(large, 25);
  // These boards collide if packed as two 25-bit numbers after extending the
  // chamber. Each cached legal move must preserve the correct complete board.
  for (const board of [{ black: 0, white: bit(25), ko: -1, passes: 0 }, { black: 1, white: 0, ko: -1, passes: 0 }]) {
    for (const color of [BLACK, WHITE]) for (const choice of largeSolver.moves(board, color)) assert.deepEqual(choice.next, large.play(board, color, choice.move));
  }
});

test('five-turn puzzle has actual resistance, two sacrifices, and certified wrong moves', () => {
  const p = puzzle();
  assert.equal(p.ownMoves, 5); assert.equal(p.verification.minimumAttackerTurns, 5);
  assert.equal(p.verification.defendingMoves, 4); assert.equal(p.difficulty.factors.sacrifices, 2);
  assert.equal(p.difficulty.status, 'estimated'); assert.equal(p.difficulty.confidence, 'uncalibrated');
  assert.ok(p.difficulty.kyu <= 10);
  const c = new Chamber(p.cells);
  assert.notEqual(new Solver(c, p.target, { maxMs: 5000 }).solve(p.initial, BLACK, 7).value, 1);
  assert.equal(verifyPuzzle(p).nodes, p.verification.proofNodes);
  assert.equal(p.quality.activeDefenseDepth, 5);
  assert.ok(p.wrongPaths.length >= 2);
});

test('four-turn puzzle is a different motif and has no artificial cleanup passes', () => {
  const result = analyze(originalFour(), { ownMoves: 4, maxNodes: 500000, maxMs: 5000 });
  assert.ok(result.puzzle, result.reason);
  assert.equal(result.puzzle.ownMoves, 4); assert.equal(result.puzzle.verification.defendingMoves, 3);
  assert.equal(result.puzzle.verification.defenderPasses, 0); verifyPuzzle(result.puzzle);
  assert.equal(new DiversityIndex([puzzle()]).duplicate(result.puzzle), null);
});

test('automatic White response is a strongest defence; no opponent blunder enables the solution', () => {
  const p = puzzle(), chamber = new Chamber(p.cells);
  const first = p.proof.branches[0];
  const afterBlack = chamber.play(p.initial, BLACK, first.move);
  const history = [positionKey(p.initial), positionKey(afterBlack)];
  const chosen = bestDefense(first.next);
  const depths = new Map();
  for (const choice of new Solver(chamber, p.target).moves(afterBlack, WHITE)) {
    const key = positionKey(choice.next);
    if (choice.move !== -1 && history.includes(key)) continue;
    const solver = new Solver(chamber, p.target, { maxNodes: 2000000, maxMs: 10000 });
    let depth = 0;
    for (let n = 1; n < p.ownMoves; n++) if (solver.solve(choice.next, BLACK, n * 2 - 1, choice.move === -1 ? history : [...history, key]).value === 1) { depth = n; break; }
    assert.ok(depth > 0, `Black must beat White reply ${choice.move}, not merely the displayed reply`);
    depths.set(choice.move, depth);
  }
  assert.equal(depths.get(chosen.move), Math.max(...depths.values()));
  for (const wrong of p.wrongPaths) {
    const reply = bestDefense(wrong.proof);
    assert.ok(reply || wrong.proof.outcome === 'alive');
    const afterWrong = chamber.play(p.initial, BLACK, wrong.firstMove);
    // The certificate has every Black continuation after the chosen White
    // strategy, so Black cannot rely on White making a later error either.
    verifyTree(chamber, afterWrong, p.target, wrong.proof, WHITE, [positionKey(p.initial), positionKey(afterWrong)]);
  }
});

test('depth cannot be inflated by passive defence or a suboptimal Black continuation', () => {
  const oldFour = { chamber: new Chamber([[1,0],[2,0],[3,0],[4,0],[0,1],[1,1],[2,1],[3,1],[4,1],[0,2],[1,2],[2,2],[3,2],[4,2],[0,3],[1,3],[2,3],[3,3]]), state: { black: 8192, white: 246719, ko: -1, passes: 0 }, target: 0 };
  const oldFive = { chamber: new Chamber(rectangle(5, 5)), state: { black: 9280, white: 24822463, ko: -1, passes: 0 }, target: 0 };
  for (const [item, ownMoves] of [[oldFour, 4], [oldFive, 5]]) assert.equal(analyze(item, { ownMoves, maxNodes: 500000, maxMs: 5000 }).reason, 'pass-inflated-depth');
});

test('independent main-app engine replays every certificate on the full physical Go board', () => {
  const p = puzzle(), c = new Chamber(p.cells), physical = materialize(p);
  const base = physical.board.map((row) => row.map((stone) => stone === BLACK ? 'black' : stone === WHITE ? 'white' : null));
  const wall = getGroup(base, { x: 0, y: 0 });
  const wallLiberties = wall.flatMap((point) => getNeighbors(base, point)).filter((point) => base[point.y][point.x] === null);
  for (const [x, y] of physical.wallEyes) assert.ok(wallLiberties.some((point) => point.x === x && point.y === y));
  const walk = (state, tree, board) => {
    if (tree.outcome) return;
    for (const branch of tree.branches) {
      let nextBoard = board;
      if (branch.move >= 0) {
        const [x, y] = p.cells[branch.move];
        const result = applyMove(board, tree.color === BLACK ? 'black' : 'white', x + 2, y + 2);
        assert.equal(result.ok, true, `Full-board move ${x},${y} was illegal`); nextBoard = result.board;
      }
      const next = c.play(state, tree.color, branch.move);
      for (let i = 0; i < p.cells.length; i++) {
        const [x, y] = p.cells[i];
        assert.equal(nextBoard[y + 2][x + 2], next.black & bit(i) ? 'black' : next.white & bit(i) ? 'white' : null);
      }
      walk(next, branch.next, nextBoard);
    }
  };
  walk(p.initial, p.proof, base);
  walk(p.initial, p.activeDefenseProof, base);
  for (const wrong of p.wrongPaths) {
    const [x, y] = p.cells[wrong.firstMove];
    walk(c.play(p.initial, BLACK, wrong.firstMove), wrong.proof, applyMove(base, 'black', x + 2, y + 2).board);
  }
  const audited = auditPuzzle(p, { reSolve: true });
  assert.ok(audited.lifeLeaves > 0 && audited.captureLeaves > 0);
});

test('tampering, missing defences, extra branches and incorrect lengths fail verification', () => {
  const p = puzzle(), c = new Chamber(p.cells);
  assert.throws(() => verifyTree(c, p.initial, p.target, { outcome: 'captured' }), /False capture/);
  assert.throws(() => verifyTree(c, p.initial, p.target, { outcome: 'alive' }), /False life/);
  const incomplete = puzzle(); incomplete.proof.branches[0].next.branches.pop();
  assert.throws(() => verifyPuzzle(incomplete), /reply is missing/);
  const altered = puzzle(); altered.ownMoves = 4;
  assert.throws(() => verifyPuzzle(altered), /move count/);
  const missingPass = puzzle(); delete missingPass.passRefutation;
  assert.throws(() => verifyPuzzle(missingPass), /pass refutation/);
  const missingWrong = puzzle(); missingWrong.wrongPaths.pop();
  assert.throws(() => verifyPuzzle(missingWrong), /not certified/);
  const missingActive = puzzle(); delete missingActive.activeDefenseProof;
  assert.throws(() => verifyPuzzle(missingActive), /active-defense/);
  const falseQuality = puzzle(); falseQuality.quality.decisionTurns++;
  assert.throws(() => verifyPuzzle(falseQuality), /quality assessment/);
  const legacy = puzzle(); delete legacy.quality; delete legacy.activeDefenseProof;
  verifyPuzzle(legacy);
  assert.throws(() => verifyPuzzle(legacy, { requireCurrentQuality: true }), /Verteidigungstiefe/);
  assert.throws(() => verifyPuzzle(puzzle(), { requireCurrentQuality: true }), /kompaktes Brettformat/, 'Mathematically proved giant wall diagrams cannot be exported');
});

test('diversity rejects all symmetries, shifts and the same motif in another enclosure', () => {
  const p = puzzle(), index = new DiversityIndex([p]);
  for (let rotation = 0; rotation < 4; rotation++) {
    const shifted = puzzle(); shifted.cells = shifted.cells.map(([x, y]) => { for (let r = 0; r < rotation; r++) [x, y] = [-y, x]; return [x + 20, y + 30]; });
    shifted.fingerprints = fingerprints({ cells: shifted.cells }, shifted.initial);
    assert.equal(index.duplicate(shifted), 'duplicate');
    const reflected = structuredClone(shifted); reflected.cells = reflected.cells.map(([x, y]) => [-x, y]);
    reflected.fingerprints = fingerprints({ cells: reflected.cells }, reflected.initial);
    assert.equal(index.duplicate(reflected), 'duplicate');
  }
  const extended = puzzle(); extended.cells.push([5, 4]); extended.initial.white |= bit(25);
  extended.fingerprints = fingerprints({ cells: extended.cells }, extended.initial);
  assert.equal(index.duplicate(extended), 'same-motif');
  const different = puzzle(); different.initial.white = bit(0); different.initial.black = bit(3) | bit(11) | bit(19);
  different.fingerprints = fingerprints({ cells: different.cells }, different.initial);
  assert.equal(index.duplicate(different), 'same-solution-pattern', 'Different setup with identical played moves is rejected');
  const convergence = puzzle(), first = convergence.solution[0].move, replaced = indices(convergence.initial.black)[0];
  convergence.initial.black = ((convergence.initial.black & ~bit(replaced)) | bit(first)) >>> 0;
  convergence.solution[0].move = replaced;
  convergence.fingerprints = fingerprints({ cells: convergence.cells }, convergence.initial);
  assert.equal(index.duplicate(convergence), 'same-continuation', 'Different setup must not hide the same problem after the first move');
});

test('candidate seeds are reproducible and unknown results stay out of the catalog', () => {
  const a = candidate(random(182), 5), b = candidate(random(182), 5);
  assert.deepEqual(a?.state, b?.state);
  const raw = originalFive();
  assert.equal(analyze(raw, { ownMoves: 5, maxNodes: 1, maxMs: 1000 }).reason, 'budget');
  assert.equal(analyze(raw, { ownMoves: 4, maxNodes: 100000, maxMs: 1000 }).reason, 'unresolved');
  assert.throws(() => validateConfig({ ownMovesMin: 6, ownMovesMax: 4 }));
  assert.throws(() => validateConfig({ workers: 999 }));
  assert.throws(() => validateConfig({ kyuMin: 0 }));
  assert.throws(() => validateConfig({ toString: 1 }), /Unbekannte Einstellung/);
});

test('SGF includes physical living wall, player turns, full defences and refutations', () => {
  const p = puzzle(), sgf = toSgf(p);
  assert.match(sgf, /GM\[1\]FF\[4\]/); assert.match(sgf, /PL\[B\]/); assert.match(sgf, /MA\[/);
  assert.match(sgf, /INCORRECT/); assert.match(sgf, /CORRECT/); assert.match(sgf, /uncalibrated/);
  const sequence = principalLine(p.proof);
  assert.equal(sequence.filter((ply) => ply.color === BLACK).length, 5);
});

test('two short error paths end at certified losing states, not invented eye terminals', () => {
  const p = puzzle(), c = new Chamber(p.cells), alternatives = shortAlternatives(p);
  assert.equal(alternatives.length, 2);
  assert.equal(new Set(alternatives.map((a) => a.firstMove)).size, 2);
  for (const alternative of alternatives) {
    assert.equal(alternative.status, 'incorrect');
    assert.ok(alternative.line.length <= 4);
    assert.equal(alternative.feedbackAfterPly, alternative.line.length);
    let state = p.initial, history = [positionKey(state)];
    let tree = p.wrongPaths.find((w) => w.firstMove === alternative.firstMove).proof;
    for (const [i, ply] of alternative.line.entries()) {
      assert.equal(ply.color, i % 2 === 0 ? BLACK : WHITE);
      if (i && ply.color === WHITE) assert.equal(ply.move, bestDefense(tree).move);
      state = c.play(state, ply.color, ply.move); assert.ok(state);
      if (ply.move >= 0) { assert.ok(!history.includes(positionKey(state))); history.push(positionKey(state)); }
      if (i) tree = tree.branches.find((b) => b.move === ply.move).next;
    }
    assert.equal(alternative.endpoint.outcome, c.alive(state, p.target) ? 'alive' : 'life-forced');
    verifyTree(c, state, p.target, tree, alternative.line.length % 2 ? WHITE : BLACK, history);
  }
  assert.equal((toSgf(p).match(/INCORRECT:/g) ?? []).length, 2);
  const tampered = puzzle(); tampered.alternativeSequences[0].feedbackAfterPly = 5;
  assert.throws(() => verifyPuzzle(tampered), /exported alternativeSequences/);
});

test('White starts have actual White setup and move colors in JSON and SGF and pass independent full-board audit', () => {
  const black = puzzle(), white = preparePuzzle(black, 'W');
  verifyPuzzle(white);
  assert.deepEqual(auditPuzzle(white), auditPuzzle(black));
  assert.equal(white.toPlay, 'W'); assert.equal(white.startingPosition.toPlay, 'W');
  assert.equal(white.solutionSequence.moves[0].color, 'W');
  assert.equal(white.alternativeSequences.length, 2);
  assert.equal(white.kyu, white.difficulty.kyu);
  for (let y = 0; y < black.startingPosition.size; y++) for (let x = 0; x < black.startingPosition.size; x++) {
    const stone = black.startingPosition.board[y][x];
    assert.equal(white.startingPosition.board[y][x], stone ? 3 - stone : 0);
  }
  for (const path of [white.solutionSequence, ...white.alternativeSequences]) {
    let board = white.startingPosition.board.map((row) => row.map((stone) => stone === BLACK ? 'black' : stone === WHITE ? 'white' : null));
    for (const move of path.moves) {
      if (move.pass) continue;
      const result = applyMove(board, move.color === 'B' ? 'black' : 'white', ...move.point);
      assert.ok(result.ok); board = result.board;
    }
  }
  assert.match(toSgf(white), /PL\[W\]/);
  const tampered = structuredClone(white); tampered.startingPosition.toPlay = 'B';
  assert.throws(() => verifyPuzzle(tampered), /exported startingPosition/);
  assert.equal(new DiversityIndex([black]).duplicate(white), 'duplicate', 'Color swapping cannot create a new puzzle');
});

test('played stone patterns ignore surroundings, move order, translation, rotation, reflection and actual color', () => {
  const p = puzzle(), pattern = solutionPattern(p);
  for (let symmetry = 0; symmetry < 8; symmetry++) {
    const changed = preparePuzzle(p, 'W');
    changed.cells = changed.cells.map(([x, y]) => {
      if (symmetry & 4) x = -x;
      for (let r = 0; r < (symmetry & 3); r++) [x, y] = [-y, x];
      return [x + 27, y + 18];
    });
    changed.initial.white = bit(0); changed.initial.black = bit(3);
    changed.solution.reverse();
    assert.equal(solutionPattern(changed), pattern);
  }
  const changed = puzzle(); changed.solution[0].move = 0;
  assert.notEqual(solutionPattern(changed), pattern);
});

test('store persists review states and jobs recover as paused without changing global numbering', () => {
  const root = mkdtempSync(join(tmpdir(), 'gostone-puzzle-lab-'));
  const seed=modernPuzzle();
  try {
    const store = new Store(root); assert.equal(store.add(seed).number, 1);
    store.review(1, 'approved'); assert.equal(new Store(root).load(1).review, 'approved');
    writeFileSync(join(root, 'job.json'), JSON.stringify({ status: 'running', config: validateConfig({}), accepted: 1, elapsedMs: 100, resumedAt: Date.now() - 100000, attempts: 2, nextAttempt: 3, numbers: [1], reasons: {} }));
    const jobs = new Jobs(store); assert.equal(jobs.snapshot().status, 'paused'); assert.equal(jobs.snapshot().elapsedMs, 100);
    assert.equal(jobs.diversity.duplicate(seed), 'duplicate'); jobs.control('stop'); jobs.close();
    const changed=structuredClone(seed); changed.initial.black=bit(3); changed.initial.white=bit(0);
    changed.fingerprints=fingerprints({cells:changed.cells,mask:2**changed.cells.length-1},changed.initial);
    assert.equal(new Jobs(new Store(root)).diversity.duplicate(changed),'same-solution-pattern','Solution-move filters must survive a server restart');
    assert.equal(JSON.parse(readFileSync(join(root, 'job.json'))).status, 'stopped');
    writeFileSync(join(root, 'puzzles/puzzle-2.json'), JSON.stringify({ ...seed, number: 2 }));
    assert.equal(store.add(seed).number, 3, 'An orphaned file must never be overwritten');
    assert.equal(JSON.parse(readFileSync(join(root, 'puzzles/puzzle-2.json'))).number, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('unlimited search resumes a capped run without losing its goal, accepted tasks or search position', () => {
  assert.equal(validateConfig({}).maxAttempts, 0);
  assert.throws(() => validateConfig({maxAttempts:-1}), /maxAttempts/);
  const root=mkdtempSync(join(tmpdir(),'gostone-unlimited-'));
  let jobs;
  try {
    const store=new Store(root); store.add(modernPuzzle());
    writeFileSync(join(root,'job.json'),JSON.stringify({status:'exhausted',config:validateConfig({count:150,ownMovesMin:3,ownMovesMax:3,kyuMin:10,kyuMax:20,maxAttempts:2000000}),accepted:1,numbers:[1],attempts:2000000,nextAttempt:2000000,elapsedMs:400000,resumedAt:null,reasons:{'invalid-shape':1000}}));
    jobs=new Jobs(store); jobs.launch=()=>{};
    jobs.control('resume');
    assert.equal(jobs.job.config.maxAttempts,0);
    assert.equal(jobs.job.config.count,150);
    assert.equal(jobs.job.accepted,1); assert.deepEqual(jobs.job.numbers,[1]);
    assert.equal(jobs.job.attempts,2000000); assert.equal(jobs.job.nextAttempt,2000000);
    const dispatched=[], record={worker:{postMessage:(message)=>dispatched.push(message)}};
    jobs.dispatch(record); jobs.dispatch(record);
    assert.equal(jobs.job.status,'running');
    assert.deepEqual(dispatched.map((message)=>message.id),[2000000,2000001]);
    assert.deepEqual(dispatched.map((message)=>message.layoutKind),['corner','edge'],'An unchanged accepted count must not freeze the search in one layout');
    assert.ok(dispatched.every((message)=>message.ownMoves===3));
    jobs.close();
    const recovered=new Jobs(new Store(root));
    assert.equal(recovered.job.status,'paused'); assert.equal(recovered.job.config.maxAttempts,0);
    assert.deepEqual(recovered.job.numbers,[1]); assert.equal(recovered.job.nextAttempt,2000002);
    recovered.launch=()=>{}; recovered.control('resume');
    recovered.settle(); assert.equal(recovered.job.status,'running','An idle unlimited run is not exhausted');
    recovered.job.accepted=150; recovered.dispatch(record);
    assert.equal(recovered.job.status,'completed','The requested target still ends unlimited search');
    recovered.close();
  } finally {jobs?.close(); rmSync(root,{recursive:true,force:true});}
});

test('one writer per data directory; releasing a lock does not remove a newer owner', () => {
  const root = mkdtempSync(join(tmpdir(), 'gostone-puzzle-lock-'));
  try {
    const release = acquireLock(root);
    assert.throws(() => acquireLock(root), /bereits/);
    release(); const nextRelease = acquireLock(root);
    release(); assert.throws(() => acquireLock(root), /bereits/);
    nextRelease(); const finalRelease = acquireLock(root); finalRelease();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('HTTP shutdown releases the data lock even when the client keeps its connection pooled', async () => {
  const root=mkdtempSync(join(tmpdir(),'gostone-shutdown-')), lab=createLab({root});
  lab.server.listen(0,'127.0.0.1'); await once(lab.server,'listening');
  const url=`http://127.0.0.1:${lab.server.address().port}`;
  try {
    const {token}=await (await fetch(`${url}/api/bootstrap`)).json();
    const closed=once(lab.server,'close');
    const response=await fetch(`${url}/api/shutdown`,{method:'POST',headers:{'Content-Type':'application/json','X-Lab-Token':token},body:'{}'});
    assert.deepEqual(await response.json(),{ok:true});
    await closed;
    const release=acquireLock(root); release();
  } finally {lab.jobs.close(); if(lab.server.listening) await new Promise(resolve=>lab.server.close(resolve)); rmSync(root,{recursive:true,force:true});}
});

test('local HTTP flow protects mutation, survives worker completion and exports approved puzzles only', async () => {
  const root = mkdtempSync(join(tmpdir(), 'gostone-puzzle-http-'));
  const lab = createLab({ root });
  lab.server.listen(0, '127.0.0.1'); await once(lab.server, 'listening');
  const url = `http://127.0.0.1:${lab.server.address().port}`;
  try {
    lab.store.add(modernPuzzle());
    lab.store.add(puzzle());
    const bootstrap = await (await fetch(`${url}/api/bootstrap`)).json();
    assert.equal((await (await fetch(`${url}/api/status`)).json()).instanceId, bootstrap.instanceId);
    assert.equal((await fetch(`${url}/api/puzzles/2/json`)).status,400,'Giant legacy diagrams cannot be downloaded');
    assert.equal((await fetch(`${url}/api/puzzles/2/sgf`)).status,400);
    assert.equal((await fetch(`${url}/api/start`, { method: 'POST', body: '{}' })).status, 403);
    const headers = { 'Content-Type': 'application/json', 'X-Lab-Token': bootstrap.token };
    const start = await fetch(`${url}/api/start`, { method: 'POST', headers, body: JSON.stringify({ count: 5, maxAttempts: 4, workers: 1, maxMs: 50, maxNodes: 1000 }) });
    assert.equal(start.status, 200);
    await new Promise((resolve, reject) => { const deadline = Date.now() + 10000; const check = () => { if (!['running', 'pausing'].includes(lab.jobs.job.status)) resolve(); else if (Date.now() > deadline) reject(new Error('Worker never settled')); else setTimeout(check, 30); }; check(); });
    assert.equal(lab.jobs.job.status, 'exhausted'); assert.equal(lab.jobs.job.attempts, 4);
    const previous=lab.jobs.snapshot();
    const resumed=await fetch(`${url}/api/resume`,{method:'POST',headers,body:'{}'});
    const continued=await resumed.json(); assert.equal(resumed.status,200);
    assert.equal(continued.status,'running'); assert.equal(continued.config.maxAttempts,0);
    assert.equal(continued.accepted,previous.accepted); assert.deepEqual(continued.numbers,previous.numbers);
    const deadline=Date.now()+10000;
    while(lab.jobs.job.attempts<=4 && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,30));
    assert.ok(lab.jobs.job.attempts>4,'Real workers must advance beyond the old cap');
    assert.ok(['running','completed'].includes(lab.jobs.job.status));
    if(lab.jobs.job.status==='running') {
      const paused=await fetch(`${url}/api/pause`,{method:'POST',headers,body:'{}'}); assert.equal(paused.status,200);
      while(lab.jobs.job.status==='pausing' && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,30));
      assert.equal(lab.jobs.job.status,'paused');
    }
    assert.equal((await fetch(`${url}/api/export`)).status, 400);
    const reviewed = await fetch(`${url}/api/review`, { method: 'POST', headers, body: JSON.stringify({ number: 1, status: 'approved' }) }); assert.equal(reviewed.status, 200);
    const exported = await (await fetch(`${url}/api/export`)).json(); assert.equal(exported.puzzles.length, 1); verifyPuzzle(exported.puzzles[0]);
    const hostile = await fetch(`${url}/api/stop`, { method: 'POST', headers: { ...headers, Origin: 'https://example.org' }, body: '{}' }); assert.equal(hostile.status, 403);
    const shown = await (await fetch(`${url}/api/puzzles/1`)).json(); assert.equal(shown.materialized.target.length, 2);
    const sgf = await (await fetch(`${url}/api/puzzles/1/sgf`)).text(); assert.match(sgf, /CORRECT/);
  } finally { lab.jobs.close(); await new Promise((done) => lab.server.close(done)); rmSync(root, { recursive: true, force: true }); }
});
