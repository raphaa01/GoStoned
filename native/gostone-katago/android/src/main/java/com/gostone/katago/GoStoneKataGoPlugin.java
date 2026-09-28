package com.gostone.katago;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.InputStream;
import java.security.MessageDigest;

@CapacitorPlugin(name = "GoStoneKataGo")
public class GoStoneKataGoPlugin extends Plugin {
    private static final String ENGINE_VERSION = "v1.18.2";
    private static final String MODEL_SHA256 = "0ba27eced5180b3e3d0b898b280c541112989765e789d1eb6cd0d31b2b2c1229";

    @PluginMethod
    public void getStatus(PluginCall call) {
        try (InputStream input = getContext().getAssets().open("public/katago/b10c384h6nbttflrs.katago")) {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = input.read(buffer)) >= 0) digest.update(buffer, 0, count);
            if (!MODEL_SHA256.equals(hex(digest.digest()))) {
                call.resolve(status(false, "The bundled KataGo model failed verification."));
                return;
            }
        } catch (Exception exception) {
            call.resolve(status(false, "The bundled KataGo model could not be read."));
            return;
        }
        call.resolve(status(false, "The Android KataGo core has not been linked into this build."));
    }

    @PluginMethod
    public void analyze(PluginCall call) {
        call.reject("The Android KataGo core is unavailable.", "native_runtime_unavailable");
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        call.resolve();
    }

    private JSObject status(boolean available, String reason) {
        JSObject result = new JSObject();
        result.put("available", available);
        result.put("engineVersion", ENGINE_VERSION);
        result.put("modelSha256", MODEL_SHA256);
        if (reason != null) result.put("reason", reason);
        return result;
    }

    private static String hex(byte[] value) {
        StringBuilder result = new StringBuilder(value.length * 2);
        for (byte item : value) result.append(String.format("%02x", item));
        return result.toString();
    }
}
