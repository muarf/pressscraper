package io.qzz.pressecraper;

import android.content.Intent;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "HeadlessScrape")
public class HeadlessScrapePlugin extends Plugin {

    private static final String TAG = "HeadlessScrapePlugin";

    @PluginMethod
    public void startScrape(PluginCall call) {
        String url = call.getString("url", "");
        if (url.isEmpty()) {
            call.reject("URL is required");
            return;
        }

        Log.i(TAG, "Starting background scrape for: " + url);
        Intent intent = new Intent(getContext(), ScrapeForegroundService.class);
        intent.putExtra("url", url);
        getContext().startForegroundService(intent);
        call.resolve();
    }
}
