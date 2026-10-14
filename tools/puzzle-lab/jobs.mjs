import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { random } from './generator.mjs';
import { DiversityIndex, continuationKeys } from './diversity.mjs';
import { atomicJson } from './store.mjs';

const ACTIVE = ['running', 'pausing', 'stopping'];
export const maxWorkers = Math.max(1, Math.min(6, Math.floor(availableParallelism() / 2)));
export const defaults = { count: 20, ownMovesMin: 3, ownMovesMax: 5, kyuMin: 1, kyuMax: 30, workers: Math.min(2, maxWorkers), maxNodes: 750000, maxMs: 1500, maxAttempts: 20000, seed: 20261014 };
export function validateConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Ungültige Einstellungen.');
  if (Object.keys(value).some((key) => !Object.hasOwn(defaults, key))) throw new Error('Unbekannte Einstellung.');
  const config = { ...defaults, ...value };
  const ranges = { count: [1, 5000], ownMovesMin: [1, 8], ownMovesMax: [1, 8], kyuMin: [1, 30], kyuMax: [1, 30], workers: [1, maxWorkers], maxNodes: [1000, 5000000], maxMs: [50, 10000], maxAttempts: [1, 2000000], seed: [0, 2147483647] };
  for (const [key, [min, max]] of Object.entries(ranges)) if (!Number.isInteger(config[key]) || config[key] < min || config[key] > max) throw new Error(`${key}: ganze Zahl zwischen ${min} und ${max} erforderlich.`);
  if (config.ownMovesMin > config.ownMovesMax || config.kyuMin > config.kyuMax) throw new Error('Minimum darf nicht größer als Maximum sein.');
  return config;
}
export class Jobs {
  constructor(store) {
    this.store = store; this.workers = new Map(); this.saving = null;
    this.path = join(store.root, 'job.json');
    this.job = existsSync(this.path) ? JSON.parse(readFileSync(this.path, 'utf8')) : { status: 'idle' };
    if (ACTIVE.includes(this.job.status)) { this.job.resumedAt = null; this.job.status = 'paused'; this.job.message = 'Lauf nach Neustart pausiert. Fortsetzen ist möglich.'; this.save(); }
    this.diversity = new DiversityIndex(store.list().map((p) => p.ownMoves >= 3 && !p.cores ? { ...p, cores: continuationKeys(store.load(p.number)) } : p));
  }
  save() {
    if (this.job.resumedAt) { this.job.elapsedMs += Date.now() - this.job.resumedAt; this.job.resumedAt = Date.now(); }
    atomicJson(this.path, this.job);
  }
  snapshot() {
    const elapsed = this.job.elapsedMs ?? 0;
    const runningMs = this.job.resumedAt ? Date.now() - this.job.resumedAt : 0;
    return { ...this.job, elapsedMs: elapsed + runningMs, activeWorkers: [...this.workers.values()].filter((w) => w.busy).length, maxWorkers,
      catalogCount: this.store.catalog.length, approved: this.store.catalog.filter((p) => p.review === 'approved').length };
  }
  start(value) {
    if (ACTIVE.includes(this.job.status) || this.job.status === 'paused') throw new Error('Den bisherigen Lauf erst stoppen oder fortsetzen.');
    const config = validateConfig(value);
    this.job = { status: 'running', config, attempts: 0, nextAttempt: 0, accepted: 0, numbers: [], reasons: {}, errors: 0, elapsedMs: 0, resumedAt: Date.now(), startedAt: new Date().toISOString(), message: 'Neue Stellungen werden erzeugt und geprüft.' };
    this.launch(); this.save(); return this.snapshot();
  }
  launch() {
    for (let i = this.workers.size; i < this.job.config.workers; i++) {
      const worker = new Worker(new URL('./worker.mjs', import.meta.url));
      worker.postMessage({ type: 'exclude', families: [...this.diversity.families] });
      worker.postMessage({ type: 'seed', puzzles: this.store.list().filter((p) => p.review !== 'rejected' && p.verification.defenderPasses === 0).slice(-128).map(({ cells, initial, ownMoves, fingerprints }) => ({ cells, initial, ownMoves, fingerprints })) });
      const record = { busy: false, worker, id: null, job: this.job };
      this.workers.set(worker, record);
      worker.on('message', (result) => this.receive(record, result));
      worker.on('error', (error) => { if (record.job !== this.job || !this.workers.has(worker)) return; this.job.message = `Worker-Fehler: ${error.message}`; this.finish('failed'); });
      this.dispatch(record);
    }
    for (const record of this.workers.values()) if (!record.busy) this.dispatch(record);
  }
  dispatch(record) {
    if (this.job.status !== 'running') return this.settle();
    if (this.job.accepted >= this.job.config.count) return this.finish('completed');
    if (this.job.nextAttempt >= this.job.config.maxAttempts) return this.settle();
    const id = this.job.nextAttempt++;
    const rng = random((this.job.config.seed + Math.imul(id + 1, 2654435761)) >>> 0);
    const ownMoves = this.job.config.ownMovesMin + Math.floor(rng() * (this.job.config.ownMovesMax - this.job.config.ownMovesMin + 1));
    record.busy = true; record.id = id;
    record.worker.postMessage({ id, seed: Math.floor(rng() * 4294967296), ownMoves, maxNodes: this.job.config.maxNodes, maxMs: this.job.config.maxMs });
  }
  receive(record, result) {
    if (record.job !== this.job) return;
    record.busy = false;
    if (!ACTIVE.includes(this.job.status)) return;
    try {
      this.job.attempts++;
      let reason = result.reason;
      if (result.error) { this.job.errors++; reason = 'error'; this.job.message = result.error; }
      if (result.puzzle) {
        const puzzle = result.puzzle;
        if (puzzle.difficulty.kyu < this.job.config.kyuMin || puzzle.difficulty.kyu > this.job.config.kyuMax) reason = 'rank';
        else reason = this.diversity.duplicate(puzzle);
        if (!reason && this.job.accepted < this.job.config.count) {
          const full = this.store.add(puzzle); this.diversity.add(full);
          for (const worker of this.workers.keys()) {
            worker.postMessage({ type: 'exclude', families: [full.fingerprints.family] });
            worker.postMessage({ type: 'seed', puzzles: [{ cells: full.cells, initial: full.initial, ownMoves: full.ownMoves, fingerprints: full.fingerprints }] });
          }
          this.job.accepted++; this.job.numbers.push(full.number);
        }
      }
      if (reason) this.job.reasons[reason] = (this.job.reasons[reason] ?? 0) + 1;
      if (this.job.errors >= 5) return this.finish('failed');
      if (this.job.accepted >= this.job.config.count) return this.finish('completed');
      if (!this.saving) this.saving = setTimeout(() => { this.saving = null; this.save(); }, 500);
      if (this.job.status === 'running') this.dispatch(record);
      this.settle();
    } catch (error) { this.job.message = error.message; this.finish('failed'); }
  }
  settle() {
    if ([...this.workers.values()].some((w) => w.busy)) return;
    if (this.job.status === 'pausing') this.finish('paused');
    else if (this.job.status === 'stopping') this.finish('stopped');
    else if (this.job.status === 'running' && this.job.nextAttempt >= this.job.config.maxAttempts) this.finish('exhausted');
  }
  finish(status) {
    if (this.job.resumedAt) this.job.elapsedMs += Date.now() - this.job.resumedAt;
    this.job.resumedAt = null; this.job.status = status;
    if (status !== 'failed') this.job.message = { completed: 'Zielmenge erreicht. Aufgaben sind bereit für die Qualitätsprüfung.', exhausted: 'Versuchslimit erreicht. Es wurden nur eindeutig geprüfte, unterschiedliche Aufgaben behalten.', paused: 'Lauf gespeichert und pausiert.', stopped: 'Lauf gestoppt. Erzeugte Aufgaben bleiben erhalten.' }[status] ?? this.job.message;
    for (const worker of this.workers.keys()) void worker.terminate();
    this.workers.clear(); this.save();
  }
  control(action) {
    if (action === 'resume') {
      if (this.job.status !== 'paused') throw new Error('Nur einen pausierten Lauf fortsetzen.');
      this.job.status = 'running'; this.job.resumedAt = Date.now(); this.job.message = 'Gespeicherten Lauf fortgesetzt.'; this.launch();
    } else if (action === 'pause') {
      if (this.job.status !== 'running') throw new Error('Kein aktiver Lauf.');
      this.job.status = 'pausing'; this.job.message = 'Aktuelle Prüfung wird noch abgeschlossen.'; this.settle();
    } else if (action === 'stop') {
      if (this.job.status === 'paused') this.finish('stopped');
      else if (this.job.status === 'running' || this.job.status === 'pausing') { this.job.status = 'stopping'; this.job.message = 'Aktuelle Prüfung wird noch abgeschlossen.'; this.settle(); }
      else throw new Error('Kein aktiver Lauf.');
    } else throw new Error('Unbekannte Aktion.');
    this.save(); return this.snapshot();
  }
  close() { if (ACTIVE.includes(this.job.status)) this.finish('paused'); if (this.saving) clearTimeout(this.saving); }
}
