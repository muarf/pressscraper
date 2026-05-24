package io.qzz.pressecraper;

import android.content.Intent;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginResult;

@CapacitorPlugin(name = "IntentForwarder")
public class IntentForwarderPlugin extends Plugin {
    private static final String TAG = "IntentForwarder";
    private JSObject lastSharedIntent = null;

    @Override
    public void load() {
        super.load();
        Log.i(TAG, "Plugin loaded, checking initial intent");
        handleIntent(getActivity().getIntent());
    }

    @Override
    public void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        Log.i(TAG, "handleOnNewIntent called");
        handleIntent(intent);
    }

    @Override
    public void handleOnActivityResult(int requestCode, int resultCode, Intent data) {
        super.handleOnActivityResult(requestCode, resultCode, data);
    }

    private void handleIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        String type = intent.getType();
        Log.i(TAG, "handleIntent: action=" + action + " type=" + type);

        if (Intent.ACTION_SEND.equals(action) && type != null) {
            if ("text/plain".equals(type) || "text/html".equals(type)) {
                String sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);
                if (sharedText != null) {
                    Log.i(TAG, "Forwarding sharedText: " + sharedText);
                    JSObject ret = new JSObject();
                    ret.put("type", "sharedText");
                    ret.put("data", sharedText);
                    lastSharedIntent = ret;
                    notifyListeners("intentReceived", ret, true);
                }
            }
        } else if (Intent.ACTION_PROCESS_TEXT.equals(action)) {
            CharSequence processedText = intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT);
            if (processedText != null) {
                String text = processedText.toString();
                Log.i(TAG, "Forwarding PROCESS_TEXT: " + text);
                JSObject ret = new JSObject();
                ret.put("type", "sharedText");
                ret.put("data", text);
                lastSharedIntent = ret;
                notifyListeners("intentReceived", ret, true);
            }
        } else if (Intent.ACTION_VIEW.equals(action)) {
            String url = intent.getDataString();
            if (url != null) {
                Log.i(TAG, "Forwarding VIEW URL: " + url);
                JSObject ret = new JSObject();
                ret.put("type", "sharedUrl");
                ret.put("data", url);
                lastSharedIntent = ret;
                notifyListeners("intentReceived", ret, true);
            }
        }
    }

    @PluginMethod
    public void getLastIntent(PluginCall call) {
        if (lastSharedIntent != null) {
            call.resolve(lastSharedIntent);
            lastSharedIntent = null;
        } else {
            call.resolve(new JSObject());
        }
    }
}

