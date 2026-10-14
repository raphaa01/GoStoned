import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Store } from './store.mjs';
import { Jobs, validateConfig } from './jobs.mjs';
import { verifyPuzzle } from './generator.mjs';
import { acquireLock } from './lock.mjs';

const [command, ...args] = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const root = resolve(rootIndex >= 0 ? args[rootIndex + 1] : '.cache/puzzle-lab');
if (command === 'verify') {
  const fileIndex = args.indexOf('--file');
  const store = fileIndex < 0 ? new Store(root) : null;
  const puzzles = fileIndex >= 0 ? (() => { const value = JSON.parse(readFileSync(args[fileIndex + 1], 'utf8')); return value.puzzles ?? [value]; })() : store.list().map((entry) => store.load(entry.number));
  let nodes = 0;
  for (const puzzle of puzzles) nodes += verifyPuzzle(puzzle).nodes;
  console.log(`${puzzles.length} Aufgaben unabhängig nachgespielt; ${nodes} Beweisknoten geprüft. Kyu-Ränge bleiben Schätzungen.`);
} else if (command === 'generate') {
  const config = {};
  for (let i = 0; i < args.length; i += 2) { if (args[i] === '--root') continue; config[args[i].replace(/^--/, '')] = Number(args[i + 1]); }
  const release = acquireLock(root);
  process.on('exit', release);
  const jobs = new Jobs(new Store(root));
  if (jobs.job.status === 'paused') jobs.control('stop');
  jobs.start(validateConfig(config));
  let shuttingDown = false;
  process.on('SIGINT', () => { shuttingDown = true; jobs.close(); });
  while (!shuttingDown && ['running', 'pausing', 'stopping'].includes(jobs.job.status)) {
    await delay(5000);
    const state = jobs.snapshot();
    console.log(`${state.status}: ${state.accepted}/${state.config.count} Aufgaben, ${state.attempts} Versuche · ${JSON.stringify(state.reasons)}`);
  }
  const final = jobs.snapshot(); jobs.close(); release();
  console.log(final.message);
  if (['failed', 'exhausted'].includes(final.status)) process.exitCode = 2;
} else {
  console.log('GoStone Puzzle Lab\n  npm run puzzles:lab\n  npm run puzzles:lab:generate -- --count 20 --ownMovesMin 4 --ownMovesMax 5\n  npm run puzzles:lab:verify\nDie GUI ist der empfohlene Einstieg.');
  process.exitCode = 1;
}
