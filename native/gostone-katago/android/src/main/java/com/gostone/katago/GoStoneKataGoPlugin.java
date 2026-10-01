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
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import java.util.TreeMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
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
    private static final int TOTAL_VISIT_BUDGET = 900;
    private static final int PREVIEW_VISITS = 1;
    private static final int PREVIEW_PV_LENGTH = 3;
    private static final int QUALITY_PV_LENGTH = 12;
    private static final int INITIAL_PREVIEW_POSITIONS = 11;
    private static final int PREVIEW_CHUNK_POSITIONS = 16;
    private static final int MAX_QUALITY_MOVES = 12;
    private static final double IMPORTANT_WINRATE_SWING = 0.05;
    private static final double IMPORTANT_SCORE_SWING = 2.5;
    private static final long MAX_ANALYSIS_SECONDS = 90L;

    private final ExecutorService analysisExecutor = Executors.newSingleThreadExecutor();
    private final ScheduledExecutorService timeoutExecutor = Executors.newSingleThreadScheduledExecutor();
    private final Object activeLock = new Object();
    private ActiveAnalysis activeAnalysis;
    private volatile RuntimeFiles verifiedRuntime;
    private WarmSession warmSession;

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
        final AtomicBoolean timedOut = new AtomicBoolean(false);
        volatile Process process;
        volatile BufferedWriter writer;

        ActiveAnalysis(String id) {
            this.id = id;
        }
    }

    private static final class WarmSession {
        final Process process;
        final BufferedWriter writer;
        final BufferedReader reader;

        WarmSession(Process process) {
            this.process = process;
            this.writer = new BufferedWriter(new OutputStreamWriter(process.getOutputStream(), StandardCharsets.UTF_8));
            this.reader = new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8));
        }
    }

    private static final class ImportantMove {
        final int moveNumber;
        final double impact;

        ImportantMove(int moveNumber, double impact) {
            this.moveNumber = moveNumber;
            this.impact = impact;
        }
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        analysisExecutor.execute(() -> {
            try {
                ensureWarmSession(ensureRuntime());
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
        else discardWarmSession(null);
    }

    @Override
    protected void handleOnDestroy() {
        ActiveAnalysis job;
        synchronized (activeLock) {
            job = activeAnalysis;
        }
        if (job != null) stop(job, true);
        else discardWarmSession(null);
        analysisExecutor.shutdownNow();
        timeoutExecutor.shutdownNow();
        super.handleOnDestroy();
    }

    private void runAnalysis(PluginCall call, ActiveAnalysis job, JSObject input, int visits) {
        TreeMap<Integer, JSONObject> bestTurns = new TreeMap<>();
        int qualityVisits = PREVIEW_VISITS;
        boolean keepWarm = false;
        ScheduledFuture<?> timeout = null;
        try {
            if (thermalStatus() >= PowerManager.THERMAL_STATUS_SEVERE) {
                throw new IllegalStateException("The device is too warm to start local analysis.");
            }
            RuntimeFiles runtime = ensureRuntime();
            WarmSession session = ensureWarmSession(runtime);
            job.process = session.process;
            job.writer = session.writer;
            timeout = timeoutExecutor.schedule(() -> {
                if (session.process.isAlive()) {
                    job.timedOut.set(true);
                    stop(job, false);
                }
            }, MAX_ANALYSIS_SECONDS, TimeUnit.SECONDS);

            int moveCount = input.getJSONArray("moves").length();
            int totalPositions = moveCount + 1;
            int chunkStart = 0;
            int chunkIndex = 0;
            while (chunkStart < totalPositions && !job.cancelled.get() && !job.timedOut.get()) {
                int chunkSize = chunkIndex == 0 ? INITIAL_PREVIEW_POSITIONS : PREVIEW_CHUNK_POSITIONS;
                int chunkEnd = Math.min(totalPositions, chunkStart + chunkSize);
                JSONArray chunkTurns = turnRange(chunkStart, chunkEnd);
                JSONObject previewRequest = buildRequest(
                    job.id + ":preview:" + chunkIndex,
                    input,
                    PREVIEW_VISITS,
                    PREVIEW_PV_LENGTH,
                    chunkTurns
                );
                if (!analyzePhase(
                    job, session, previewRequest, "preview", PREVIEW_VISITS,
                    chunkTurns.length(), totalPositions, bestTurns
                )) {
                    break;
                }
                chunkStart = chunkEnd;
                chunkIndex += 1;
            }

            if (job.cancelled.get()) throw new IllegalStateException("Local analysis was cancelled.");
            if (!hasUsableReview(bestTurns)) {
                throw new IllegalStateException("KataGo stopped before the first review block was analyzed.");
            }
            boolean previewComplete = bestTurns.size() >= totalPositions;
            boolean qualityComplete = false;
            if (previewComplete && !job.timedOut.get()) {
                JSONArray qualityTurns = importantTurns(bestTurns, moveCount);
                qualityVisits = adaptiveVisits(qualityTurns.length(), visits);
                if (qualityTurns.length() > 0 && qualityVisits > PREVIEW_VISITS) {
                    JSONObject qualityRequest = buildRequest(
                        job.id + ":quality",
                        input,
                        qualityVisits,
                        QUALITY_PV_LENGTH,
                        qualityTurns
                    );
                    qualityComplete = analyzePhase(
                        job, session, qualityRequest, "quality", qualityVisits,
                        qualityTurns.length(), qualityTurns.length(), bestTurns
                    );
                } else {
                    qualityComplete = true;
                }
            }
            keepWarm = previewComplete && !job.timedOut.get();
            resolveAnalysis(
                call,
                bestTurns,
                qualityComplete ? qualityVisits : PREVIEW_VISITS,
                previewComplete,
                qualityComplete ? null : "The quick review is complete; some detail passes were skipped."
            );
        } catch (Exception exception) {
            if (!job.cancelled.get() && hasUsableReview(bestTurns)) {
                resolveAnalysis(call, bestTurns, PREVIEW_VISITS, false, safeMessage(exception));
            } else {
                call.reject(safeMessage(exception), job.cancelled.get() ? "analysis_cancelled" : "native_analysis_failed", exception);
            }
        } finally {
            if (timeout != null) timeout.cancel(false);
            if (!keepWarm) discardWarmSession(job.process);
            synchronized (activeLock) {
                if (activeAnalysis == job) activeAnalysis = null;
            }
        }
    }

    private boolean analyzePhase(
        ActiveAnalysis job,
        WarmSession session,
        JSONObject request,
        String phase,
        int visits,
        int expectedPhaseTurns,
        int totalProgressTurns,
        TreeMap<Integer, JSONObject> bestTurns
    ) throws Exception {
        session.writer.write(request.toString());
        session.writer.newLine();
        session.writer.flush();
        TreeMap<Integer, JSONObject> phaseTurns = new TreeMap<>();
        String requestId = request.getString("id");
        String line;
        while (!job.cancelled.get() && !job.timedOut.get() && (line = session.reader.readLine()) != null) {
            JSONObject response;
            try {
                response = new JSONObject(line);
            } catch (Exception ignored) {
                continue;
            }
            if (!requestId.equals(response.optString("id"))) continue;
            if (response.has("error")) {
                throw new IllegalStateException("KataGo rejected the analysis: " + response.optString("error"));
            }
            if (response.optBoolean("isDuringSearch", false) || response.optBoolean("noResults", false)) continue;
            validateTurn(response);
            int turnNumber = response.getInt("turnNumber");
            phaseTurns.put(turnNumber, response);
            bestTurns.put(turnNumber, response);
            int completed = "preview".equals(phase) ? bestTurns.size() : phaseTurns.size();
            emitProgress(job.id, phase, completed, totalProgressTurns, visits, response);
            if (thermalStatus() >= PowerManager.THERMAL_STATUS_SEVERE) {
                stop(job, false);
                throw new IllegalStateException("Local analysis stopped because the device became too warm.");
            }
            if (phaseTurns.size() >= expectedPhaseTurns) return true;
        }
        return false;
    }

    private boolean hasUsableReview(TreeMap<Integer, JSONObject> turns) {
        return turns.containsKey(0) && turns.containsKey(1);
    }

    private void resolveAnalysis(
        PluginCall call,
        TreeMap<Integer, JSONObject> turns,
        int visits,
        boolean complete,
        String warning
    ) {
        JSArray resultTurns = new JSArray();
        for (Map.Entry<Integer, JSONObject> turn : turns.entrySet()) resultTurns.put(turn.getValue());
        JSObject result = new JSObject();
        result.put("turns", resultTurns);
        result.put("visitsPerTurn", visits);
        result.put("complete", complete);
        if (warning != null) result.put("warning", warning);
        call.resolve(result);
    }

    private int adaptiveVisits(int positionCount, int requestedVisits) {
        int budgetedVisits = Math.max(PREVIEW_VISITS, TOTAL_VISIT_BUDGET / Math.max(1, positionCount));
        return Math.max(PREVIEW_VISITS, Math.min(requestedVisits, budgetedVisits));
    }

    private JSONObject buildRequest(
        String id,
        JSObject input,
        int visits,
        int pvLength,
        JSONArray analyzeTurns
    ) throws Exception {
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
        request.put("analysisPVLen", pvLength);
        request.put("includePolicy", false);
        request.put("analyzeTurns", analyzeTurns);
        copyOptionalPositionFields(input, request);
        return request;
    }

    private JSONArray turnRange(int startInclusive, int endExclusive) {
        JSONArray turns = new JSONArray();
        for (int turn = startInclusive; turn < endExclusive; turn++) turns.put(turn);
        return turns;
    }

    private JSONArray importantTurns(TreeMap<Integer, JSONObject> previewTurns, int moveCount) throws Exception {
        List<ImportantMove> candidates = new ArrayList<>();
        for (int moveNumber = 1; moveNumber <= moveCount; moveNumber++) {
            JSONObject before = previewTurns.get(moveNumber - 1);
            JSONObject after = previewTurns.get(moveNumber);
            if (before == null || after == null) continue;
            double winrateSwing = Math.abs(blackWinrate(before) - blackWinrate(after));
            double scoreSwing = Math.abs(blackScoreLead(before) - blackScoreLead(after));
            double impact = Math.max(
                winrateSwing / IMPORTANT_WINRATE_SWING,
                scoreSwing / IMPORTANT_SCORE_SWING
            );
            candidates.add(new ImportantMove(moveNumber, impact));
        }
        candidates.sort(Comparator.comparingDouble((ImportantMove item) -> item.impact).reversed());
        TreeSet<Integer> selected = new TreeSet<>();
        int selectedMoves = 0;
        for (ImportantMove candidate : candidates) {
            if (selectedMoves >= MAX_QUALITY_MOVES) break;
            if (candidate.impact < 1.0 && selectedMoves >= Math.min(3, candidates.size())) break;
            selected.add(candidate.moveNumber - 1);
            selected.add(candidate.moveNumber);
            selectedMoves += 1;
        }
        JSONArray turns = new JSONArray();
        for (Integer turn : selected) turns.put(turn);
        return turns;
    }

    private double blackWinrate(JSONObject turn) throws Exception {
        JSONObject root = turn.getJSONObject("rootInfo");
        double value = root.getDouble("winrate");
        return "B".equals(root.getString("currentPlayer")) ? value : 1.0 - value;
    }

    private double blackScoreLead(JSONObject turn) throws Exception {
        JSONObject root = turn.getJSONObject("rootInfo");
        double value = root.getDouble("scoreLead");
        return "B".equals(root.getString("currentPlayer")) ? value : -value;
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

    private synchronized WarmSession ensureWarmSession(RuntimeFiles runtime) throws Exception {
        if (warmSession != null && warmSession.process.isAlive()) return warmSession;
        discardWarmSession(null);
        Process process = new ProcessBuilder(
            runtime.executable.getAbsolutePath(),
            "analysis",
            "-model", runtime.model.getAbsolutePath(),
            "-config", runtime.config.getAbsolutePath(),
            "-quit-without-waiting"
        ).start();
        warmSession = new WarmSession(process);
        drainStderr(process);
        return warmSession;
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

    private void drainStderr(Process process) {
        Thread thread = new Thread(() -> {
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getErrorStream(), StandardCharsets.UTF_8))) {
                while (reader.readLine() != null) {
                    // Diagnostics are drained but never exposed to the web view.
                }
            } catch (Exception ignored) {
                // Process shutdown closes the stream.
            }
        }, "gostone-katago-stderr");
        thread.setDaemon(true);
        thread.start();
    }

    private void emitProgress(
        String id,
        String phase,
        int completed,
        int total,
        int visits,
        JSONObject turn
    ) {
        JSObject progress = new JSObject();
        progress.put("analysisId", id);
        progress.put("phase", phase);
        progress.put("completedTurns", completed);
        progress.put("totalTurns", total);
        progress.put("visitsPerTurn", visits);
        progress.put("thermalState", thermalStateName());
        progress.put("turn", turn);
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
        discardWarmSession(job.process);
    }

    private synchronized void discardWarmSession(Process expectedProcess) {
        WarmSession session = warmSession;
        if (session == null || (expectedProcess != null && session.process != expectedProcess)) return;
        warmSession = null;
        Process process = session.process;
        if (process != null && process.isAlive()) {
            process.destroy();
            try {
                if (!process.waitFor(2, TimeUnit.SECONDS)) process.destroyForcibly();
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                process.destroyForcibly();
            }
        }
        try {
            session.writer.close();
        } catch (Exception ignored) {
            // Process shutdown already provides the cancellation boundary.
        }
        try {
            session.reader.close();
        } catch (Exception ignored) {
            // Process shutdown already provides the cancellation boundary.
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
