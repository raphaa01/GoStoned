import { Chamber, BLACK, WHITE, bit, positionKey, indices, bestDefense } from '/engine.mjs';

const $ = (id) => document.getElementById(id);
const ns = 'http://www.w3.org/2000/svg';
const svgElement = (name, attributes) => { const node = document.createElementNS(ns, name); for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value); return node; };
let token, catalog = [], selected = null, chamber, boardState, currentTree, moves = [], history = [], replayLine = [], replayIndex = 0, lastMove = null, busy = false, playable = true, polling = false, closed = false, delayedFailure = false;
const attackerName = () => selected.toPlay === 'W' ? 'Weiß' : 'Schwarz';
const defenderName = () => selected.toPlay === 'W' ? 'Schwarz' : 'Weiß';
const displayedColor = (role) => selected.toPlay === 'W' ? 3 - role : role;
const statuses = { idle: 'Bereit', running: 'Sucht & prüft', pausing: 'Pausiert gleich', paused: 'Pausiert', stopping: 'Stoppt gleich', stopped: 'Gestoppt', completed: 'Abgeschlossen', exhausted: 'Limit erreicht', failed: 'Fehler' };
const reviews = { pending: 'Noch zu prüfen', approved: 'Freigegeben', rejected: 'Aussortiert' };
const reasons = { 'invalid-shape': 'Ungeeignete Stellung', alive: 'Bereits lebend', depth: 'Andere Zugzahl', unresolved: 'Nicht eindeutig', budget: 'Prüfbudget', ambiguous: 'Mehrere Lösungen', cleanup: 'Nur Auffüllen / Passen', 'pass-inflated-depth': 'Künstliche Zugtiefe', 'forced-cleanup': 'Zu wenig Entscheidungen', 'known-motif': 'Bekanntes Motiv', 'seen-candidate': 'Schon geprüft', quality: 'Zu wenig Fehlerwege', duplicate: 'Doppelt', 'same-motif': 'Gleiches Motiv', 'same-continuation': 'Gleiche Kernaufgabe', 'same-solution-pattern': 'Gleiches Zugmuster', 'similar-solution-pattern': 'Zu ähnliches Zugmuster', 'near-duplicate': 'Zu ähnlich', rank: 'Anderer Rang', error: 'Fehler' };

