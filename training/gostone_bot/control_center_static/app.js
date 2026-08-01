const $ = (selector) => document.querySelector(selector);
const phaseLabels = {
  idle: "Noch nicht gestartet",
  setup: "Vorbereitung",
  data: "KataGo erzeugt Lehrstellungen",
  training: "Student-Modell lernt",
  export: "ONNX-Export",
  validation: "Abschlussprüfung",
};
const statusLabels = {
  idle: "Bereit",
  starting: "Startet",
  running: "Läuft",
  paused: "Pausiert",
  stopping: "Stoppt sicher",
  stopped: "Gestoppt",
  completed: "Fertig",
  failed: "Fehler",
};
let presets = [];
let selectedPreset = "short";
let lastArtifact = "";
let arenaState = null;
let arenaBusy = false;
const arenaCanvas = $("#arena-board");
const arenaContext = arenaCanvas.getContext("2d");
const gtpColumns = "ABCDEFGHJKLMNOPQRST";

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    cache: "no-store",
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "Lokale Anfrage fehlgeschlagen.");
  return value;
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  window.setTimeout(() => element.classList.remove("show"), 2600);
}

function renderPresets() {
  const list = $("#preset-list");
  list.replaceChildren();
  for (const preset of presets) {
    const label = document.createElement("label");
    label.className = `preset${preset.id === selectedPreset ? " selected" : ""}`;
    label.innerHTML = `
      <input type="radio" name="preset" value="${preset.id}" ${preset.id === selectedPreset ? "checked" : ""}>
      <span><strong>${preset.name}</strong><p>${preset.description}</p></span>
      <span class="preset-meta"><span>${preset.estimated_duration}</span><small>${preset.quality}</small></span>`;
    label.querySelector("input").addEventListener("change", () => {
      selectedPreset = preset.id;
      renderPresets();
    });
    list.append(label);
  }
}

function formatNumber(value) {
  return new Intl.NumberFormat("de-DE").format(Number(value || 0));
}

function renderStatus(state) {
  const status = state.status || "idle";
  const progress = Math.max(0, Math.min(1, Number(state.overall_progress || 0)));
  const phaseProgress = Math.max(0, Math.min(1, Number(state.phase_progress || 0)));
  $("#status-title").textContent = state.preset_name || (status === "idle" ? "Bereit" : "Lokales Training");
  const badge = $("#status-badge");
  badge.className = `status-badge ${status}`;
  badge.textContent = statusLabels[status] || status;
  $("#progress-ring").style.setProperty("--progress", `${progress * 360}deg`);
  $("#progress-value").textContent = `${Math.round(progress * 100)}%`;
  $("#phase-name").textContent = phaseLabels[state.phase] || state.phase || phaseLabels.idle;
  $("#status-message").textContent = state.message || "Bereit.";
  $("#phase-bar").style.width = `${phaseProgress * 100}%`;
  $("#games-metric").textContent = `${formatNumber(state.completed_games)} / ${formatNumber(state.target_games)}`;
  $("#positions-metric").textContent = formatNumber(state.positions);
  $("#epochs-metric").textContent = `${formatNumber(state.completed_epochs)} / ${formatNumber(state.target_epochs)}`;
  $("#model-metric").textContent = state.artifact_bytes
    ? `${(state.artifact_bytes / 1024 / 1024).toFixed(2)} MiB`
    : "Noch offen";
  const active = ["starting", "running", "paused", "stopping"].includes(status);
  $("#start-button").disabled = active;
  $("#pause-button").disabled = !["starting", "running"].includes(status);
  $("#resume-button").disabled = !["paused", "stopped", "failed"].includes(status);
  $("#stop-button").disabled = !active;
  document.querySelectorAll(".preset input, #cpu-threads").forEach((input) => { input.disabled = active; });
  lastArtifact = state.artifact || "";
  $("#copy-path").disabled = !lastArtifact;
  $("#artifact-path").textContent = lastArtifact ? `Modell: ${lastArtifact}` : "";
}

