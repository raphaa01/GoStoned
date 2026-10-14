import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

// Read-only visual evidence from the real lab UI, rather than a second board
// renderer. Play correct and incorrect sequences and capture their endpoints.
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback;
const url = new URL(option('url', 'http://127.0.0.1:4184'));
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.protocol !== 'http:') throw new Error('Visual review requires a local lab.');
const output = resolve(option('output', '.cache/puzzle-lab-visual'));
const count = Number(option('count', '12'));
if (!Number.isInteger(count) || count < 1 || count > 40) throw new Error('Review 1–40 tasks at a time.');
const catalog = await (await fetch(new URL('/api/puzzles', url))).json();
const numbers = option('numbers', null)?.split(',').map(Number) ?? catalog.filter((p) => p.review !== 'rejected').slice(-count).map((p) => p.number);
if (!numbers.length || numbers.length > 40 || numbers.some((n) => !Number.isInteger(n) || n < 1)) throw new Error('Select 1–40 valid puzzle numbers.');
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [], cards = [], errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url.href); await page.locator('#puzzle-view').waitFor({ state: 'visible' });
  for (const number of numbers) {
    if ((await page.locator('#puzzle-title').textContent()) !== `Puzzle ${number}`) {
      await page.getByRole('button', { name: new RegExp(`^Puzzle ${number} `) }).click();
      await page.waitForFunction((n) => document.getElementById('puzzle-title').textContent === `Puzzle ${n}`, number);
    }
    const p = await (await fetch(new URL(`/api/puzzles/${number}`, url))).json();
    const coordinate = (m) => { const [x, y] = p.startingPosition.playablePoints[m]; return `${'ABCDEFGHJKLMNOPQRST'[x]}${p.startingPosition.size - y}`; };
    const ownMove = (m) => page.getByRole('button', { name: `${p.toPlay === 'W' ? 'Weiß' : 'Schwarz'} auf ${coordinate(m)}`, exact: true }).click();
    await page.locator('#board svg').screenshot({ path: join(output, `puzzle-${number}-start.png`) });
    const start = await page.locator('#board svg').evaluate((svg) => svg.outerHTML);
    let resistance;
    for (const [i, ply] of p.solution.filter((ply) => ply.color === 1).entries()) {
      await ownMove(ply.move);
      if (i === 0) {
        resistance = await page.locator('#board svg').evaluate((svg) => svg.outerHTML);
        await page.locator('#board svg').screenshot({ path: join(output, `puzzle-${number}-resistance.png`) });
      }
    }
    const solved = (await page.locator('#feedback').textContent()).includes('Richtig gelöst!');
    if (!solved) throw new Error(`Solution did not solve puzzle ${number}.`);
    await page.locator('#board svg').screenshot({ path: join(output, `puzzle-${number}-solved.png`) });
    const failed = [];
    for (const [i, alternative] of p.alternatives.entries()) {
      await page.getByRole('button', { name: 'Neu versuchen', exact: true }).click();
      for (const ply of alternative.line.filter((ply) => ply.color === 1)) {
        if (ply.move < 0) throw new Error(`Error path in puzzle ${number} requires an unplayable pass.`);
        await ownMove(ply.move);
      }
      const feedback = await page.locator('#feedback').textContent();
      if (!feedback.startsWith('Falsch')) throw new Error(`Error path ${i + 1} in puzzle ${number} was not refuted.`);
      await page.locator('#board svg').screenshot({ path: join(output, `puzzle-${number}-error-${i + 1}.png`) });
      failed.push({ plies: alternative.line.length, feedback, svg: await page.locator('#board svg').evaluate((svg) => svg.outerHTML) });
    }
    results.push({ number, toPlay: p.toPlay, kyu: p.kyu, ownMoves: p.ownMoves, category: p.category, layout: p.layout, presentation: p.presentationQuality, solved, errors: failed.map(({ plies, feedback }) => ({ plies, feedback })) });
    cards.push(`<article><h2>Puzzle ${number} · ${p.toPlay === 'W' ? 'Weiß' : 'Schwarz'} · ≈ ${p.kyu} Kyu</h2><p>${p.layout?.kind === 'edge' ? 'Rand' : 'Ecke'} · ${p.presentationQuality?.totalStones ?? '?'} Steine insgesamt · ${p.ownMoves} eigene Züge</p><div class="states"><section><h3>Startstellung</h3>${start}</section><section><h3>Erste Gegenwehr</h3>${resistance}</section><section><h3>Widerlegung</h3>${failed[0].svg}</section></div></article>`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  const html = `<!doctype html><html lang="de"><meta charset="utf-8"><style>body{background:#10231f;color:#eef3e9;font:15px Arial;padding:24px}h1{font-size:24px}main{display:grid;grid-template-columns:1fr 1fr;gap:18px}article{background:#1b302a;padding:12px;border-radius:10px}h2{font-size:18px}h3,p{font-size:12px;color:#bad0c1}.states{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}svg{width:100%;background:#dfbd7e;border-radius:7px}svg text{font-family:Arial}</style><h1>Visuelle Prüfung aus dem echten Puzzle Lab</h1><p>Startstellungen, tatsächlich gespielte gegnerische Antworten und Fehler-Endstellungen. Die Lösung wurde im Browser bis zum Fang ausgespielt.</p><main>${cards.join('')}</main></html>`;
  writeFileSync(join(output, 'contact-sheet.html'), html);
  const sheet = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
  await sheet.setContent(html); await sheet.screenshot({ path: join(output, 'contact-sheet.png'), fullPage: true });
  writeFileSync(join(output, 'report.json'), JSON.stringify({ capturedAt: new Date().toISOString(), results, errors }, null, 2));
  console.log(`${numbers.length} Aufgaben visuell dokumentiert und im Browser ausgespielt: ${output}/contact-sheet.png`);
} finally { await browser.close(); }
