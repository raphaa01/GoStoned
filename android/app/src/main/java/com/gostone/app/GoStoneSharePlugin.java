package com.gostone.app;

import android.content.Intent;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "GoStoneShare")
public class GoStoneSharePlugin extends Plugin {
    @PluginMethod
    public void share(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !url.startsWith("https://")) {
            call.reject("A public HTTPS link is required.");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                Intent intent = new Intent(Intent.ACTION_SEND);
                intent.setType("text/plain");
                intent.putExtra(Intent.EXTRA_SUBJECT, call.getString("title"));
                intent.putExtra(Intent.EXTRA_TEXT, call.getString("text", "") + "\n" + url);
                getActivity().startActivity(Intent.createChooser(intent, call.getString("title")));
                call.resolve();
            } catch (Exception error) {
                call.reject("Could not open the share sheet.", error);
            }
        });
    }
}
