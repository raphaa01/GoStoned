import { Worker } from 'node:worker_threads';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DiversityIndex } from './diversity.mjs';
import { verifyPuzzle } from './generator.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback;
const seconds = Number(option('seconds', '90'));
const moves = option('moves', '3,4,5').split(',').map(Number);
const attempts = Number(option('attempts', '1000000'));
const maxNodes = Number(option('maxNodes', '750000'));
const maxMs = Number(option('maxMs', '1500'));
if (![seconds, attempts, maxNodes, maxMs].every((n) => Number.isInteger(n) && n > 0) || moves.length > 4 || !moves.length || moves.some((n) => !Number.isInteger(n) || n < 1 || n > 8)) throw new Error('Invalid benchmark parameters.');
const source = resolve(option('source', 'tools/puzzle-lab'));
const output = resolve(option('output', '.cache/puzzle-lab-benchmark'));
const seeds = option('seeds', null) ? JSON.parse(readFileSync(resolve(option('seeds', null)), 'utf8')) : [];
for (const puzzle of seeds) verifyPuzzle(puzzle);
mkdirSync(output, { recursive: true });
const started = performance.now(), cpuStarted = process.cpuUsage();
const cases = moves.map((ownMoves) => ({ ownMoves, attempts: 0, next: 0, proven: 0, puzzles: [], reasons: {}, timings: [], firstAcceptedMs: null, diversity: new DiversityIndex(seeds) }));
const percentile = (values, fraction) => values.length ? [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * fraction))] : null;
const workers = [];
let interrupted = false, peakRss = 0;
process.on('SIGINT', () => { interrupted = true; });
function report() {
  const elapsedMs = Math.round(performance.now() - started);
  const cpu = process.cpuUsage(cpuStarted);
  return { source, elapsedMs, cpuMs: Math.round((cpu.user + cpu.system) / 1000), peakRssMb: Math.round(peakRss / 1048576), maxNodes, maxMs, seedCount: seeds.length, seedMethod: '(43777 + imul(attempt, 176387)) >>> 0',
    cases: cases.map((c) => ({ ownMoves: c.ownMoves, attempts: c.attempts, proven: c.proven, distinct: c.puzzles.length, firstAcceptedMs: c.firstAcceptedMs, attemptMedianMs: percentile(c.timings, .5), attemptP95Ms: percentile(c.timings, .95), reasons: c.reasons,
      puzzles: c.puzzles.map((p) => ({ fingerprint: p.fingerprints.family, kyu: p.difficulty.kyu, ownMoves: p.ownMoves, category: p.category, defendingMoves: p.verification.defendingMoves, sacrifices: p.verification.sacrifices, proofNodes: p.verification.proofNodes, searchNodes: p.verification.searchNodes, elapsedMs: p.verification.elapsedMs, quality: p.quality ?? null })) })) };
}
function save() { peakRss = Math.max(peakRss, process.memoryUsage().rss); writeFileSync(join(output, 'report.json'), JSON.stringify(report(), null, 2)); }
const interval = setInterval(() => { save(); console.log(JSON.stringify({ elapsedSeconds: Math.round((performance.now() - started) / 1000), cases: cases.map((c) => ({ moves: c.ownMoves, attempts: c.attempts, distinct: c.puzzles.length, reasons: c.reasons })) })); }, 10000);
await Promise.all(cases.map((c) => new Promise((done, reject) => {
  const worker = new Worker(pathToFileURL(join(source, 'worker.mjs')));
  if (seeds.length) {
    worker.postMessage({ type: 'exclude', families: seeds.map((p) => p.fingerprints.family) });
    worker.postMessage({ type: 'seed', puzzles: seeds.map(({ cells, initial, ownMoves, fingerprints }) => ({ cells, initial, ownMoves, fingerprints })) });
  }
  workers.push(worker);
  let dispatched;
  const dispatch = () => {
    if (interrupted || performance.now() - started >= seconds * 1000 || c.next >= attempts) { void worker.terminate().then(done); return; }
    const id = c.next++;
    dispatched = performance.now();
    worker.postMessage({ id, seed: (43777 + Math.imul(id, 176387)) >>> 0, ownMoves: c.ownMoves, maxNodes, maxMs });
  };
  worker.on('error', reject);
  worker.on('message', (result) => {
    c.attempts++; c.timings.push(Math.round((performance.now() - dispatched) * 100) / 100);
    if (result.error) { for (const w of workers) void w.terminate(); reject(new Error(result.error)); return; }
    let reason = result.reason;
    if (result.puzzle) {
      c.proven++; verifyPuzzle(result.puzzle);
      reason = c.diversity.duplicate(result.puzzle);
      if (!reason) {
        c.diversity.add(result.puzzle); c.puzzles.push(result.puzzle);
        c.firstAcceptedMs ??= Math.round(performance.now() - started);
        writeFileSync(join(output, `moves-${c.ownMoves}-puzzle-${c.puzzles.length}.json`), JSON.stringify(result.puzzle));
      }
    }
    if (reason) c.reasons[reason] = (c.reasons[reason] ?? 0) + 1;
    dispatch();
  });
  dispatch();
}))).finally(() => clearInterval(interval));
save(); console.log(JSON.stringify(report(), null, 2));
