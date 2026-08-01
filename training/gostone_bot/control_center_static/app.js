const $ = (selector) => document.querySelector(selector);
const phaseLabels = {
  idle: "Not started",
  setup: "Preparing",
  data: "KataGo generates teaching positions",
  training: "Student AI is learning",
  export: "ONNX export",
  validation: "Final validation",
};
const statusLabels = {
  idle: "Ready",
  starting: "Starting",
  running: "Running",
  paused: "Paused",
  stopping: "Stopping safely",
  stopped: "Stopped",
  completed: "Completed",
  failed: "Failed",
};
let presets = [];
let selectedPreset = "short";
let lastArtifact = "";
let arenaState = null;
let arenaBusy = false;
let arenaMode = "human";
let arenaModels = [];
let matchTimer = null;
let matchPlaying = false;
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
  if (!response.ok) throw new Error(value.error || "Local request failed.");
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
  return new Intl.NumberFormat("en-US").format(Number(value || 0));
}

function renderStatus(state) {
  const status = state.status || "idle";
  const progress = Math.max(0, Math.min(1, Number(state.overall_progress || 0)));
  const phaseProgress = Math.max(0, Math.min(1, Number(state.phase_progress || 0)));
  $("#status-title").textContent = state.preset_name || (status === "idle" ? "Ready" : "Local training");
  const badge = $("#status-badge");
  badge.className = `status-badge ${status}`;
  badge.textContent = statusLabels[status] || status;
  $("#progress-ring").style.setProperty("--progress", `${progress * 360}deg`);
  $("#progress-value").textContent = `${Math.round(progress * 100)}%`;
  $("#phase-name").textContent = phaseLabels[state.phase] || state.phase || phaseLabels.idle;
  $("#status-message").textContent = state.message || "Ready.";
  $("#phase-bar").style.width = `${phaseProgress * 100}%`;
  $("#games-metric").textContent = `${formatNumber(state.completed_games)} / ${formatNumber(state.target_games)}`;
  $("#positions-metric").textContent = formatNumber(state.positions);
  $("#epochs-metric").textContent = `${formatNumber(state.completed_epochs)} / ${formatNumber(state.target_epochs)}`;
  $("#model-metric").textContent = state.artifact_bytes
    ? `${(state.artifact_bytes / 1024 / 1024).toFixed(2)} MiB`
    : "Pending";
  const active = ["starting", "running", "paused", "stopping"].includes(status);
  $("#start-button").disabled = active;
  $("#pause-button").disabled = !["starting", "running"].includes(status);
  $("#resume-button").disabled = !["paused", "stopped", "failed"].includes(status);
  $("#stop-button").disabled = !active;
  document.querySelectorAll(".preset input, #cpu-threads").forEach((input) => { input.disabled = active; });
  lastArtifact = state.artifact || "";
  $("#copy-path").disabled = !lastArtifact;
  $("#artifact-path").textContent = lastArtifact ? `Model: ${lastArtifact}` : "";
}