function renderLogs(logs) {
  const output = $("#log-output");
  if (!logs.length) {
    output.innerHTML = '<p class="log-empty">Noch keine Einträge.</p>';
    return;
  }
  output.replaceChildren();
  for (const log of logs) {
    const line = document.createElement("p");
    line.className = `log-line ${log.level || "info"}`;
    const time = new Date(Number(log.time) * 1000).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const timeElement = document.createElement("time");
    timeElement.textContent = time;
    const message = document.createElement("span");
    message.textContent = log.message;
    line.append(timeElement, message);
    output.append(line);
  }
  output.scrollTop = output.scrollHeight;
}

async function refresh() {
  try {
    const [status, logs] = await Promise.all([api("/api/status"), api("/api/logs")]);
    renderStatus(status);
    renderLogs(logs);
  } catch (error) {
    $("#status-message").textContent = error.message;
  }
}

async function action(path, body = {}) {
  try {
    const result = await api(path, { method: "POST", body: JSON.stringify(body) });
    renderStatus(result);
    await refresh();
  } catch (error) {
    toast(error.message);
  }
}

$("#start-button").addEventListener("click", () => action("/api/start", {
  preset_id: selectedPreset,
  cpu_threads: Number($("#cpu-threads").value),
}));
$("#pause-button").addEventListener("click", () => action("/api/pause"));
$("#resume-button").addEventListener("click", () => action("/api/resume"));
$("#stop-button").addEventListener("click", () => action("/api/stop"));
$("#cpu-threads").addEventListener("input", (event) => { $("#cpu-output").value = event.target.value; });
$("#copy-path").addEventListener("click", async () => {
  if (!lastArtifact) return;
  await navigator.clipboard.writeText(lastArtifact);
  toast("Modellpfad kopiert.");
});

function switchView(view) {
  document.querySelectorAll(".lab-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === view));
  $("#training-view").hidden = view !== "training";
  $("#arena-view").hidden = view !== "arena";
  if (view === "arena") drawArenaBoard();
}

document.querySelectorAll(".lab-tab").forEach((tab) => {
  tab.addEventListener("click", () => switchView(tab.dataset.view));
});

async function loadArenaModels() {
  const select = $("#arena-model");
  const previous = select.value;
  const models = await api("/api/arena/models");
  select.replaceChildren();
  for (const model of models) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = `${model.label} · ${model.onnx_mib.toFixed(2)} MiB`;
    select.append(option);
  }
  if (models.some((model) => model.id === previous)) select.value = previous;
  $("#arena-start").disabled = models.length === 0;
  $("#arena-model-note").textContent = models.length
    ? `${models.length} fertige${models.length === 1 ? "s" : ""} Modell${models.length === 1 ? "" : "e"} gefunden.`
    : "Noch kein fertiges Modell. Warte, bis ein Trainingslauf vollständig abgeschlossen ist.";
}

function arenaGeometry(size) {
  const padding = 46;
  return { padding, spacing: (arenaCanvas.width - padding * 2) / (size - 1) };
}

function parseGtp(move, size) {
  if (!move || move.toLowerCase() === "pass") return null;
  const x = gtpColumns.indexOf(move[0].toUpperCase());
  const row = Number(move.slice(1));
  return x < 0 || !Number.isInteger(row) ? null : { x, y: size - row };
}

function starPoints(size) {
  if (size === 9) return [2, 4, 6].flatMap((x) => [2, 4, 6].map((y) => [x, y]));
  if (size === 13) return [3, 6, 9].flatMap((x) => [3, 6, 9].map((y) => [x, y]));
  return [3, 9, 15].flatMap((x) => [3, 9, 15].map((y) => [x, y]));
}

