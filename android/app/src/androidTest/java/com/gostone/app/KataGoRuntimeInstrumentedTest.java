package com.gostone.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class KataGoRuntimeInstrumentedTest {
    private static final String MODEL_SHA256 =
        "0ba27eced5180b3e3d0b898b280c541112989765e789d1eb6cd0d31b2b2c1229";

    @Test
    public void bundledRuntimeAnalyzesOnePositionWithoutNetwork() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File executable = new File(
            context.getApplicationInfo().nativeLibraryDir,
            "libgostone_katago_exec.so"
        );
        assertTrue("KataGo executable was not extracted", executable.isFile());

        File directory = new File(context.getCacheDir(), "katago-instrumentation");
        assertTrue(directory.isDirectory() || directory.mkdirs());
        File model = copyAsset(
            context,
            "public/katago/b10c384h6nbttflrs.katago",
            new File(directory, "model.bin.gz")
        );
        File config = copyAsset(
            context,
            "public/katago/analysis-mobile.cfg",
            new File(directory, "analysis.cfg")
        );
        assertEquals(MODEL_SHA256, sha256(model));

        Process process = new ProcessBuilder(
            executable.getAbsolutePath(),
            "analysis",
            "-model", model.getAbsolutePath(),
            "-config", config.getAbsolutePath(),
            "-quit-without-waiting"
        ).redirectErrorStream(true).start();
        try {
            JSONObject request = new JSONObject()
                .put("id", "android-instrumentation")
                .put("moves", new JSONArray())
                .put("rules", "japanese")
                .put("komi", 6.5)
                .put("boardXSize", 9)
                .put("boardYSize", 9)
                .put("maxVisits", 1)
                .put("analysisPVLen", 3)
                .put("analyzeTurns", new JSONArray().put(0));
            try (BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(
                process.getOutputStream(),
                StandardCharsets.UTF_8
            ))) {
                writer.write(request.toString());
                writer.newLine();
                writer.flush();

                try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                    process.getInputStream(),
                    StandardCharsets.UTF_8
                ))) {
                    long deadline = System.nanoTime() + TimeUnit.MINUTES.toNanos(5);
                    String line;
                    JSONObject result = null;
                    StringBuilder diagnostics = new StringBuilder();
                    while (System.nanoTime() < deadline && (line = reader.readLine()) != null) {
                        diagnostics.append(line).append('\n');
                        if (!line.startsWith("{")) continue;
                        JSONObject candidate = new JSONObject(line);
                        if ("android-instrumentation".equals(candidate.optString("id"))) {
                            result = candidate;
                            break;
                        }
                    }
                    assertTrue("No analysis result. KataGo output:\n" + diagnostics, result != null);
                    assertFalse(result.optString("error"), result.has("error"));
                    assertEquals(0, result.getInt("turnNumber"));
                    assertTrue(result.getJSONObject("rootInfo").has("winrate"));
                    assertTrue(result.getJSONObject("rootInfo").has("scoreLead"));
                    assertTrue(result.has("moveInfos"));
                }
            }
        } finally {
            process.destroy();
            if (!process.waitFor(2, TimeUnit.SECONDS)) process.destroyForcibly();
        }
    }

    private static File copyAsset(Context context, String asset, File destination) throws Exception {
        try (InputStream input = context.getAssets().open(asset);
             FileOutputStream output = new FileOutputStream(destination)) {
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = input.read(buffer)) >= 0) output.write(buffer, 0, count);
            output.getFD().sync();
        }
        return destination;
    }

    private static String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new java.io.FileInputStream(file)) {
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = input.read(buffer)) >= 0) digest.update(buffer, 0, count);
        }
        StringBuilder value = new StringBuilder();
        for (byte item : digest.digest()) value.append(String.format("%02x", item));
        return value.toString();
    }
}
