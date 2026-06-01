package io.qzz.pressecraper;

import android.content.Intent;
import android.os.Bundle;
import android.util.Log;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "PresseScraper";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Register custom plugins before super.onCreate
        registerPlugin(BnfLoginPlugin.class);
        registerPlugin(CafeynLoginPlugin.class);
        registerPlugin(IntentForwarderPlugin.class);
        registerPlugin(BackgroundPollPlugin.class);
        registerPlugin(HeadlessScrapePlugin.class);

        super.onCreate(savedInstanceState);

        handleIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        setIntent(intent);
        super.onNewIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        String type = intent.getType();
        Log.i(TAG, "Intent: action=" + action + " type=" + type);

        // Handle notification click - open specific article
        String openArticleId = intent.getStringExtra("openArticleId");
        if (openArticleId != null && !openArticleId.isEmpty()) {
            Log.i(TAG, "Open article from notification: " + openArticleId);
            notifyJs("openArticle", openArticleId);
            return;
        }

        if (Intent.ACTION_SEND.equals(action) && type != null) {
            if ("text/plain".equals(type) || "text/html".equals(type)) {
                String sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);
                String sharedTitle = intent.getStringExtra(Intent.EXTRA_SUBJECT);
                if (sharedText != null) {
                    Log.i(TAG, "SEND text: " + sharedText);
                    // L'IntentForwarderPlugin notifie déjà le JS via intentReceived → handleSharedContent
                    // Le service n'est démarré que pour ACTION_VIEW (liens directs) et PROCESS_TEXT
                }
            }
        } else if (Intent.ACTION_PROCESS_TEXT.equals(action)) {
            CharSequence processedText = intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT);
            if (processedText != null) {
                String text = processedText.toString();
                Log.i(TAG, "PROCESS_TEXT: " + text);
                try {
                    Intent serviceIntent = new Intent(this, ScrapeForegroundService.class);
                    serviceIntent.putExtra("url", text);
                    startForegroundService(serviceIntent);
                } catch (Exception e) {
                    Log.e(TAG, "Failed to start ScrapeForegroundService: " + e.getMessage());
                }
                Intent resultIntent = new Intent();
                resultIntent.putExtra(Intent.EXTRA_PROCESS_TEXT, text);
                setResult(RESULT_OK, resultIntent);
            }
        } else if (Intent.ACTION_VIEW.equals(action)) {
            String url = intent.getDataString();
            if (url != null) {
                Log.i(TAG, "VIEW URL: " + url);
                try {
                    Intent serviceIntent = new Intent(this, ScrapeForegroundService.class);
                    serviceIntent.putExtra("url", url);
                    startForegroundService(serviceIntent);
                } catch (Exception e) {
                    Log.e(TAG, "Failed to start ScrapeForegroundService: " + e.getMessage());
                }
            }
        }
    }

    private void notifyJs(String event, String data) {
        try {
            String jsonData = "{\"url\":" + org.json.JSONObject.quote(data) + "}";
            Log.i(TAG, "notifyJs event=" + event + " data=" + jsonData);
            getBridge().triggerWindowJSEvent(event, jsonData);
        } catch (Exception e) {
            Log.e(TAG, "notifyJs error: " + e.getMessage());
        }
    }
}