function drawArenaBoard() {
  const size = arenaState?.board_size || Number($("#arena-size").value) || 9;
  const board = arenaState?.board || Array.from({ length: size }, () => Array(size).fill(0));
  const { padding, spacing } = arenaGeometry(size);
  const ctx = arenaContext;
  ctx.clearRect(0, 0, arenaCanvas.width, arenaCanvas.height);
  const wood = ctx.createLinearGradient(0, 0, arenaCanvas.width, arenaCanvas.height);
  wood.addColorStop(0, "#e4bc63");
  wood.addColorStop(1, "#c9963e");
  ctx.fillStyle = wood;
  ctx.fillRect(0, 0, arenaCanvas.width, arenaCanvas.height);
  ctx.strokeStyle = "#49301b";
  ctx.lineWidth = Math.max(1.25, 4.2 - size * 0.13);
  for (let index = 0; index < size; index += 1) {
    const position = padding + index * spacing;
    ctx.beginPath(); ctx.moveTo(padding, position); ctx.lineTo(arenaCanvas.width - padding, position); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(position, padding); ctx.lineTo(position, arenaCanvas.height - padding); ctx.stroke();
  }
  ctx.fillStyle = "#49301b";
  for (const [x, y] of starPoints(size)) {
    ctx.beginPath(); ctx.arc(padding + x * spacing, padding + y * spacing, Math.max(4, spacing * .085), 0, Math.PI * 2); ctx.fill();
  }
  const last = parseGtp(arenaState?.last_move, size);
  const dead = new Set((arenaState?.proposal?.dead_stones || []).map(([x, y]) => `${x}:${y}`));
  const uncertain = new Set((arenaState?.proposal?.uncertain_stones || []).map(([x, y]) => `${x}:${y}`));
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const color = board[y][x];
      if (!color) continue;
      const cx = padding + x * spacing;
      const cy = padding + y * spacing;
      const radius = spacing * .47;
      const stone = ctx.createRadialGradient(cx - radius * .3, cy - radius * .35, radius * .08, cx, cy, radius);
      if (color === 1) { stone.addColorStop(0, "#565656"); stone.addColorStop(.45, "#171717"); stone.addColorStop(1, "#020202"); }
      else { stone.addColorStop(0, "#ffffff"); stone.addColorStop(.62, "#ededE8"); stone.addColorStop(1, "#b8b8b1"); }
      ctx.fillStyle = stone; ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = color === 1 ? "#000" : "#aaa"; ctx.lineWidth = 1.5; ctx.stroke();
      if (last?.x === x && last?.y === y) {
        ctx.fillStyle = color === 1 ? "#dfe1d8" : "#222"; ctx.beginPath(); ctx.arc(cx, cy, radius * .18, 0, Math.PI * 2); ctx.fill();
      }
      const key = `${x}:${y}`;
      if (dead.has(key) || uncertain.has(key)) {
        ctx.strokeStyle = dead.has(key) ? "#e25f50" : "#f0bd52"; ctx.lineWidth = Math.max(4, spacing * .08);
        ctx.beginPath(); ctx.arc(cx, cy, radius * .72, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }
}

function humanTurn(state) {
  return state && state.to_move === state.human_color && !state.finished;
}

function renderArena(state) {
  arenaState = state;
  drawArenaBoard();
  const human = state.human_color === "black" ? "Schwarz" : "Weiß";
  const turn = state.to_move === "black" ? "Schwarz" : "Weiß";
  $("#arena-title").textContent = `${state.board_size}×${state.board_size} · Du spielst ${human}`;
  const badge = $("#arena-turn");
  badge.className = `status-badge ${state.finished ? "completed" : "running"}`;
  badge.textContent = state.finished ? "Beendet" : humanTurn(state) ? "Dein Zug" : "Bot am Zug";
  $("#arena-move").textContent = `Zug ${state.move_number} · ${turn} am Zug`;
  $("#arena-prisoners").textContent = `Gefangene: Schwarz ${state.black_prisoners} · Weiß ${state.white_prisoners}`;
  $("#arena-pass").disabled = arenaBusy || !humanTurn(state);
  $("#arena-reset").disabled = false;
  $("#arena-message").textContent = state.finished
    ? "Zwei aufeinanderfolgende Pässe: Der Modellvorschlag ist eingeblendet."
    : state.bot_move ? `Der Bot spielte ${state.bot_move}. Du bist am Zug.` : "Klicke auf einen freien Schnittpunkt.";
  const result = $("#arena-result");
  result.hidden = !state.proposal;
  if (state.proposal) {
    const score = state.proposal.score;
    const winner = score.winner === "black" ? "Schwarz" : score.winner === "white" ? "Weiß" : "Jigo";
    $("#result-title").textContent = winner === "Jigo" ? "Unentschieden" : `${winner} gewinnt`;
    $("#result-summary").textContent = winner === "Jigo" ? "Vorgeschlagener Gleichstand" : `Vorgeschlagener Vorsprung: ${score.margin.toFixed(1)} Punkte`;
    $("#result-black").textContent = `${score.black_total.toFixed(1)} (${score.black_territory} Gebiet + ${score.black_prisoners} Gefangene)`;
    $("#result-white").textContent = `${score.white_total.toFixed(1)} (${score.white_territory} Gebiet + ${score.white_prisoners} Gefangene + 6,5 Komi)`;
    $("#result-dead").textContent = String(state.proposal.dead_stones.length);
    $("#result-uncertain").textContent = String(state.proposal.uncertain_stones.length);
  }
}

function setArenaBusy(busy) {
  arenaBusy = busy;
  $("#arena-busy").hidden = !busy;
  $("#arena-start").disabled = busy || !$("#arena-model").value;
  $("#arena-pass").disabled = busy || !humanTurn(arenaState);
}

async function arenaRequest(payload) {
  setArenaBusy(true);
  try {
    renderArena(await api("/api/arena/move", { method: "POST", body: JSON.stringify(payload) }));
  } catch (error) {
    toast(error.message);
  } finally {
    setArenaBusy(false);
  }
}

arenaCanvas.addEventListener("click", (event) => {
  if (arenaBusy || !humanTurn(arenaState)) return;
  const rect = arenaCanvas.getBoundingClientRect();
  const scaleX = arenaCanvas.width / rect.width;
  const scaleY = arenaCanvas.height / rect.height;
  const { padding, spacing } = arenaGeometry(arenaState.board_size);
  const x = Math.round(((event.clientX - rect.left) * scaleX - padding) / spacing);
  const y = Math.round(((event.clientY - rect.top) * scaleY - padding) / spacing);
  if (x < 0 || y < 0 || x >= arenaState.board_size || y >= arenaState.board_size) return;
  arenaRequest({ session_id: arenaState.session_id, x, y });
});

$("#arena-start").addEventListener("click", async () => {
  setArenaBusy(true);
  try {
    const state = await api("/api/arena/start", {
      method: "POST",
      body: JSON.stringify({
        model_id: $("#arena-model").value,
        board_size: Number($("#arena-size").value),
        elo: Number($("#arena-elo").value),
        human_color: $("#arena-color").value,
      }),
    });
    renderArena(state);
  } catch (error) {
    toast(error.message);
  } finally {
    setArenaBusy(false);
  }
});
$("#arena-pass").addEventListener("click", () => arenaRequest({ session_id: arenaState.session_id, pass: true }));
$("#arena-reset").addEventListener("click", () => {
  arenaState = null;
  $("#arena-result").hidden = true;
  $("#arena-pass").disabled = true;
  $("#arena-reset").disabled = true;
  $("#arena-title").textContent = "Noch nicht gestartet";
  $("#arena-turn").textContent = "Bereit";
  $("#arena-turn").className = "status-badge idle";
  $("#arena-message").textContent = "Wähle ein Modell und starte eine neue Testpartie.";
  drawArenaBoard();
});
$("#refresh-models").addEventListener("click", () => loadArenaModels().catch((error) => toast(error.message)));
$("#arena-size").addEventListener("change", () => { if (!arenaState) drawArenaBoard(); });

async function initialize() {
  [presets] = await Promise.all([api("/api/presets"), loadArenaModels()]);
  renderPresets();
  drawArenaBoard();
  await refresh();
  window.setInterval(refresh, 1500);
}

initialize().catch((error) => toast(error.message));
