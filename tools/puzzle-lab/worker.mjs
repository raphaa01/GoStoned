import { parentPort } from 'node:worker_threads';
import { candidate, random, analyze } from './generator.mjs';

parentPort.on('message', ({ id, seed, ownMoves, maxNodes, maxMs }) => {
  try {
    const item = candidate(random(seed), ownMoves);
    const result = item ? analyze(item, { ownMoves, maxNodes, maxMs }) : { reason: 'invalid-shape' };
    parentPort.postMessage({ id, ...result });
  } catch (error) {
    parentPort.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
