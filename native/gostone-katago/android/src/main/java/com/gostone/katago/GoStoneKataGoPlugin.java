package com.gostone.katago;

import android.os.Build;
import android.os.PowerManager;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "GoStoneKataGo")
public class GoStoneKataGoPlugin extends Plugin {
    private static final String ENGINE_VERSION = "v1.18.2";
    private static final String MODEL_SHA256 = "0ba27eced5180b3e3d0b898b280c541112989765e789d1eb6cd0d31b2b2c1229";
    private static final String MODEL_ASSET = "public/katago/b10c384h6nbttflrs.katago";
    private static final String CONFIG_ASSET = "public/katago/analysis-mobile.cfg";
    private static final String EXECUTABLE_NAME = "libgostone_katago_exec.so";
    private static final int MAX_VISITS = 80;
    private static final int MAX_MOVES = 1_000;

    private final ExecutorService analysisExecutor = Executors.newSingleThreadExecutor();
    private final ScheduledExecutorService timeoutExecutor = Executors.newSingleThreadScheduledExecutor();
    private final Object activeLock = new Object();
    private ActiveAnalysis activeAnalysis;
    private volatile RuntimeFiles verifiedRuntime;

    private static final class RuntimeFiles {
        final File executable;
        final File model;
        final File config;

        RuntimeFiles(File executable, File model, File config) {
            this.executable = executable;
            this.model = model;
            this.config = config;
        }
    }

    private static final class ActiveAnalysis {
        final String id;
        final AtomicBoolean cancelled = new AtomicBoolean(false);
        volatile Process process;
        volatile BufferedWriter writer;

        ActiveAnalysis(String id) {
            this.id = id;
        }
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        analysisExecutor.execute(() -> {
            try {
                ensureRuntime();
                call.resolve(status(true, null));
            } catch (Exception exception) {
                call.resolve(status(false, safeMessage(exception)));
            }
        });
    }

    @PluginMethod
    public void analyze(PluginCall call) {
        String analysisId = call.getString("analysisId");
        JSObject input = call.getObject("input");
        Integer requestedVisits = call.getInt("visitsPerTurn");
        if (analysisId == null || analysisId.isBlank() || input == null) {
            call.reject("A valid analysisId and input are required.", "invalid_analysis_request");
            return;
        }
        final int visits = Math.max(1, Math.min(MAX_VISITS, requestedVisits == null ? 20 : requestedVisits));
        final ActiveAnalysis job = new ActiveAnalysis(analysisId);
        synchronized (activeLock) {
            if (activeAnalysis != null) {
                call.reject("Another local analysis is already running.", "analysis_busy");
                return;
            }
            activeAnalysis = job;
        }
        analysisExecutor.execute(() -> runAnalysis(call, job, input, visits));
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String analysisId = call.getString("analysisId");
        ActiveAnalysis job;
        synchronized (activeLock) {
            job = activeAnalysis;
        }
        if (job != null && (analysisId == null || analysisId.equals(job.id))) stop(job, true);
        call.resolve();
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        ActiveAnalysis job;
        synchronized (activeLock) {
            job = activeAnalysis;
        }
        if (job != null) stop(job, true);
    }

    @Override
    protected void handleOnDestroy() {
        ActiveAnalysis job;
        synchronized (activeLock) {
            job = activeAnalysis;
        }
        if (job != null) stop(job, true);
        analysisExecutor.shutdownNow();
        timeoutExecutor.shutdownNow();
        super.handleOnDestroy();
    }