async function api(path, body) {
  const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Lab-Token': token }, body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? 'Anfrage fehlgeschlagen.');
  return value;
}
function error(message) { $('error').textContent = message; $('error').hidden = !message; }
function renderStatus(status) {
  $('run-status').textContent = statuses[status.status] ?? status.status;
  $('run-message').textContent = status.message ?? 'Bereit für neue Stellungen.';
  $('accepted').textContent = status.accepted ?? 0;
  $('attempts').textContent = (status.attempts ?? 0).toLocaleString('de');
  const seconds = Math.floor((status.elapsedMs ?? 0) / 1000);
  $('elapsed').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  $('progress').max = status.config?.count ?? 20; $('progress').value = status.accepted ?? 0;
  const active = ['running', 'pausing', 'paused', 'stopping'].includes(status.status);
  $('start').disabled = active;
  $('pause').disabled = status.status !== 'running'; $('resume').disabled = status.status !== 'paused'; $('stop').disabled = !['running', 'pausing', 'paused'].includes(status.status);
  $('rejections').replaceChildren(...Object.entries(status.reasons ?? {}).map(([reason, count]) => { const span = document.createElement('span'); span.textContent = `${reasons[reason] ?? reason} ${count}`; return span; }));
}
function renderCatalog() {
  $('catalog-count').textContent = `${catalog.length} · ${catalog.filter((p) => p.review === 'approved').length} freigegeben`;
  const filtered = catalog.filter((p) => ($('review-filter').value === 'all' || p.review === $('review-filter').value) && ($('moves-filter').value === 'all' || p.ownMoves === Number($('moves-filter').value)));
  if (!filtered.length) { const text = document.createElement('p'); text.className = 'muted'; text.textContent = catalog.length ? 'Keine Aufgaben für diesen Filter.' : 'Noch keine Aufgaben vorhanden.'; $('catalog-list').replaceChildren(text); return; }
  $('catalog-list').replaceChildren(...filtered.slice().reverse().map((p) => {
    const button = document.createElement('button'); button.className = `catalog-item${selected?.number === p.number ? ' selected' : ''}`;
    const title = document.createElement('strong'); title.textContent = `Puzzle ${p.number}`;
    const info = document.createElement('span'); info.textContent = `${p.kyu} Kyu ≈ · ${p.ownMoves} eigene Züge · ${p.toPlay === 'W' ? 'Weiß' : 'Schwarz'}`;
    const review = document.createElement('span'); review.className = p.review; review.textContent = reviews[p.review];
    button.append(title, info, review); button.addEventListener('click', () => select(p.number).catch((e) => error(e.message))); return button;
  }));
}
async function select(number) {
  if (busy) return;
  selected = await api(`/api/puzzles/${number}`); chamber = new Chamber(selected.cells);
  $('empty-state').hidden = true; $('puzzle-view').hidden = false;
  $('puzzle-title').textContent = `Puzzle ${number}`; $('puzzle-rank').textContent = `≈ ${selected.difficulty.kyu} Kyu`;
  $('goal').textContent = `${attackerName()} beginnt: Fange die markierte ${selected.toPlay === 'W' ? 'schwarze' : 'weiße'} Gruppe. Die längste geprüfte Verteidigung benötigt ${selected.ownMoves} eigene Züge.`;
  $('category').textContent = selected.category;
  $('proof-stats').textContent = `${selected.verification.proofNodes} Beweisknoten · ${selected.wrongPaths.length} widerlegte erste Züge`;
  $('rank-explanation').textContent = `${selected.difficulty.factors.ownMoves} eigene Züge, ${selected.difficulty.factors.defensiveBranches} zusätzliche Verteidigungszweige, ${selected.difficulty.factors.sacrifices} Opferzüge. Einstufung: unkalibriert.`;
  $('single-sgf').href = `/api/puzzles/${number}/sgf`; $('single-json').href = `/api/puzzles/${number}/json`;
  $('variation').replaceChildren(...[{ value: 'solution', label: 'Geprüfte Lösung' }, ...selected.alternatives.map((wrong, i) => ({ value: String(i), label: `Fehlerweg ${i + 1}: ${coordinate(wrong.firstMove)} · ${wrong.line.length} Züge` }))].map(({ value, label }) => { const option = document.createElement('option'); option.value = value; option.textContent = label; return option; }));
  reset(); renderCatalog(); renderReview();
}
function coordinate(move) {
  if (move === -1) return 'Pass';
  const [x, y] = selected.cells[move];
  return `${'ABCDEFGHJKLMNOPQRST'[x + 2]}${selected.materialized.size - y - 2}`;
}
function reset() {
  boardState = { ...selected.initial }; currentTree = selected.proof; moves = []; history = [positionKey(boardState)]; lastMove = null; replayLine = []; replayIndex = 0; playable = true; delayedFailure = false;
  $('feedback').textContent = `${attackerName()} beginnt. Wähle deinen Zug im markierten Bereich.`;
  $('variation').value = 'solution';
  $('next-ply').disabled = true; $('previous-ply').disabled = true;
  renderBoard();
}
function renderBoard() {
  const { size, board, target } = selected.materialized;
  const displayed = board.map((row) => [...row]);
  for (let i = 0; i < selected.cells.length; i++) {
    const [x, y] = selected.cells[i]; displayed[y + 2][x + 2] = boardState.black & bit(i) ? displayedColor(BLACK) : boardState.white & bit(i) ? displayedColor(WHITE) : 0;
  }
  const svg = svgElement('svg', { viewBox: `0 0 ${size * 40 + 40} ${size * 40 + 40}`, 'aria-label': 'Go-Brett mit markierter Zielgruppe' });
  const spacing = 40, margin = 40;
  for (const [x, y] of selected.cells) svg.append(svgElement('rect', { x: margin + (x + 2) * spacing - 20, y: margin + (y + 2) * spacing - 20, width: 40, height: 40, fill: '#efce935a' }));
  for (let i = 0; i < size; i++) {
    svg.append(svgElement('line', { x1: margin, y1: margin + i * spacing, x2: margin + (size - 1) * spacing, y2: margin + i * spacing, stroke: '#6d5737', 'stroke-width': 1 }));
    svg.append(svgElement('line', { x1: margin + i * spacing, y1: margin, x2: margin + i * spacing, y2: margin + (size - 1) * spacing, stroke: '#6d5737', 'stroke-width': 1 }));
    const xText = svgElement('text', { x: margin + i * spacing, y: margin - 23, fill: '#54452f', 'font-size': 11, 'text-anchor': 'middle' }); xText.textContent = 'ABCDEFGHJKLMNOPQRST'[i]; svg.append(xText);
    const yText = svgElement('text', { x: margin - 24, y: margin + i * spacing + 4, fill: '#54452f', 'font-size': 11, 'text-anchor': 'middle' }); yText.textContent = size - i; svg.append(yText);
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (!displayed[y][x]) continue;
    const dark = displayed[y][x] === BLACK;
    svg.append(svgElement('circle', { cx: margin + x * spacing + 1, cy: margin + y * spacing + 2, r: 17, fill: '#4b3a253d' }));
    svg.append(svgElement('circle', { cx: margin + x * spacing, cy: margin + y * spacing, r: 17, fill: dark ? '#18201e' : '#f4f3e7', stroke: dark ? '#101512' : '#d0cbb7', 'stroke-width': 1.3 }));
    if (x === target[0] && y === target[1] && displayed[y][x] === displayedColor(WHITE)) svg.append(svgElement('rect', { x: margin + x * spacing - 5, y: margin + y * spacing - 5, width: 10, height: 10, fill: 'none', stroke: '#548b44', 'stroke-width': 2 }));
  }
  if (lastMove !== null && lastMove >= 0) { const [x, y] = selected.cells[lastMove]; svg.append(svgElement('circle', { cx: margin + (x + 2) * spacing, cy: margin + (y + 2) * spacing, r: 4, fill: '#c7ec8e', stroke: '#37512c' })); }
  for (const i of indices((chamber.mask & ~(boardState.black | boardState.white)) >>> 0)) {
    const [x, y] = selected.cells[i];
    const hit = svgElement('circle', { cx: margin + (x + 2) * spacing, cy: margin + (y + 2) * spacing, r: 19, class: 'intersection', role: 'button', tabindex: busy || !playable || replayLine.length || currentTree?.outcome ? -1 : 0, 'aria-label': `${attackerName()} auf ${coordinate(i)}` });
    hit.addEventListener('click', () => play(i)); hit.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void play(i); } }); svg.append(hit);
  }
  $('board').replaceChildren(svg);
}
function advance(move, color) {
  const next = chamber.play(boardState, color, move);
  if (!next || (move !== -1 && history.includes(positionKey(next)))) throw new Error('Dieser Zug ist nicht legal.');
  boardState = next; moves.push(move); lastMove = move;
  if (move !== -1) history.push(positionKey(next));
}
async function play(move) {
  if (!selected || busy || !playable || replayLine.length || currentTree?.outcome) return;
  const legal = chamber.play(boardState, BLACK, move);
  if (!legal || history.includes(positionKey(legal))) { $('feedback').textContent = 'Dieser Zug ist nicht legal.'; return; }
  busy = true;
  try {
    const choice = currentTree?.branches?.find((branch) => branch.move === move);
    const wrong = moves.length === 0 ? selected.wrongPaths.find((path) => path.firstMove === move) : null;
    advance(move, BLACK);
    if (choice) currentTree = choice.next;
    else if (wrong) {
      currentTree = wrong.proof;
      delayedFailure = selected.alternatives.some((path) => path.firstMove === move);
      if (!delayedFailure) {
        const reply = bestDefense(currentTree);
        if (reply) { advance(reply.move, WHITE); currentTree = reply.next; }
        finishFailure(); return;
      }
    }
    else {
      $('feedback').textContent = 'Deine andere Fortsetzung wird lokal geprüft …'; renderBoard();
      const result = await api('/api/try', { number: selected.number, moves });
      if (result.outcome === 'unknown') { $('feedback').textContent = result.message; currentTree = null; playable = false; return; }
      currentTree = result.proof;
      if (result.outcome === 'alive') {
        const reply = bestDefense(currentTree);
        if (reply) { advance(reply.move, WHITE); currentTree = reply.next; }
        finishFailure(); return;
      }
    }
    if (currentTree.outcome === 'captured') { $('feedback').textContent = `Richtig gelöst! ${Math.ceil(moves.length / 2)} eigene Züge.`; playable = false; return; }
    if (delayedFailure && currentTree.outcome === 'alive') { finishFailure(); return; }
    if (currentTree.color === WHITE) {
      const reply = bestDefense(currentTree);
      advance(reply.move, WHITE); currentTree = reply.next;
      if (delayedFailure && (currentTree.outcome === 'alive' || moves.length >= 4)) { finishFailure(); return; }
      $('feedback').textContent = `${defenderName()} antwortet ${coordinate(reply.move)}. ${attackerName()} ist wieder am Zug (${Math.floor(moves.length / 2)} eigene Züge gespielt).`;
    }
  } catch (e) { error(e.message); playable = false; } finally { busy = false; renderBoard(); }
}
function finishFailure() {
  $('feedback').textContent = `Falsch – nach ${moves.length} Zügen widerlegt. ${defenderName()} ${currentTree?.outcome === 'alive' ? 'hat zwei sichere Augen.' : 'kann gegen jede Fortsetzung zwei sichere Augen erzwingen.'} Wähle „Neu versuchen“ oder einen Fehlerweg.`;
  playable = false;
}
function replay() {
  boardState = { ...selected.initial }; history = [positionKey(boardState)]; moves = []; lastMove = null;
  for (const ply of replayLine.slice(0, replayIndex)) advance(ply.move, ply.color);
  $('previous-ply').disabled = replayIndex === 0; $('next-ply').disabled = replayIndex >= replayLine.length;
  const wrong = $('variation').value !== 'solution';
  $('feedback').textContent = `${wrong ? 'Geprüfter Fehlerweg' : 'Geprüfte Lösung'} · Zug ${replayIndex} von ${replayLine.length}${replayIndex === replayLine.length ? wrong ? `\nFalsch – ${selected.alternatives[Number($('variation').value)].endpoint.reason}` : '\nDie markierte Gruppe ist gefangen.' : ''}`;
  renderBoard();
}
function showVariation() {
  if (!selected || busy) return;
  replayLine = $('variation').value === 'solution' ? selected.solution : selected.alternatives[Number($('variation').value)].line;
  replayIndex = 0; replay();
}
function renderReview() {
  $('approve').disabled = selected?.review === 'approved'; $('reject').disabled = selected?.review === 'rejected'; $('pending').disabled = selected?.review === 'pending';
}
for (const [id, status] of [['approve', 'approved'], ['reject', 'rejected'], ['pending', 'pending']]) $(id).addEventListener('click', async () => {
  try { await api('/api/review', { number: selected.number, status }); selected.review = status; catalog = await api('/api/puzzles'); renderReview(); renderCatalog(); } catch (e) { error(e.message); }
});
$('settings').addEventListener('submit', async (event) => { event.preventDefault(); error(''); const config = Object.fromEntries([...new FormData(event.currentTarget)].map(([key, value]) => [key, Number(value)])); try { renderStatus(await api('/api/start', config)); } catch (e) { error(e.message); } });
for (const action of ['pause', 'resume', 'stop']) $(action).addEventListener('click', async () => { try { error(''); renderStatus(await api(`/api/${action}`, {})); } catch (e) { error(e.message); } });
$('reset').addEventListener('click', () => { if (!busy) reset(); });
$('solution').addEventListener('click', () => { $('variation').value = 'solution'; showVariation(); });
$('variation').addEventListener('change', showVariation);
$('previous-ply').addEventListener('click', () => { replayIndex = Math.max(0, replayIndex - 1); replay(); });
$('next-ply').addEventListener('click', () => { replayIndex = Math.min(replayLine.length, replayIndex + 1); replay(); });
for (const id of ['review-filter', 'moves-filter']) $(id).addEventListener('change', renderCatalog);

