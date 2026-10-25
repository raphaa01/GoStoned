import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPuzzle, preparePuzzle, PRESENTATION_VERSION } from './generator.mjs';
import { continuationKeys } from './diversity.mjs';

export const defaultDataRoot = () => process.platform === 'win32' && process.env.LOCALAPPDATA
  ? join(process.env.LOCALAPPDATA, 'GoStone', 'PuzzleLab')
  : fileURLToPath(new URL('../../.cache/puzzle-lab/', import.meta.url));

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
    const puzzle = JSON.parse(readFileSync(join(this.directory, `puzzle-${number}.json`), 'utf8'));
    return { ...(puzzle.exportVersion === PRESENTATION_VERSION ? puzzle : preparePuzzle(puzzle)), review: entry.review };
  }
  add(puzzle) {
    verifyPuzzle(puzzle);
    // Never overwrite an orphan left by a crash before the catalog write.
    const highestFile = readdirSync(this.directory).reduce((max, file) => Math.max(max, Number(file.match(/^puzzle-(\d+)\.json$/)?.[1] ?? 0)), 0);
    const number = Math.max(highestFile, this.catalog.reduce((max, entry) => Math.max(max, entry.number), 0)) + 1;
    const full = { ...preparePuzzle(puzzle), cores: continuationKeys(puzzle), number, createdAt: new Date().toISOString() };
    atomicJson(join(this.directory, `puzzle-${number}.json`), full);
    this.catalog.push({ number, kyu: full.difficulty.kyu, toPlay: full.toPlay, ownMoves: full.ownMoves, category: full.category, review: 'pending', createdAt: full.createdAt,
      fingerprints: full.fingerprints, cells: full.cells, layout: full.layout, presentationQuality: full.presentationQuality, initial: full.initial, solution: full.solution, target: full.target, verification: full.verification, quality: full.quality, cores: full.cores });
    atomicJson(this.path, this.catalog);
    return full;
  }
  review(number, status) {
    if (!['pending', 'approved', 'rejected'].includes(status)) throw new Error('Ungültiger Prüfstatus.');
    const entry = this.catalog.find((e) => e.number === number);
    if (!entry) throw new Error('Puzzle nicht gefunden.');
    if (status === 'approved') verifyPuzzle(this.load(number), { requireCurrentQuality: true });
    entry.review = status;
    atomicJson(this.path, this.catalog);
    return { ...entry };
  }
}
