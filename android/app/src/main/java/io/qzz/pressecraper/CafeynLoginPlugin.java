package io.qzz.pressecraper;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.CookieManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKeys;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.security.GeneralSecurityException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

@CapacitorPlugin(name = "CafeynLogin")
public class CafeynLoginPlugin extends Plugin {

    private static final String TAG = "CafeynLoginPlugin";
    private static final String JWT_PREFS_NAME = "cafeyn_jwt_encrypted";
    private static final String JWT_KEY = "cafeyn_jwt";
    private static final String JWT_EXPIRY_KEY = "cafeyn_jwt_expiry";
    // GPSEA login URL with redirect to cafeyn
    private static final String CAFEYN_AUTH_URL = "https://mediatheques.sudestavenir.fr/auth/login?redirect=https://mediatheques.sudestavenir.fr/modules/cafeyn";
    private static final String CAFEYN_DOMAIN = "api.cafeyn.co";

    private WebView webView;
    private PluginCall pendingCall;
    private Handler timeoutHandler;
    private Runnable timeoutRunnable;

    @PluginMethod()
    public void login(PluginCall call) {
        String username = call.getString("username", "");
        String password = call.getString("password", "");

        if (username.isEmpty() || password.isEmpty()) {
            JSObject result = new JSObject();
            result.put("success", false);
            result.put("error", "Username and password required");
            call.resolve(result);
            return;
        }

        this.pendingCall = call;

        // Set timeout (90 seconds - GPSEA can be slow)
        timeoutHandler = new Handler(Looper.getMainLooper());
        timeoutRunnable = () -> {
            if (pendingCall != null) {
                cleanup();
                JSObject result = new JSObject();
                result.put("success", false);
                result.put("error", "Login timeout");
                pendingCall.resolve(result);
                pendingCall = null;
            }
        };
        timeoutHandler.postDelayed(timeoutRunnable, 90000);

        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                performLogin(username, password);
            } catch (Exception e) {
                Log.e(TAG, "Login error", e);
                cleanup();
                JSObject result = new JSObject();
                result.put("success", false);
                result.put("error", e.getMessage());
                call.resolve(result);
            }
        });
    }

    private void performLogin(String username, String password) {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }

        webView = new WebView(getContext());
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setLoadWithOverviewMode(true);
        webView.getSettings().setUseWideViewPort(true);

        // Enable cookies
        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, true);

        // Escape credentials for JS injection
        String safeUsername = escapeJs(username);
        String safePassword = escapeJs(password);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                Log.i(TAG, "shouldOverrideUrlLoading: " + url);
                if (hasCafeynToken(url)) {
                    handleLoginSuccess(url);
                    return true;
                }
                return false;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, android.webkit.WebResourceRequest request) {
                String url = request.getUrl().toString();
                Log.i(TAG, "shouldOverrideUrlLoading (request): " + url);
                if (hasCafeynToken(url)) {
                    handleLoginSuccess(url);
                    return true;
                }
                return false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                Log.i(TAG, "Page finished: " + url);

                // Check if redirected to cafeyn with token (login succeeded)
                if (hasCafeynToken(url)) {
                    handleLoginSuccess(url);
                    return;
                }

                // Check for login errors
                view.evaluateJavascript(
                    "(function() {" +
                    "  var errors = document.querySelectorAll('.erreur, .error, [class*=\"error\"], .alert-danger, #error, .alert, .message-error');" +
                    "  for (var i = 0; i < errors.length; i++) {" +
                    "    var t = errors[i].textContent.trim();" +
                    "    if (t && errors[i].offsetParent !== null) return t;" +
                    "  }" +
                    "  return null;" +
                    "})()",
                    errorResult -> {
                        if (errorResult != null && !errorResult.equals("null") && !errorResult.isEmpty()) {
                            String error = errorResult.replace("\"", "").trim();
                            Log.w(TAG, "Login error: " + error);
                            handleLoginFailure(error);
                            return;
                        }
                    }
                );

                // If on login page, auto-fill and submit
                if ((url.contains("auth/login") || url.contains("mediatheques")) && url.contains("cafeyn")) {
                    String jsCode =
                        "  var form = document.querySelector('form[action*=\"cafeyn\"]') || document.querySelector('form');" +
                        "  if (!form) return 'no_form';" +
                        "  var u = form.querySelector(\"input[name='username']\") || form.querySelector(\"input[type='text'], input[id*='user'], input[name*='user'], input[name='username'], input[name='j_username'], input[placeholder*='Numéro'], input[placeholder*='card'], input[placeholder*='Identifiant']\");" +
                        "  var p = form.querySelector(\"input[name='password']\") || form.querySelector(\"input[type='password'], input[name='j_password'], input[name='password']\");" +
                        "  if (u && p) {" +
                        "    u.value = '" + safeUsername + "';" +
                        "    u.dispatchEvent(new Event('input', {bubbles: true}));" +
                        "    u.dispatchEvent(new Event('change', {bubbles: true}));" +
                        "    u.dispatchEvent(new Event('blur', {bubbles: true}));" +
                        "    p.value = '" + safePassword + "';" +
                        "    p.dispatchEvent(new Event('input', {bubbles: true}));" +
                        "    p.dispatchEvent(new Event('change', {bubbles: true}));" +
                        "    p.dispatchEvent(new Event('blur', {bubbles: true}));" +
                        "    form.submit(); return 'submitted';" +
                        "  }" +
                        "  return 'no_fields';" +
                        "})()";

                    view.evaluateJavascript(jsCode, fillResult -> {
                        Log.d(TAG, "Form fill: " + fillResult);
                    });
                }
            }
        });

        webView.loadUrl(CAFEYN_AUTH_URL);
    }

    private void handleLoginSuccess(String url) {
        if (timeoutHandler != null && timeoutRunnable != null) {
            timeoutHandler.removeCallbacks(timeoutRunnable);
        }

        CookieManager cookieManager = CookieManager.getInstance();
        String cookiesStr = cookieManager.getCookie(url);
        if (cookiesStr == null || cookiesStr.isEmpty()) {
            cookiesStr = cookieManager.getCookie("https://" + CAFEYN_DOMAIN);
        }
        if (cookiesStr == null || cookiesStr.isEmpty()) {
            cookiesStr = cookieManager.getCookie("https://mediatheques.sudestavenir.fr");
        }
        Log.d(TAG, "Cookies: " + (cookiesStr != null ? cookiesStr.substring(0, Math.min(200, cookiesStr.length())) + "..." : "null"));

        JSObject result = new JSObject();
        String jwt = null;

        // Try extracting token query parameter from final redirect url first
        if (url != null && url.contains("token=")) {
            try {
                android.net.Uri uri = android.net.Uri.parse(url);
                jwt = uri.getQueryParameter("token");
                if (jwt != null && !jwt.isEmpty()) {
                    Log.d(TAG, "Extracted JWT token from redirected URL query param: " + jwt.substring(0, Math.min(20, jwt.length())) + "...");
                }
            } catch (Exception ue) {
                Log.w(TAG, "Could not parse token from redirect URL: " + ue.getMessage());
            }
        }

        if (cookiesStr != null && !cookiesStr.isEmpty()) {
            try {
                JSONArray cookieArray = new JSONArray();
                String[] pairs = cookiesStr.split(";");
                for (String pair : pairs) {
                    String[] parts = pair.trim().split("=", 2);
                    if (parts.length == 2) {
                        JSONObject cookie = new JSONObject();
                        cookie.put("name", parts[0].trim());
                        cookie.put("value", parts[1].trim());
                        cookie.put("domain", CAFEYN_DOMAIN);
                        cookie.put("path", "/");
                        cookieArray.put(cookie);
                    }
                }
                result.put("success", true);
                result.put("cookies", cookieArray);
                result.put("cookieHeader", cookiesStr);
                
                // Get JWT token from cookies if not extracted from URL yet
                if (jwt == null) {
                    String[] cookiePairs = cookiesStr.split(";");
                    for (String pair : cookiePairs) {
                        if (pair.contains("Cafeyn_authtoken_V2")) {
                            String[] parts = pair.trim().split("=", 2);
                            if (parts.length == 2) {
                                jwt = parts[1].trim();
                            }
                        }
                    }
                }
            } catch (JSONException e) {
                result.put("success", false);
                result.put("error", "Cookie parsing error: " + e.getMessage());
            }
        }

        if (jwt != null && !jwt.isEmpty()) {
            result.put("success", true);
            result.put("jwt", jwt);
        } else if (result.optBoolean("success", false) == false) {
            result.put("success", false);
            result.put("error", "No cookies or token found after login");
        }

        cleanup();

        if (pendingCall != null) {
            pendingCall.resolve(result);
            pendingCall = null;
        }
    }

    private void handleLoginFailure(String error) {
        if (timeoutHandler != null && timeoutRunnable != null) {
            timeoutHandler.removeCallbacks(timeoutRunnable);
        }

        cleanup();

        if (pendingCall != null) {
            JSObject result = new JSObject();
            result.put("success", false);
            result.put("error", error);
            pendingCall.resolve(result);
            pendingCall = null;
        }
    }

    private boolean hasCafeynToken(String url) {
        if (url != null && url.contains("token=")) {
            return true;
        }
        CookieManager cookieManager = CookieManager.getInstance();
        String cookiesStr = cookieManager.getCookie("https://" + CAFEYN_DOMAIN);
        if (cookiesStr != null && cookiesStr.contains("Cafeyn_authtoken_V2")) {
            return true;
        }
        String cookiesStr2 = cookieManager.getCookie("https://www.cafeyn.co");
        if (cookiesStr2 != null && cookiesStr2.contains("Cafeyn_authtoken_V2")) {
            return true;
        }
        return false;
    }

    private void cleanup() {
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
    }

    private String escapeJs(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("'", "\\'").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r");
    }

    @PluginMethod()
    public void httpRequest(PluginCall call) {
        String urlStr = call.getString("url", "");
        String method = call.getString("method", "GET");
        JSObject bodyObj = call.getObject("body", null);
        JSObject headersObj = call.getObject("headers", null);

        if (urlStr.isEmpty()) {
            JSObject result = new JSObject();
            result.put("error", "URL required");
            call.resolve(result);
            return;
        }

        Log.i(TAG, "HTTP Request: " + method.toUpperCase() + " " + urlStr);

        new Thread(() -> {
            try {
                URL url = new URL(urlStr);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setInstanceFollowRedirects(false);
                conn.setRequestMethod(method.toUpperCase());
                conn.setConnectTimeout(30000);
                conn.setReadTimeout(30000);

                // Set headers
                String jsCookie = null;
                if (headersObj != null) {
                    java.util.Iterator<String> keys = headersObj.keys();
                    while (keys.hasNext()) {
                        String key = keys.next();
                        String val = headersObj.getString(key);
                        if (key.equalsIgnoreCase("Cookie")) {
                            jsCookie = val;
                        } else {
                            conn.setRequestProperty(key, val);
                        }
                    }
                }

                // Merge JS Cookie header with WebView cookies
                StringBuilder mergedCookies = new StringBuilder();
                if (jsCookie != null && !jsCookie.isEmpty()) {
                    mergedCookies.append(jsCookie);
                }
                try {
                    String webViewCookie = android.webkit.CookieManager.getInstance().getCookie(urlStr);
                    if (webViewCookie != null && !webViewCookie.isEmpty()) {
                        String[] pairs = webViewCookie.split(";");
                        for (String pair : pairs) {
                            String trimmedPair = pair.trim();
                            if (!trimmedPair.isEmpty() && mergedCookies.indexOf(trimmedPair) == -1) {
                                if (mergedCookies.length() > 0) {
                                    mergedCookies.append("; ");
                                }
                                mergedCookies.append(trimmedPair);
                            }
                        }
                    }
                } catch (Exception ce) {
                    Log.w(TAG, "Error retrieving WebView cookies: " + ce.getMessage());
                }

                if (mergedCookies.length() > 0) {
                    conn.setRequestProperty("Cookie", mergedCookies.toString());
                    Log.i(TAG, "Merged Cookie Header: " + mergedCookies.toString());
                }

                // Set body for POST/PUT
                String bodyStr = call.getString("body", null);
                if (bodyStr != null && (method.equalsIgnoreCase("POST") || method.equalsIgnoreCase("PUT"))) {
                    conn.setDoOutput(true);
                    OutputStream os = conn.getOutputStream();
                    os.write(bodyStr.getBytes("UTF-8"));
                    os.flush();
                    os.close();
                    Log.i(TAG, "Request Body size: " + bodyStr.length() + " chars");
                }

                int status = conn.getResponseCode();
                Log.i(TAG, "Response Status Code: " + status);

                int redirectCount = 0;
                String finalCookies = mergedCookies.toString();
                while ((status == 301 || status == 302 || status == 303 || status == 307 || status == 308) && redirectCount < 5) {
                    redirectCount++;
                    String location = conn.getHeaderField("Location");
                    if (location == null || location.isEmpty()) {
                        break;
                    }

                    URL base = conn.getURL();
                    URL next = new URL(base, location);

                    Log.i(TAG, "Redirecting (" + redirectCount + ") to: " + next.toExternalForm());

                    try {
                        java.util.Map<String, java.util.List<String>> redirectHeaders = conn.getHeaderFields();
                        String redirectSourceUrl = conn.getURL().toExternalForm();
                        for (java.util.Map.Entry<String, java.util.List<String>> entry : redirectHeaders.entrySet()) {
                            String key = entry.getKey();
                            if (key != null && key.equalsIgnoreCase("Set-Cookie")) {
                                for (String cookieVal : entry.getValue()) {
                                    android.webkit.CookieManager.getInstance().setCookie(redirectSourceUrl, cookieVal);
                                }
                            }
                        }
                        android.webkit.CookieManager.getInstance().flush();
                    } catch (Exception ce) {
                        Log.w(TAG, "Error storing intermediate redirect cookies: " + ce.getMessage());
                    }

                    conn = (HttpURLConnection) next.openConnection();
                    conn.setInstanceFollowRedirects(false);
                    conn.setRequestMethod("GET");
                    conn.setConnectTimeout(30000);
                    conn.setReadTimeout(30000);

                    StringBuilder newCookies = new StringBuilder(finalCookies);
                    try {
                        String redirectUrl = next.toExternalForm();
                        String webViewCookie = android.webkit.CookieManager.getInstance().getCookie(redirectUrl);
                        if (webViewCookie != null && !webViewCookie.isEmpty()) {
                            String[] pairs = webViewCookie.split(";");
                            for (String pair : pairs) {
                                String trimmedPair = pair.trim();
                                if (!trimmedPair.isEmpty() && newCookies.indexOf(trimmedPair) == -1) {
                                    if (newCookies.length() > 0) {
                                        newCookies.append("; ");
                                    }
                                    newCookies.append(trimmedPair);
                                }
                            }
                        }
                    } catch (Exception ce) {
                        Log.w(TAG, "Error merging redirect WebView cookies: " + ce.getMessage());
                    }
                    finalCookies = newCookies.toString();

                    if (!finalCookies.isEmpty()) {
                        conn.setRequestProperty("Cookie", finalCookies);
                    }

                    if (headersObj != null) {
                        java.util.Iterator<String> keys = headersObj.keys();
                        while (keys.hasNext()) {
                            String key = keys.next();
                            if (!key.equalsIgnoreCase("Cookie") && !key.equalsIgnoreCase("Content-Type")) {
                                conn.setRequestProperty(key, headersObj.getString(key));
                            }
                        }
                    }

                    status = conn.getResponseCode();
                    Log.i(TAG, "Redirect Response Status Code: " + status);
                }

                // Store response cookies
                java.util.Map<String, java.util.List<String>> headerFields = conn.getHeaderFields();
                String currentUrl = conn.getURL().toExternalForm();
                for (java.util.Map.Entry<String, java.util.List<String>> entry : headerFields.entrySet()) {
                    String key = entry.getKey();
                    if (key != null && key.equalsIgnoreCase("Set-Cookie")) {
                        for (String cookieVal : entry.getValue()) {
                            Log.i(TAG, "Response Set-Cookie: " + cookieVal);
                            try {
                                android.webkit.CookieManager.getInstance().setCookie(currentUrl, cookieVal);
                            } catch (Exception ce) {
                                Log.w(TAG, "Error storing response cookie: " + ce.getMessage());
                            }
                        }
                        try {
                            android.webkit.CookieManager.getInstance().flush();
                        } catch (Exception ce) {}
                    }
                }

                BufferedReader br;
                if (status >= 400) {
                    br = new BufferedReader(new InputStreamReader(conn.getErrorStream()));
                } else {
                    br = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                }
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = br.readLine()) != null) {
                    sb.append(line);
                }
                br.close();

                Log.i(TAG, "Response Body size: " + sb.length() + " chars");

                JSObject result = new JSObject();
                result.put("status", status);
                result.put("data", sb.toString());
                result.put("headers", headerFields);
                result.put("cookies", finalCookies);

                call.resolve(result);

            } catch (Exception e) {
                Log.e(TAG, "HTTP Request error", e);
                JSObject result = new JSObject();
                result.put("error", e.getMessage());
                call.resolve(result);
            }
        });
    }

    private android.content.SharedPreferences getEncryptedPrefs(Context ctx) throws GeneralSecurityException, IOException {
        return getEncryptedPrefs(ctx, "cafeyn_encrypted");
    }

    private android.content.SharedPreferences getEncryptedPrefs(Context ctx, String name) throws GeneralSecurityException, IOException {
        String masterKeyAlias = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC);
        return EncryptedSharedPreferences.create(
            name,
            masterKeyAlias,
            ctx,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        );
    }

    @PluginMethod()
    public void saveCredentials(PluginCall call) {
        String username = call.getString("username", "");
        String password = call.getString("password", "");

        try {
            android.content.SharedPreferences prefs = getEncryptedPrefs(getContext());
            prefs.edit()
                .putString("cafeyn_username", username)
                .putString("cafeyn_password", password)
                .apply();
            Log.d(TAG, "saveCredentials: identifiants Cafeyn enregistrés via EncryptedSharedPreferences");

            JSObject result = new JSObject();
            result.put("success", true);
            call.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "saveCredentials error", e);
            JSObject result = new JSObject();
            result.put("success", false);
            result.put("error", e.getMessage());
            call.resolve(result);
        }
    }

    @PluginMethod()
    public void getCredentials(PluginCall call) {
        try {
            android.content.SharedPreferences prefs = getEncryptedPrefs(getContext());
            String username = prefs.getString("cafeyn_username", "");
            String password = prefs.getString("cafeyn_password", "");
            Log.d(TAG, "getCredentials: lecture OK, username=" + (username.isEmpty() ? "(vide)" : "(présent)"));

            JSObject result = new JSObject();
            result.put("success", true);
            result.put("username", username);
            result.put("password", password);
            call.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "getCredentials error", e);
            JSObject result = new JSObject();
            result.put("success", false);
            result.put("error", e.getMessage());
            call.resolve(result);
        }
    }

    @PluginMethod()
    public void clearCredentials(PluginCall call) {
        try {
            getEncryptedPrefs(getContext()).edit().clear().apply();
            Log.d(TAG, "clearCredentials: identifiants Cafeyn supprimés");

            JSObject result = new JSObject();
            result.put("success", true);
            call.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "clearCredentials error", e);
            JSObject result = new JSObject();
            result.put("success", false);
            result.put("error", e.getMessage());
            call.resolve(result);
        }
    }

    // ===== JWT STORAGE =====

    @PluginMethod()
    public void saveJwt(PluginCall call) {
        String token = call.getString("token", "");
        String expiry = call.getString("expiry", "");

        try {
            android.content.SharedPreferences prefs = getEncryptedPrefs(getContext(), JWT_PREFS_NAME);
            prefs.edit()
                .putString(JWT_KEY, token)
                .putString(JWT_EXPIRY_KEY, expiry)
                .apply();
            Log.d(TAG, "saveJwt: JWT Cafeyn enregistré");

            JSObject result = new JSObject();
            result.put("success", true);
            call.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "saveJwt error", e);
            JSObject result = new JSObject();
            result.put("success", false);
            result.put("error", e.getMessage());
            call.resolve(result);
        }
    }

    @PluginMethod()
    public void getJwt(PluginCall call) {
        try {
            android.content.SharedPreferences prefs = getEncryptedPrefs(getContext(), JWT_PREFS_NAME);
            String token = prefs.getString(JWT_KEY, "");
            String expiry = prefs.getString(JWT_EXPIRY_KEY, "");

            JSObject result = new JSObject();
            result.put("success", true);
            result.put("token", token);
            result.put("expiry", expiry);
            call.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "getJwt error", e);
            JSObject result = new JSObject();
            result.put("success", false);
            result.put("error", e.getMessage());
            call.resolve(result);
        }
    }

    @PluginMethod()
    public void clearJwt(PluginCall call) {
        try {
            getEncryptedPrefs(getContext(), JWT_PREFS_NAME).edit().clear().apply();
            Log.d(TAG, "clearJwt: JWT Cafeyn supprimé");

            JSObject result = new JSObject();
            result.put("success", true);
            call.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "clearJwt error", e);
            JSObject result = new JSObject();
            result.put("success", false);
            result.put("error", e.getMessage());
            call.resolve(result);
        }
    }
}