async function poll() {
  if (polling || closed) return;
  polling = true;
  try {
    const status = await api('/api/status');
    if (closed) return;
    renderStatus(status);
    const next = await api('/api/puzzles');
    if (closed) return;
    if (JSON.stringify(next) !== JSON.stringify(catalog)) {
      catalog = next; renderCatalog();
      const first = catalog.find((p) => p.review !== 'rejected');
      if (!selected && first) await select(first.number);
    }
  } catch (e) { if (!closed) error(`Lab nicht erreichbar: ${e.message}`); } finally { polling = false; }
}
$('shutdown').addEventListener('click', async () => {
  try {
    await api('/api/shutdown', {}); closed = true; playable = false;
    renderStatus({ status: 'paused', message: 'Lab geschlossen. Der Lauf wurde gespeichert. Über die Startverknüpfung wieder öffnen.' });
    for (const id of ['start', 'pause', 'resume', 'stop', 'shutdown']) $(id).disabled = true;
  } catch (e) { error(e.message); }
});
try {
  const bootstrap = await api('/api/bootstrap'); token = bootstrap.token;
  $('data-path').textContent = `Speicherort: ${bootstrap.root}`;
  $('worker-count').replaceChildren(...Array.from({ length: bootstrap.maxWorkers }, (_, i) => { const option = document.createElement('option'); option.value = i + 1; option.textContent = `${i + 1} ${i === 0 ? 'Worker' : 'Worker'}`; option.selected = i + 1 === bootstrap.defaults.workers; return option; }));
  await poll(); setInterval(poll, 1500);
  const status = await api('/api/status');
  if (status.config) for (const [name, value] of Object.entries(status.config)) { const input = $('settings').elements.namedItem(name); if (input) input.value = value; }
} catch (e) { error(e.message); }
