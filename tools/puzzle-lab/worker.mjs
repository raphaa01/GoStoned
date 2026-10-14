import { parentPort } from 'node:worker_threads';
import { candidate, random, analyze, fingerprints } from './generator.mjs';

const seen = new Set(), knownFamilies = new Set(), bases = [];
function rememberBases(puzzles) {
  for (const puzzle of puzzles) {
    if (bases.some((base) => base.fingerprints.family === puzzle.fingerprints.family)) continue;
    bases.push({ cells: puzzle.cells, initial: puzzle.initial, ownMoves: puzzle.ownMoves, fingerprints: puzzle.fingerprints });
    if (bases.length > 128) bases.shift();
  }
}

parentPort.on('message', ({ type, families, puzzles, id, seed, ownMoves, maxNodes, maxMs }) => {
  if (type === 'exclude') { for (const family of families) knownFamilies.add(family); return; }
  if (type === 'seed') { rememberBases(puzzles); return; }
  try {
    const nearby = bases.filter((base) => Math.abs(base.ownMoves - ownMoves) <= 1);
    const item = candidate(random(seed), ownMoves, nearby);
    let result;
    if (!item) result = { reason: 'invalid-shape' };
    else {
      const prints = fingerprints(item.chamber, item.state);
      const key = `${ownMoves}:${maxNodes}:${maxMs}:${prints.position}`;
      if (knownFamilies.has(prints.family)) result = { reason: 'known-motif' };
      else if (seen.has(key)) result = { reason: 'seen-candidate' };
      else {
        if (seen.size >= 50_000) seen.clear();
        seen.add(key);
        result = analyze(item, { ownMoves, maxNodes, maxMs });
        if (result.puzzle) { knownFamilies.add(prints.family); rememberBases([result.puzzle]); }
      }
    }
    parentPort.postMessage({ id, ...result });
  } catch (error) {
    parentPort.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