    private void runAnalysis(PluginCall call, ActiveAnalysis job, JSObject input, int visits) {
        try {
            if (thermalStatus() >= PowerManager.THERMAL_STATUS_SEVERE) {
                throw new IllegalStateException("The device is too warm to start local analysis.");
            }
            RuntimeFiles runtime = ensureRuntime();
            JSONObject request = buildRequest(job.id, input, visits);
            int expectedTurns = request.getJSONArray("analyzeTurns").length();
            long timeoutSeconds = Math.min(1_800L, Math.max(120L, expectedTurns * 20L));

            Process process = new ProcessBuilder(
                runtime.executable.getAbsolutePath(),
                "analysis",
                "-model", runtime.model.getAbsolutePath(),
                "-config", runtime.config.getAbsolutePath(),
                "-quit-without-waiting"
            ).start();
            job.process = process;
            drainStderr(process, job);
            BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(process.getOutputStream(), StandardCharsets.UTF_8));
            job.writer = writer;
            writer.write(request.toString());
            writer.newLine();
            writer.flush();

            timeoutExecutor.schedule(() -> {
                if (process.isAlive()) stop(job, false);
            }, timeoutSeconds, TimeUnit.SECONDS);

            TreeMap<Integer, JSONObject> turns = new TreeMap<>();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while (!job.cancelled.get() && (line = reader.readLine()) != null) {
                    JSONObject response;
                    try {
                        response = new JSONObject(line);
                    } catch (Exception ignored) {
                        continue;
                    }
                    if (!job.id.equals(response.optString("id"))) continue;
                    if (response.has("error")) {
                        throw new IllegalStateException("KataGo rejected the analysis: " + response.optString("error"));
                    }
                    if (response.optBoolean("isDuringSearch", false) || response.optBoolean("noResults", false)) continue;
                    validateTurn(response);
                    turns.put(response.getInt("turnNumber"), response);
                    emitProgress(job.id, turns.size(), expectedTurns);
                    if (thermalStatus() >= PowerManager.THERMAL_STATUS_SEVERE) {
                        stop(job, false);
                        throw new IllegalStateException("Local analysis stopped because the device became too warm.");
                    }
                    if (turns.size() >= expectedTurns) break;
                }
            }

