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

async function initialize() {
  presets = await api("/api/presets");
  renderPresets();
  await refresh();
  window.setInterval(refresh, 1500);
}

initialize().catch((error) => toast(error.message));
