import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { verifyPuzzle } from './generator.mjs';

export function atomicJson(path, value) {
  writeFileSync(`${path}.tmp`, JSON.stringify(value));
  renameSync(`${path}.tmp`, path);
}
export class Store {
  constructor(root) {
    this.root = root;
    this.directory = join(root, 'puzzles');
    mkdirSync(this.directory, { recursive: true });
    this.path = join(root, 'catalog.json');
    this.catalog = existsSync(this.path) ? JSON.parse(readFileSync(this.path, 'utf8')) : [];
    if (!Array.isArray(this.catalog)) throw new Error('Ungültiger lokaler Puzzle-Katalog.');
  }
  list() { return this.catalog.map((entry) => ({ ...entry })); }
  load(number) {
    const entry = this.catalog.find((e) => e.number === number);
    if (!entry) throw new Error('Puzzle nicht gefunden.');
    return { ...JSON.parse(readFileSync(join(this.directory, `puzzle-${number}.json`), 'utf8')), review: entry.review };
  }
  add(puzzle) {
    verifyPuzzle(puzzle);
    // Never overwrite an orphan left by a crash before the catalog write.
    const highestFile = readdirSync(this.directory).reduce((max, file) => Math.max(max, Number(file.match(/^puzzle-(\d+)\.json$/)?.[1] ?? 0)), 0);
    const number = Math.max(highestFile, this.catalog.reduce((max, entry) => Math.max(max, entry.number), 0)) + 1;
    const full = { ...puzzle, number, createdAt: new Date().toISOString() };
    atomicJson(join(this.directory, `puzzle-${number}.json`), full);
    this.catalog.push({ number, kyu: full.difficulty.kyu, ownMoves: full.ownMoves, category: full.category, review: 'pending', createdAt: full.createdAt,
      fingerprints: full.fingerprints, cells: full.cells, initial: full.initial, verification: full.verification });
    atomicJson(this.path, this.catalog);
    return full;
  }
  review(number, status) {
    if (!['pending', 'approved', 'rejected'].includes(status)) throw new Error('Ungültiger Prüfstatus.');
    const entry = this.catalog.find((e) => e.number === number);
    if (!entry) throw new Error('Puzzle nicht gefunden.');
    if (status === 'approved') verifyPuzzle(this.load(number));
    entry.review = status;
    atomicJson(this.path, this.catalog);
    return { ...entry };
  }
}
