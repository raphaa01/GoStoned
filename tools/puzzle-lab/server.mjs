import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { Store } from './store.mjs';
import { Jobs, defaults, maxWorkers } from './jobs.mjs';
import { VERSION, materialize, toSgf, verifyPuzzle } from './generator.mjs';
import { Chamber, Solver, BudgetExceeded, positionKey, BLACK } from './engine.mjs';
import { acquireLock } from './lock.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
export function createLab({ root = resolve(directory, '../../.cache/puzzle-lab'), port = 4184 } = {}) {
  const release = acquireLock(root);
  let store, jobs;
  try { store = new Store(root); jobs = new Jobs(store); } catch (error) { release(); throw error; }
  const token = randomBytes(24).toString('hex');
  const json = (response, value, status = 200) => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(value));
  };
  const server = createServer(async (request, response) => {
    const host = request.headers.host;
    const actualPort = server.address()?.port ?? port;
    if (![ `127.0.0.1:${actualPort}`, `localhost:${actualPort}` ].includes(host)) return json(response, { error: 'Ungültiger Host.' }, 403);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    const url = new URL(request.url, `http://${host}`);
    try {
      if (request.method === 'GET') {
        if (url.pathname === '/api/status') return json(response, jobs.snapshot());
        if (url.pathname === '/api/bootstrap') return json(response, { token, defaults, maxWorkers, root, version: VERSION });
        if (url.pathname === '/api/puzzles') return json(response, store.list().map(({ cells, initial, ...entry }) => ({ ...entry, intersections: cells.length, initialStoneCount: initial.white.toString(2).replaceAll('0', '').length })));
        const puzzleMatch = url.pathname.match(/^\/api\/puzzles\/(\d+)(?:\/(sgf|json))?$/);
        if (puzzleMatch) {
          const puzzle = store.load(Number(puzzleMatch[1]));
          if (puzzleMatch[2] === 'sgf') {
            response.writeHead(200, { 'Content-Type': 'application/x-go-sgf; charset=utf-8', 'Content-Disposition': `attachment; filename="gostone-puzzle-${puzzle.number}.sgf"` });
            return response.end(toSgf(puzzle));
          }
          if (puzzleMatch[2] === 'json') response.setHeader('Content-Disposition', `attachment; filename="gostone-puzzle-${puzzle.number}.json"`);
          return json(response, { ...puzzle, materialized: materialize(puzzle) });
        }
        if (url.pathname === '/api/export') {
          const selected = store.list().filter((entry) => entry.review === 'approved').map((entry) => store.load(entry.number));
          if (!selected.length) return json(response, { error: 'Zuerst mindestens eine Aufgabe im Lab freigeben.' }, 400);
          for (const puzzle of selected) verifyPuzzle(puzzle);
          const sgf = url.searchParams.get('format') === 'sgf';
          response.writeHead(200, { 'Content-Type': sgf ? 'application/x-go-sgf; charset=utf-8' : 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="gostone-lab-approved.${sgf ? 'sgf' : 'json'}"`, 'Cache-Control': 'no-store' });
          return response.end(sgf ? selected.map(toSgf).join('\n') : JSON.stringify({ schemaVersion: 'gostone.local-puzzle-bundle/1', exportedAt: new Date().toISOString(), rankStatus: 'estimated-uncalibrated', provenance: 'original-procedural-generation', puzzles: selected.map((puzzle) => ({ ...puzzle, materialized: materialize(puzzle) })) }, null, 2));
        }
        const files = { '/': ['static/index.html', 'text/html'], '/app.mjs': ['static/app.mjs', 'text/javascript'], '/styles.css': ['static/styles.css', 'text/css'], '/engine.mjs': ['engine.mjs', 'text/javascript'] };
        const file = files[url.pathname];
        if (!file) return json(response, { error: 'Nicht gefunden.' }, 404);
        response.writeHead(200, { 'Content-Type': `${file[1]}; charset=utf-8`, 'Cache-Control': 'no-store' });
        return response.end(readFileSync(join(directory, file[0])));
      }
      if (request.method !== 'POST') return json(response, { error: 'Methode nicht erlaubt.' }, 405);
      if (request.headers['x-lab-token'] !== token || (request.headers.origin && request.headers.origin !== `http://${host}`)) return json(response, { error: 'Lokaler Zugriff nicht bestätigt.' }, 403);
      if (!request.headers['content-type']?.startsWith('application/json')) return json(response, { error: 'JSON erforderlich.' }, 415);
      let body = '';
      for await (const chunk of request) { body += chunk; if (body.length > 8192) return json(response, { error: 'Anfrage zu groß.' }, 413); }
      const value = JSON.parse(body || '{}');
      if (url.pathname === '/api/shutdown') {
        json(response, { ok: true }); jobs.close(); server.close(); return;
      }
      if (url.pathname === '/api/start') return json(response, jobs.start(value));
      if (['/api/pause', '/api/resume', '/api/stop'].includes(url.pathname)) return json(response, jobs.control(url.pathname.slice(5)));
      if (url.pathname === '/api/review') {
        if (!Number.isInteger(value.number)) throw new Error('Ungültige Puzzle-Nummer.');
        return json(response, store.review(value.number, value.status));
      }
      if (url.pathname === '/api/try') {
        if (!Number.isInteger(value.number) || !Array.isArray(value.moves) || value.moves.length > 30 || value.moves.some((move) => !Number.isInteger(move))) throw new Error('Ungültige Zugfolge.');
        const puzzle = store.load(value.number), chamber = new Chamber(puzzle.cells);
        let state = puzzle.initial, color = BLACK, history = [positionKey(state)];
        for (const move of value.moves) {
          const next = chamber.play(state, color, move);
          if (!next || (move !== -1 && history.includes(positionKey(next)))) throw new Error('Illegaler Zug oder Stellungswiederholung.');
          state = next; color = 3 - color;
          if (move !== -1) history.push(positionKey(state));
        }
        try {
          const solver = new Solver(chamber, puzzle.target, { maxNodes: 1000000, maxMs: 2500 });
          const result = solver.solve(state, color, 17, history);
          if (!result.value) return json(response, { outcome: 'unknown', message: 'Diese Fortsetzung konnte im Prüfbudget nicht eindeutig bewertet werden.' });
          const proof = solver.tree(state, color, 17, history);
          return json(response, { outcome: result.value === 1 ? 'captured' : 'alive', proof });
        } catch (error) {
          if (error instanceof BudgetExceeded) return json(response, { outcome: 'unknown', message: 'Prüfbudget erreicht. Der Zug wird nicht als falsch gewertet.' });
          throw error;
        }
      }
      return json(response, { error: 'Nicht gefunden.' }, 404);
    } catch (error) { return json(response, { error: error.message }, 400); }
  });
  server.on('close', () => { jobs.close(); release(); });
  server.on('error', () => { jobs.close(); release(); });
  return { server, store, jobs };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const portIndex = args.indexOf('--port');
  const port = portIndex >= 0 ? Number(args[portIndex + 1]) : 4184;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Port muss zwischen 1024 und 65535 liegen.');
  const { server, jobs } = createLab({ port });
  server.on('error', (error) => { console.error(`Puzzle Lab: ${error.message}`); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}`;
    console.log(`GoStone Puzzle Lab: ${url}\nNur lokal · keine Modelle, Cloud-Dienste oder Datenbank erforderlich.\nDaten: ${jobs.store.root}`);
    if (!args.includes('--no-browser')) {
      const command = process.platform === 'win32' ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Start-Process '${url}'`]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
      const browser = spawn(command[0], command[1], { detached: true, stdio: 'ignore', windowsHide: true });
      browser.on('error', () => {}); browser.unref();
    }
  });
  const close = () => { jobs.close(); server.close(); };
  process.on('SIGINT', close); process.on('SIGTERM', close);
}