function renderLogs(logs) {
  const output = $("#log-output");
  if (!logs.length) {
    output.innerHTML = '<p class="log-empty">No entries yet.</p>';
    return;
  }
  output.replaceChildren();
  for (const log of logs) {
    const line = document.createElement("p");
    line.className = `log-line ${log.level || "info"}`;
    const time = new Date(Number(log.time) * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
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
  toast("Model path copied.");
});

function switchView(view) {
  if (view !== "arena" && matchPlaying) {
    matchPlaying = false;
    clearMatchTimer();
    if (arenaState?.mode === "model_match") renderArena(arenaState);
  }
  document.querySelectorAll(".lab-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === view));
  $("#training-view").hidden = view !== "training";
  $("#arena-view").hidden = view !== "arena";
  document.body.classList.toggle("arena-view-active", view === "arena");
  if (view === "arena") drawArenaBoard();
}

document.querySelectorAll(".lab-tab").forEach((tab) => {
  tab.addEventListener("click", () => switchView(tab.dataset.view));
});

async function loadArenaModels() {
  const selects = [$("#arena-model"), $("#arena-black-model"), $("#arena-white-model")];
  const previous = selects.map((select) => select.value);
  arenaModels = await api("/api/arena/models");
  selects.forEach((select, selectIndex) => {
    select.replaceChildren();
    for (const model of arenaModels) {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = `${model.label} · ${model.onnx_mib.toFixed(2)} MiB`;
      select.append(option);
    }
    if (arenaModels.some((model) => model.id === previous[selectIndex])) {
      select.value = previous[selectIndex];
    }
  });
  if (!previous[2] && arenaModels.length > 1) $("#arena-white-model").selectedIndex = 1;
  syncSettlementEvaluatorLabels();
  $("#arena-start").disabled = arenaModels.length === 0;
  $("#arena-model-note").textContent = arenaModels.length
    ? `${arenaModels.length} completed AI model${arenaModels.length === 1 ? "" : "s"} found. The same version may play both colors for a control run.`
    : "No completed AI model yet. Wait for a training run to finish and export successfully.";
}

function modelLabel(modelId) {
  return arenaModels.find((model) => model.id === modelId)?.label || "Unassigned AI";
}

function syncSettlementEvaluatorLabels() {
  const evaluator = $("#arena-settlement-evaluator");
  if (!evaluator) return;
  const selected = evaluator.value || "black";
  evaluator.options[0].textContent = `Black AI · ${modelLabel($("#arena-black-model").value)}`;
  evaluator.options[1].textContent = `White AI · ${modelLabel($("#arena-white-model").value)}`;
  evaluator.value = selected;
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
  return state && state.mode === "human" && state.to_move === state.human_color && !state.finished;
}

function formatArenaMove(move) {
  return !move || move.toLowerCase() === "pass" ? "Pass" : move.toUpperCase();
}

function renderMoveHistory(state) {
  const panel = $("#arena-move-panel");
  const list = $("#arena-move-list");
  panel.hidden = !state;
  list.replaceChildren();
  if (!state?.moves?.length) {
    const empty = document.createElement("li");
    empty.className = "move-empty";
    empty.textContent = "Waiting for the first move.";
    list.append(empty);
    return;
  }
  for (const entry of state.moves) {
    const item = document.createElement("li");
    item.className = `arena-move-entry ${entry.color}`;
    const number = document.createElement("span");
    number.className = "move-number";
    number.textContent = String(entry.number);
    const stone = document.createElement("span");
    stone.className = `mini-stone ${entry.color}`;
    const label = document.createElement("span");
    label.className = "move-label";
    label.textContent = entry.label;
    const coordinate = document.createElement("strong");
    coordinate.textContent = formatArenaMove(entry.move);
    item.append(number, stone, label, coordinate);
    list.append(item);
  }
  list.scrollTop = list.scrollHeight;
}

function renderArena(state) {
  arenaState = state;
  drawArenaBoard();
  const modelMatch = state.mode === "model_match";
  document.body.classList.toggle("arena-finished", Boolean(state.finished));
  const human = state.human_color === "black" ? "Black" : "White";
  const turn = state.to_move === "black" ? "Black" : "White";
  $("#arena-title").textContent = modelMatch
    ? `${state.board_size}×${state.board_size} · AI match`
    : `${state.board_size}×${state.board_size} · You play ${human}`;
  $("#arena-players").hidden = false;
  $("#arena-black-player").textContent = state.black_label;
  $("#arena-white-player").textContent = state.white_label;
  const badge = $("#arena-turn");
  badge.className = `status-badge ${state.finished ? "completed" : modelMatch && !matchPlaying ? "paused" : "running"}`;
  badge.textContent = state.finished
    ? "Finished"
    : modelMatch
      ? matchPlaying ? "Live" : "Paused"
      : humanTurn(state) ? "Your move" : "AI to move";
  $("#arena-move").textContent = `Move ${state.move_number} · ${turn} to move`;
  $("#arena-prisoners").textContent = `Prisoners: Black ${state.black_prisoners} · White ${state.white_prisoners}`;
  $("#arena-pass").disabled = arenaBusy || !humanTurn(state);
  $("#arena-reset").disabled = false;
  $("#arena-playback").disabled = !modelMatch || state.finished || arenaBusy;
  $("#arena-playback").textContent = matchPlaying ? "Pause" : "Continue";
  const last = state.moves.at(-1);
  if (state.finished) {
    $("#arena-message").textContent = state.finished_reason === "move_limit"
      ? "The safety move limit was reached. The selected scoring AI has produced a proposal."
      : "Two consecutive passes. The selected scoring AI has produced a proposal.";
  } else if (modelMatch) {
    $("#arena-message").textContent = last
      ? `${last.label} played ${formatArenaMove(last.move)}. ${turn} is next.`
      : "The live match is ready. Black will move first.";
  } else {
    $("#arena-message").textContent = state.bot_move
      ? `The AI played ${formatArenaMove(state.bot_move)}. Your move.`
      : "Click an empty intersection.";
  }
  renderMoveHistory(state);
  const live = $("#arena-live-dot");
  live.className = `live-dot ${state.finished ? "finished" : matchPlaying ? "playing" : "paused"}`;
  live.textContent = state.finished ? "Finished" : matchPlaying ? "Live" : "Paused";
  const result = $("#arena-result");
  result.hidden = !state.proposal;
  if (state.proposal) {
    const score = state.proposal.score;
    const winner = score.winner === "black"
      ? (modelMatch ? state.black_label : "Black")
      : score.winner === "white" ? (modelMatch ? state.white_label : "White") : "Jigo";
    $("#result-title").textContent = winner === "Jigo" ? "Jigo" : `${winner} wins`;
    $("#result-evaluator").textContent = state.proposal.evaluator_label
      ? `Scored by ${state.proposal.evaluator_label}`
      : "AI score proposal";
    $("#result-summary").textContent = winner === "Jigo" ? "Proposed tie" : `Proposed margin: ${score.margin.toFixed(1)} points`;
    $("#result-black").textContent = `${score.black_total.toFixed(1)} (${score.black_territory} territory + ${score.black_prisoners} prisoners)`;
    $("#result-white").textContent = `${score.white_total.toFixed(1)} (${score.white_territory} territory + ${score.white_prisoners} prisoners + 6.5 komi)`;
    $("#result-dead").textContent = String(state.proposal.dead_stones.length);
    $("#result-uncertain").textContent = String(state.proposal.uncertain_stones.length);
  }
}

function setArenaBusy(busy) {
  arenaBusy = busy;
  const showBlockingOverlay = busy && arenaMode === "human";
  $("#arena-busy").hidden = !showBlockingOverlay;
  $(".arena-board-panel").setAttribute("aria-busy", String(busy));
  const hasSelection = arenaMode === "human"
    ? Boolean($("#arena-model").value)
    : Boolean($("#arena-black-model").value && $("#arena-white-model").value);
  $("#arena-start").disabled = busy || !hasSelection;
  $("#arena-pass").disabled = busy || !humanTurn(arenaState);
  $("#arena-playback").disabled = arenaMode !== "match" || !arenaState || arenaState.finished;
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

function clearMatchTimer() {
  if (matchTimer !== null) window.clearTimeout(matchTimer);
  matchTimer = null;
}

function scheduleMatchMove(delay = Number($("#arena-speed").value)) {
  clearMatchTimer();
  if (!matchPlaying || !arenaState || arenaState.mode !== "model_match" || arenaState.finished) return;
  matchTimer = window.setTimeout(advanceMatch, delay);
}

async function advanceMatch() {
  if (!matchPlaying || !arenaState || arenaState.finished || arenaBusy) return;
  setArenaBusy(true);
  try {
    const state = await api("/api/arena/match/next", {
      method: "POST",
      body: JSON.stringify({ session_id: arenaState.session_id }),
    });
    if (state.finished) matchPlaying = false;
    renderArena(state);
  } catch (error) {
    matchPlaying = false;
    toast(error.message);
    if (arenaState) renderArena(arenaState);
  } finally {
    setArenaBusy(false);
    scheduleMatchMove();
  }
}

function resetArena() {
  clearMatchTimer();
  matchPlaying = false;
  arenaState = null;
  document.body.classList.remove("arena-finished");
  $("#arena-result").hidden = true;
  $("#arena-move-panel").hidden = true;
  $("#arena-players").hidden = true;
  $("#arena-pass").disabled = true;
  $("#arena-playback").disabled = true;
  $("#arena-reset").disabled = true;
  $("#arena-title").textContent = "Not started";
  $("#arena-turn").textContent = "Ready";
  $("#arena-turn").className = "status-badge idle";
  $("#arena-move").textContent = "Move 0";
  $("#arena-prisoners").textContent = "Prisoners: Black 0 · White 0";
  $("#arena-message").textContent = "Select an AI model and start a new test game.";
  drawArenaBoard();
}

function setArenaMode(mode) {
  if (!['human', 'match'].includes(mode)) return;
  resetArena();
  arenaMode = mode;
  document.body.classList.toggle("arena-match-mode", mode === "match");
  document.querySelectorAll(".arena-mode").forEach((button) => {
    button.classList.toggle("active", button.dataset.arenaMode === mode);
  });
  $("#human-arena-fields").hidden = mode !== "human";
  $("#match-arena-fields").hidden = mode !== "match";
  $("#arena-pass").hidden = mode !== "human";
  $("#arena-playback").hidden = mode !== "match";
  $("#arena-settings-title").textContent = mode === "human" ? "Test an AI" : "AI match control";
  $("#arena-start").textContent = mode === "human" ? "Start test game" : "Start live match";
  setArenaBusy(false);
}

$("#arena-start").addEventListener("click", async () => {
  clearMatchTimer();
  setArenaBusy(true);
  try {
    const common = {
      board_size: Number($("#arena-size").value),
      elo: Number($("#arena-elo").value),
    };
    const isMatch = arenaMode === "match";
    const state = await api(isMatch ? "/api/arena/match/start" : "/api/arena/start", {
      method: "POST",
      body: JSON.stringify(isMatch ? {
        ...common,
        black_model_id: $("#arena-black-model").value,
        white_model_id: $("#arena-white-model").value,
        settlement_evaluator: $("#arena-settlement-evaluator").value,
      } : {
        ...common,
        model_id: $("#arena-model").value,
        human_color: $("#arena-color").value,
      }),
    });
    matchPlaying = isMatch;
    renderArena(state);
    if (isMatch) scheduleMatchMove(500);
  } catch (error) {
    matchPlaying = false;
    toast(error.message);
  } finally {
    setArenaBusy(false);
  }
});
$("#arena-pass").addEventListener("click", () => arenaRequest({ session_id: arenaState.session_id, pass: true }));
$("#arena-playback").addEventListener("click", () => {
  if (!arenaState || arenaState.finished) return;
  matchPlaying = !matchPlaying;
  renderArena(arenaState);
  if (matchPlaying) scheduleMatchMove(200);
  else clearMatchTimer();
});
$("#arena-reset").addEventListener("click", resetArena);
document.querySelectorAll(".arena-mode").forEach((button) => {
  button.addEventListener("click", () => setArenaMode(button.dataset.arenaMode));
});
$("#refresh-models").addEventListener("click", () => loadArenaModels().catch((error) => toast(error.message)));
$("#arena-black-model").addEventListener("change", syncSettlementEvaluatorLabels);
$("#arena-white-model").addEventListener("change", syncSettlementEvaluatorLabels);
$("#arena-size").addEventListener("change", () => { if (!arenaState) drawArenaBoard(); });

async function initialize() {
  [presets] = await Promise.all([api("/api/presets"), loadArenaModels()]);
  renderPresets();
  drawArenaBoard();
  await refresh();
  window.setInterval(refresh, 1500);
}

initialize().catch((error) => toast(error.message));