            if (job.cancelled.get()) throw new IllegalStateException("Local analysis was cancelled.");
            if (turns.size() != expectedTurns) {
                throw new IllegalStateException("KataGo stopped before every game position was analyzed.");
            }
            JSArray resultTurns = new JSArray();
            for (Map.Entry<Integer, JSONObject> turn : turns.entrySet()) resultTurns.put(turn.getValue());
            JSObject result = new JSObject();
            result.put("turns", resultTurns);
            call.resolve(result);
        } catch (Exception exception) {
            call.reject(safeMessage(exception), job.cancelled.get() ? "analysis_cancelled" : "native_analysis_failed", exception);
        } finally {
            stop(job, false);
            synchronized (activeLock) {
                if (activeAnalysis == job) activeAnalysis = null;
            }
        }
    }

    private JSONObject buildRequest(String id, JSObject input, int visits) throws Exception {
        JSONArray sourceMoves = input.getJSONArray("moves");
        if (sourceMoves == null || sourceMoves.length() > MAX_MOVES) {
            throw new IllegalArgumentException("The game move list is invalid or too large.");
        }
        int boardSize = input.getInt("boardSize");
        if (boardSize != 9 && boardSize != 13 && boardSize != 19) {
            throw new IllegalArgumentException("Unsupported board size.");
        }
        JSONArray moves = new JSONArray();
        for (int index = 0; index < sourceMoves.length(); index++) {
            JSONObject move = sourceMoves.getJSONObject(index);
            moves.put(new JSONArray()
                .put("black".equals(move.getString("color")) ? "B" : "W")
                .put(move.getString("move")));
        }
        JSONObject request = new JSONObject();
        request.put("id", id);
        request.put("moves", moves);
        request.put("rules", input.getString("rules"));
        request.put("komi", input.getDouble("komi"));
        request.put("boardXSize", boardSize);
        request.put("boardYSize", boardSize);
        request.put("maxVisits", visits);
        request.put("analysisPVLen", 12);
        request.put("includePolicy", true);
        JSONArray analyzeTurns = new JSONArray();
        for (int turn = 0; turn <= moves.length(); turn++) analyzeTurns.put(turn);
        request.put("analyzeTurns", analyzeTurns);
        copyOptionalPositionFields(input, request);
        return request;
    }

    private void copyOptionalPositionFields(JSObject input, JSONObject request) throws Exception {
        if (input.has("initialPlayer")) {
            request.put("initialPlayer", "black".equals(input.getString("initialPlayer")) ? "B" : "W");
        }
        JSONArray initialStones = input.optJSONArray("initialStones");
        if (initialStones != null) {
            JSONArray converted = new JSONArray();
            for (int index = 0; index < initialStones.length(); index++) {
                JSONObject stone = initialStones.getJSONObject(index);
                converted.put(new JSONArray()
                    .put("black".equals(stone.getString("color")) ? "B" : "W")
                    .put(stone.getString("move")));
            }
            request.put("initialStones", converted);
        }
        JSONArray allowMoves = input.optJSONArray("allowMoves");
        if (allowMoves != null) {
            JSONArray converted = new JSONArray();
            for (int index = 0; index < allowMoves.length(); index++) {
                JSONObject source = allowMoves.getJSONObject(index);
                JSONObject restriction = new JSONObject();
                restriction.put("player", "black".equals(source.getString("player")) ? "B" : "W");
                restriction.put("moves", source.getJSONArray("moves"));
                restriction.put("untilDepth", source.getInt("untilDepth"));
                converted.put(restriction);
            }
            request.put("allowMoves", converted);
        }
    }

    private void validateTurn(JSONObject value) throws Exception {
        int turnNumber = value.getInt("turnNumber");
        if (turnNumber < 0) throw new IllegalStateException("KataGo returned an invalid turn number.");
        JSONObject root = value.getJSONObject("rootInfo");
        String player = root.getString("currentPlayer");
        if (!"B".equals(player) && !"W".equals(player)) {
            throw new IllegalStateException("KataGo returned an invalid current player.");
        }
        root.getDouble("winrate");
        root.getDouble("scoreLead");
        value.getJSONArray("moveInfos");
    }

    private synchronized RuntimeFiles ensureRuntime() throws Exception {
        if (verifiedRuntime != null) return verifiedRuntime;
        File executable = new File(getContext().getApplicationInfo().nativeLibraryDir, EXECUTABLE_NAME);
        if (!executable.isFile()) throw new IllegalStateException("The bundled KataGo Android executable is missing.");
        executable.setExecutable(true, false);
        File directory = new File(getContext().getFilesDir(), "katago/" + ENGINE_VERSION);
        if (!directory.isDirectory() && !directory.mkdirs()) {
            throw new IllegalStateException("The local KataGo runtime directory could not be created.");
        }
        File model = new File(directory, "b10c384h6nbttflrs.bin.gz");
        ensureVerifiedAsset(MODEL_ASSET, model, MODEL_SHA256);
        File config = new File(directory, "analysis-mobile.cfg");
        copyAsset(CONFIG_ASSET, config);
        verifyExecutable(executable);
        verifiedRuntime = new RuntimeFiles(executable, model, config);
        return verifiedRuntime;
    }

    private void ensureVerifiedAsset(String asset, File destination, String expectedSha256) throws Exception {
        if (destination.isFile() && expectedSha256.equals(sha256(destination))) return;
        File temporary = new File(destination.getParentFile(), destination.getName() + ".tmp");
        copyAsset(asset, temporary);
        String actual = sha256(temporary);
        if (!expectedSha256.equals(actual)) {
            temporary.delete();
            throw new IllegalStateException("The bundled KataGo model failed verification.");
        }
        if (destination.exists() && !destination.delete()) throw new IllegalStateException("The old KataGo model could not be replaced.");
        if (!temporary.renameTo(destination)) throw new IllegalStateException("The verified KataGo model could not be installed.");
    }

    private void copyAsset(String asset, File destination) throws Exception {
        File parent = destination.getParentFile();
        if (parent != null && !parent.isDirectory() && !parent.mkdirs()) {
            throw new IllegalStateException("The KataGo asset directory could not be created.");
        }
        try (InputStream input = getContext().getAssets().open(asset);
             FileOutputStream output = new FileOutputStream(destination)) {
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = input.read(buffer)) >= 0) output.write(buffer, 0, count);
            output.getFD().sync();
        }
    }

    private void verifyExecutable(File executable) throws Exception {
        Process process = new ProcessBuilder(executable.getAbsolutePath(), "version")
            .redirectErrorStream(true)
            .start();
        StringBuilder output = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null && output.length() < 8_000) output.append(line).append('\n');
        }
        if (!process.waitFor(15, TimeUnit.SECONDS)) {
            process.destroyForcibly();
            throw new IllegalStateException("The bundled KataGo executable did not start.");
        }
        if (process.exitValue() != 0 || !output.toString().contains("KataGo " + ENGINE_VERSION)) {
            throw new IllegalStateException("The bundled KataGo executable failed its version check.");
        }
    }

    private void drainStderr(Process process, ActiveAnalysis job) {
        Thread thread = new Thread(() -> {
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getErrorStream(), StandardCharsets.UTF_8))) {
                while (!job.cancelled.get() && reader.readLine() != null) {
                    // Diagnostics are drained but never exposed to the web view.
                }
            } catch (Exception ignored) {
                // Process shutdown closes the stream.
            }
        }, "gostone-katago-stderr");
        thread.setDaemon(true);
        thread.start();
    }

    private void emitProgress(String id, int completed, int total) {
        JSObject progress = new JSObject();
        progress.put("analysisId", id);
        progress.put("completedTurns", completed);
        progress.put("totalTurns", total);
        progress.put("thermalState", thermalStateName());
        notifyListeners("progress", progress);
    }

    private int thermalStatus() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return PowerManager.THERMAL_STATUS_NONE;
        PowerManager manager = (PowerManager) getContext().getSystemService(android.content.Context.POWER_SERVICE);
        return manager == null ? PowerManager.THERMAL_STATUS_NONE : manager.getCurrentThermalStatus();
    }

    private String thermalStateName() {
        int status = thermalStatus();
        if (status >= PowerManager.THERMAL_STATUS_CRITICAL) return "critical";
        if (status >= PowerManager.THERMAL_STATUS_SEVERE) return "serious";
        if (status >= PowerManager.THERMAL_STATUS_MODERATE) return "fair";
        return "nominal";
    }

    private void stop(ActiveAnalysis job, boolean cancelled) {
        if (cancelled) job.cancelled.set(true);
        try {
            if (job.writer != null) {
                JSONObject terminate = new JSONObject();
                terminate.put("id", "terminate:" + job.id);
                terminate.put("action", "terminate");
                terminate.put("terminateId", job.id);
                job.writer.write(terminate.toString());
                job.writer.newLine();
                job.writer.flush();
                job.writer.close();
            }
        } catch (Exception ignored) {
            // Destroying the process below is the final cancellation boundary.
        }
        Process process = job.process;
        if (process != null && process.isAlive()) {
            process.destroy();
            try {
                if (!process.waitFor(2, TimeUnit.SECONDS)) process.destroyForcibly();
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                process.destroyForcibly();
            }
        }
    }

    private String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (FileInputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = input.read(buffer)) >= 0) digest.update(buffer, 0, count);
        }
        return hex(digest.digest());
    }

    private JSObject status(boolean available, String reason) {
        JSObject result = new JSObject();
        result.put("available", available);
        result.put("engineVersion", ENGINE_VERSION);
        result.put("modelSha256", MODEL_SHA256);
        if (reason != null) result.put("reason", reason);
        return result;
    }

    private static String safeMessage(Exception exception) {
        String message = exception.getMessage();
        return message == null || message.isBlank() ? "The local KataGo runtime failed." : message;
    }

    private static String hex(byte[] value) {
        StringBuilder result = new StringBuilder(value.length * 2);
        for (byte item : value) result.append(String.format("%02x", item));
        return result.toString();
    }
}
