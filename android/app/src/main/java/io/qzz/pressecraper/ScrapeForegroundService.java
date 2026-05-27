package io.qzz.pressecraper;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.util.Log;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKeys;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

public class ScrapeForegroundService extends Service {

    private static final String TAG = "ScrapeService";
    private static final String BNF_AUTH_URL = "https://bnf.idm.oclc.org/login?url=https://nouveau.europresse.com/access/ip/default.aspx?un=D000067U_1";
    private static final String EUROPRESSE_DOMAIN = "nouveau-europresse-com.bnf.idm.oclc.org";
    private static final String CHANNEL_ID = "presse_scraper";
    private static final int NOTIF_ID_PROGRESS = 1001;
    private static final int NOTIF_ID_COMPLETE = 1002;
    private static final long TIMEOUT_MS = 130_000;

    private WebView webView;
    private Handler mainHandler;
    private Runnable timeoutRunnable;
    private boolean completed = false;
    private static volatile boolean isRunning = false;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String url = intent != null ? intent.getStringExtra("url") : null;
        if (url == null || url.isEmpty()) {
            stopSelf();
            return START_NOT_STICKY;
        }

        if (isRunning) {
            Log.w(TAG, "Already running, ignoring duplicate start: " + url);
            return START_NOT_STICKY;
        }
        isRunning = true;

        Log.i(TAG, "Starting background scrape for: " + url);

        startForeground(NOTIF_ID_PROGRESS, buildProgressNotification("Préparation..."));

        // Timeout
        timeoutRunnable = () -> {
            if (!completed) {
                Log.w(TAG, "Scrape timeout reached");
                isRunning = false;
                showFinalNotification("❌ Temps écoulé", "Le téléchargement a pris trop de temps", null);
                cleanup();
                stopSelf();
            }
        };
        mainHandler.postDelayed(timeoutRunnable, TIMEOUT_MS);

        // Inject credentials from encrypted storage into localStorage so the app can find them
        injectCredentialsThenStart(url);

        return START_NOT_STICKY;
    }

    private void injectCredentialsThenStart(String url) {
        mainHandler.post(() -> {
            try {
                // Read encrypted credentials
                String bnfUser = "", bnfPass = "", cafeynUser = "", cafeynPass = "";

                try {
                    String mk = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC);
                    SharedPreferences bnfPrefs = EncryptedSharedPreferences.create(
                        "bnf_secure_prefs", mk, this,
                        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
                    );
                    bnfUser = bnfPrefs.getString("bnf_username", "");
                    bnfPass = bnfPrefs.getString("bnf_password", "");
                } catch (Exception e) {
                    Log.w(TAG, "Could not read BnF encrypted prefs: " + e.getMessage());
                }

                try {
                    String mk = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC);
                    SharedPreferences cafeynPrefs = EncryptedSharedPreferences.create(
                        "cafeyn_encrypted", mk, this,
                        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
                    );
                    cafeynUser = cafeynPrefs.getString("cafeyn_username", "");
                    cafeynPass = cafeynPrefs.getString("cafeyn_password", "");
                } catch (Exception e) {
                    Log.w(TAG, "Could not read Cafeyn encrypted prefs: " + e.getMessage());
                }

                // Read Cafeyn JWT from encrypted storage
                String cafeynJwt = "", cafeynJwtExpiry = "";
                try {
                    String mk = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC);
                    SharedPreferences jwtPrefs = EncryptedSharedPreferences.create(
                        "cafeyn_jwt_encrypted", mk, this,
                        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
                    );
                    cafeynJwt = jwtPrefs.getString("cafeyn_jwt", "");
                    cafeynJwtExpiry = jwtPrefs.getString("cafeyn_jwt_expiry", "");
                } catch (Exception e) {
                    Log.w(TAG, "Could not read Cafeyn JWT: " + e.getMessage());
                }

                setupHeadlessWebView(url, bnfUser, bnfPass, cafeynUser, cafeynPass, cafeynJwt, cafeynJwtExpiry);

            } catch (Exception e) {
                Log.e(TAG, "Error injecting credentials", e);
                showFinalNotification("❌ Erreur", e.getMessage(), null);
                cleanup();
                stopSelf();
            }
        });
    }

    private void setupHeadlessWebView(String targetUrl,
                                       String bnfUser, String bnfPass,
                                       String cafeynUser, String cafeynPass,
                                       String cafeynJwt, String cafeynJwtExpiry) {
        webView = new WebView(this);
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setDatabaseEnabled(true);
        webView.getSettings().setLoadWithOverviewMode(true);
        webView.getSettings().setUseWideViewPort(true);
        webView.getSettings().setUserAgentString(
            "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
        );

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, true);

        // Expose native bridge to JS
        webView.addJavascriptInterface(new HeadlessBridge(), "HeadlessBridge");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                Log.i(TAG, "WebView page loaded: " + url);

                // Inject the Capacitor mock and session data, then trigger scraping
                String escapedBnfUser = escapeJs(bnfUser);
                String escapedBnfPass = escapeJs(bnfPass);
                String escapedCafeynUser = escapeJs(cafeynUser);
                String escapedCafeynPass = escapeJs(cafeynPass);
                String escapedTargetUrl = escapeJs(targetUrl);
                String escapedJwt = escapeJs(cafeynJwt);
                String escapedJwtExpiry = escapeJs(cafeynJwtExpiry);

                String injectJs =
                    "(function() {" +
                    "  if (window.__headlessInjected) return;" +
                    "  window.__headlessInjected = true;" +
                    "  window._headlessMode = true;" +
                    "  var bridge = window.HeadlessBridge;" +
                    "  window.Capacitor = window.Capacitor || {};" +
                    "  window.Capacitor.Plugins = window.Capacitor.Plugins || {};" +
                    "  window.Capacitor.Plugins.BnfLogin = {" +
                    "    httpRequest: function(o){return new Promise(function(r){r(JSON.parse(bridge.httpRequest(o.url,o.method||'GET',JSON.stringify(o.headers||{}),o.body||'')));});}," +
                    "    showNotification: function(o){bridge.showNotification(o.title,o.body,o.articleId||'');return Promise.resolve({success:true});}," +
                    "    printHtmlToPdf: function(o){return new Promise(function(r){r(JSON.parse(bridge.printHtmlToPdf(o.html,o.filename)));});}," +
                    "    getWebViewUserAgent: function(){return Promise.resolve({userAgent:bridge.getWebViewUserAgent()});}," +
                    "    downloadAndExtractBpcRules: function(){return new Promise(function(r){r(JSON.parse(bridge.downloadAndExtractBpcRules()));});}," +
                    "    login: function(o){return new Promise(function(r){r(JSON.parse(bridge.login(o.username,o.password)));});}," +
                    "    getCredentials: function(){return Promise.resolve({username:'" + escapedBnfUser + "',password:'" + escapedBnfPass + "'});}," +
                    "    saveCredentials: function(){return Promise.resolve({success:true});}," +
                    "    clearCredentials: function(){return Promise.resolve({success:true});}," +
                    "    requestNotificationPermission: function(){return Promise.resolve({success:true});}," +
                    "    openPdfFile: function(){return Promise.resolve({success:false,error:'Not available in headless'});}" +
                    "  }; " +
                    "  window.Capacitor.Plugins.CafeynLogin = {" +
                    "    httpRequest: function(o){return new Promise(function(r){r(JSON.parse(bridge.httpRequest(o.url,o.method||'GET',JSON.stringify(o.headers||{}),o.body||'')));});}," +
                    "    getCredentials: function(){return Promise.resolve({username:'" + escapedCafeynUser + "',password:'" + escapedCafeynPass + "'});}," +
                    "    saveCredentials: function(){return Promise.resolve({success:true});}," +
                    "    clearCredentials: function(){return Promise.resolve({success:true});}," +
                    "    saveJwt: function(){return Promise.resolve({success:true});}," +
                    "    getJwt: function(){return Promise.resolve({token:'',expiry:''});}," +
                    "    clearJwt: function(){return Promise.resolve({success:true});}" +
                    "  }; " +
                    "  window.Capacitor.Plugins.Share = {" +
                    "    share: function(){return Promise.resolve({});}" +
                    "  }; " +
                    // Inject Cafeyn JWT into localStorage and activate it
                    "  if ('" + escapedJwt + "') {" +
                    "    localStorage.setItem('cafeyn_jwt', '" + escapedJwt + "');" +
                    "    localStorage.setItem('cafeyn_jwt_expiry', '" + escapedJwtExpiry + "');" +
                    "    if (typeof window.Cafeyn !== 'undefined' && window.Cafeyn.saveToken) {" +
                    "      window.Cafeyn.saveToken('" + escapedJwt + "', 30);" +
                    "    }" +
                    "  }" +
                    // Inject shared URL and trigger scraping
                    "  var urlInput = document.getElementById('urlInput');" +
                    "  if (urlInput) urlInput.value = '" + escapedTargetUrl + "';" +
                    "  console.log('[HEADLESS] Starting scrape for:', '" + escapedTargetUrl + "');" +
                    // Call startScraping directly
                    "  if (typeof window.startScraping === 'function') {" +
                    "    setTimeout(function() { window.startScraping(); }, 800);" +
                    "  }" +
                    "})();";

                view.evaluateJavascript(injectJs, null);
            }
        });

        // Load the app
        webView.loadUrl("file:///android_asset/public/index.html");
    }

    // ─── Native Bridge (called from JS via @JavascriptInterface) ───

    private class HeadlessBridge {
        @JavascriptInterface
        public String httpRequest(String urlStr, String method, String headersJson, String body) {
            try {
                Log.d(TAG, "httpRequest: " + method + " " + urlStr);
                URL url = new URL(urlStr);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setInstanceFollowRedirects(false);
                conn.setRequestMethod(method.toUpperCase());
                conn.setConnectTimeout(30000);
                conn.setReadTimeout(30000);

                // Parse and set headers
                String jsCookie = null;
                if (headersJson != null && !headersJson.isEmpty()) {
                    try {
                        JSONObject h = new JSONObject(headersJson);
                        for (java.util.Iterator<String> it = h.keys(); it.hasNext(); ) {
                            String key = it.next();
                            String val = h.getString(key);
                            if (key.equalsIgnoreCase("Cookie")) {
                                jsCookie = val;
                            } else {
                                conn.setRequestProperty(key, val);
                            }
                        }
                    } catch (Exception e) {
                        Log.w(TAG, "Error parsing headers: " + e.getMessage());
                    }
                }

                // Merge cookies from CookieManager
                StringBuilder mergedCookies = new StringBuilder();
                if (jsCookie != null && !jsCookie.isEmpty()) {
                    mergedCookies.append(jsCookie);
                }
                try {
                    String webViewCookie = CookieManager.getInstance().getCookie(urlStr);
                    if (webViewCookie != null && !webViewCookie.isEmpty()) {
                        for (String pair : webViewCookie.split(";")) {
                            String trimmed = pair.trim();
                            if (!trimmed.isEmpty() && mergedCookies.indexOf(trimmed) == -1) {
                                if (mergedCookies.length() > 0) mergedCookies.append("; ");
                                mergedCookies.append(trimmed);
                            }
                        }
                    }
                } catch (Exception e) {
                    Log.w(TAG, "Error merging cookies: " + e.getMessage());
                }
                if (mergedCookies.length() > 0) {
                    conn.setRequestProperty("Cookie", mergedCookies.toString());
                }

                // Set body for POST/PUT
                if (body != null && !body.isEmpty() && (method.equalsIgnoreCase("POST") || method.equalsIgnoreCase("PUT"))) {
                    conn.setDoOutput(true);
                    OutputStream os = conn.getOutputStream();
                    os.write(body.getBytes("UTF-8"));
                    os.flush();
                    os.close();
                }

                int status = conn.getResponseCode();

                // Follow redirects manually (like existing plugin does)
                int redirectCount = 0;
                String currentCookies = mergedCookies.toString();
                while ((status == 301 || status == 302 || status == 303 || status == 307 || status == 308) && redirectCount < 5) {
                    redirectCount++;
                    String location = conn.getHeaderField("Location");
                    if (location == null || location.isEmpty()) break;

                    URL base = conn.getURL();
                    URL next = new URL(base, location);

                    // Store Set-Cookie from redirect response
                    try {
                        Map<String, java.util.List<String>> rHeaders = conn.getHeaderFields();
                        String srcUrl = conn.getURL().toExternalForm();
                        for (Map.Entry<String, java.util.List<String>> e : rHeaders.entrySet()) {
                            if (e.getKey() != null && e.getKey().equalsIgnoreCase("Set-Cookie")) {
                                for (String cv : e.getValue()) {
                                    CookieManager.getInstance().setCookie(srcUrl, cv);
                                }
                            }
                        }
                        CookieManager.getInstance().flush();
                    } catch (Exception e) {
                        Log.w(TAG, "Error storing redirect cookies: " + e.getMessage());
                    }

                    conn = (HttpURLConnection) next.openConnection();
                    conn.setInstanceFollowRedirects(false);
                    conn.setRequestMethod("GET");
                    conn.setConnectTimeout(30000);
                    conn.setReadTimeout(30000);

                    StringBuilder newCookies = new StringBuilder(currentCookies);
                    try {
                        String wc = CookieManager.getInstance().getCookie(next.toExternalForm());
                        if (wc != null && !wc.isEmpty()) {
                            for (String pair : wc.split(";")) {
                                String trimmed = pair.trim();
                                if (!trimmed.isEmpty() && newCookies.indexOf(trimmed) == -1) {
                                    if (newCookies.length() > 0) newCookies.append("; ");
                                    newCookies.append(trimmed);
                                }
                            }
                        }
                    } catch (Exception e) {
                        Log.w(TAG, "Error merging redirect cookies: " + e.getMessage());
                    }
                    currentCookies = newCookies.toString();
                    if (!currentCookies.isEmpty()) {
                        conn.setRequestProperty("Cookie", currentCookies);
                    }

                    status = conn.getResponseCode();
                }

                // Store final response cookies
                try {
                    Map<String, java.util.List<String>> rHeaders = conn.getHeaderFields();
                    String finalUrl = conn.getURL().toExternalForm();
                    for (Map.Entry<String, java.util.List<String>> e : rHeaders.entrySet()) {
                        if (e.getKey() != null && e.getKey().equalsIgnoreCase("Set-Cookie")) {
                            for (String cv : e.getValue()) {
                                CookieManager.getInstance().setCookie(finalUrl, cv);
                            }
                        }
                    }
                    CookieManager.getInstance().flush();
                } catch (Exception e) {
                    Log.w(TAG, "Error storing final cookies: " + e.getMessage());
                }

                // Read response body
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

                JSONObject result = new JSONObject();
                result.put("status", status);
                result.put("data", sb.toString());
                return result.toString();

            } catch (Exception e) {
                Log.e(TAG, "httpRequest error: " + e.getMessage());
                try {
                    JSONObject err = new JSONObject();
                    err.put("error", e.getMessage());
                    return err.toString();
                } catch (Exception je) {
                    return "{\"error\":\"Internal error\"}";
                }
            }
        }

        @JavascriptInterface
        public void showNotification(String title, String body, String articleId) {
            Log.i(TAG, "showNotification: " + title);
            showFinalNotification(title, body, articleId);
            onScrapeComplete(articleId, title);
        }

        @JavascriptInterface
        public String printHtmlToPdf(String html, String filename) {
            try {
                final CountDownLatch latch = new CountDownLatch(1);
                final String[] resultPath = {null};
                final String[] resultError = {null};

                mainHandler.post(() -> {
                    try {
                        WebView printWv = new WebView(ScrapeForegroundService.this);
                        printWv.getSettings().setJavaScriptEnabled(true);

                        String styledHtml = "<html><head><meta charset='UTF-8'>" +
                            "<style>" +
                            "body { font-family: 'Georgia', serif; padding: 40px; color: #111; line-height: 1.8; font-size: 16px; }" +
                            "h1 { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 26px; font-weight: 700; }" +
                            "p { margin-bottom: 16px; text-align: justify; }" +
                            "img { max-width: 100%; height: auto; }" +
                            ".source { font-style: italic; color: #666; font-size: 14px; }" +
                            "</style></head><body>" + html + "</body></html>";

                        printWv.loadDataWithBaseURL("file:///android_asset/", styledHtml, "text/html", "UTF-8", null);
                        printWv.setWebViewClient(new WebViewClient() {
                            @Override
                            public void onPageFinished(WebView view, String url) {
                                PrintAttributes attrs = new PrintAttributes.Builder()
                                    .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                                    .setResolution(new PrintAttributes.Resolution("pdf", "pdf", 600, 600))
                                    .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                                    .build();

                                PrintDocumentAdapter adapter = printWv.createPrintDocumentAdapter(filename);
                                File pdfFile = new File(getCacheDir(), filename);

                                android.print.PDFPrintHelper.print(adapter, attrs, pdfFile,
                                    new android.print.PDFPrintHelper.PDFPrintCallback() {
                                        @Override
                                        public void onSuccess(String path) {
                                            resultPath[0] = path;
                                            latch.countDown();
                                            printWv.destroy();
                                        }

                                        @Override
                                        public void onError(String error) {
                                            resultError[0] = error;
                                            latch.countDown();
                                            printWv.destroy();
                                        }
                                    });
                            }
                        });
                    } catch (Exception e) {
                        resultError[0] = e.getMessage();
                        latch.countDown();
                    }
                });

                boolean awaited = latch.await(60, TimeUnit.SECONDS);
                JSONObject res = new JSONObject();
                if (resultPath[0] != null) {
                    res.put("success", true);
                    res.put("path", resultPath[0]);
                } else {
                    res.put("success", false);
                    res.put("error", resultError[0] != null ? resultError[0] : "PDF timeout");
                }
                return res.toString();

            } catch (Exception e) {
                try {
                    JSONObject err = new JSONObject();
                    err.put("success", false);
                    err.put("error", e.getMessage());
                    return err.toString();
                } catch (Exception je) {
                    return "{\"success\":false,\"error\":\"Internal error\"}";
                }
            }
        }

        @JavascriptInterface
        public String getWebViewUserAgent() {
            try {
                return android.webkit.WebSettings.getDefaultUserAgent(ScrapeForegroundService.this);
            } catch (Exception e) {
                return "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36";
            }
        }

        @JavascriptInterface
        public String login(final String username, final String password) {
            try {
                final CountDownLatch latch = new CountDownLatch(1);
                final JSONObject[] result = {null};

                mainHandler.post(() -> {
                    try {
                        WebView loginWv = new WebView(ScrapeForegroundService.this);
                        loginWv.getSettings().setJavaScriptEnabled(true);
                        loginWv.getSettings().setDomStorageEnabled(true);
                        loginWv.getSettings().setLoadWithOverviewMode(true);
                        loginWv.getSettings().setUseWideViewPort(true);

                        CookieManager cm = CookieManager.getInstance();
                        cm.setAcceptCookie(true);
                        cm.setAcceptThirdPartyCookies(loginWv, true);

                        String safeUser = escapeJs(username);
                        String safePass = escapeJs(password);

                        loginWv.setWebViewClient(new WebViewClient() {
                            @Override
                            public void onPageFinished(WebView view, String url) {
                                super.onPageFinished(view, url);

                                if (url.contains(EUROPRESSE_DOMAIN) && !url.contains("login")) {
                                    try {
                                        String cookiesStr = CookieManager.getInstance().getCookie("https://" + EUROPRESSE_DOMAIN);
                                        JSONObject res = new JSONObject();
                                        if (cookiesStr != null && !cookiesStr.isEmpty()) {
                                            JSONArray cookieArray = new JSONArray();
                                            String[] pairs = cookiesStr.split(";");
                                            for (String pair : pairs) {
                                                String[] parts = pair.trim().split("=", 2);
                                                if (parts.length == 2) {
                                                    JSONObject cookie = new JSONObject();
                                                    cookie.put("name", parts[0].trim());
                                                    cookie.put("value", parts[1].trim());
                                                    cookie.put("domain", EUROPRESSE_DOMAIN);
                                                    cookie.put("path", "/");
                                                    cookieArray.put(cookie);
                                                }
                                            }
                                            res.put("success", true);
                                            res.put("cookies", cookieArray);
                                            res.put("cookieHeader", cookiesStr);
                                        } else {
                                            res.put("success", false);
                                            res.put("error", "No cookies found after login");
                                        }
                                        result[0] = res;
                                        latch.countDown();
                                        view.destroy();
                                    } catch (Exception e) {
                                        try {
                                            JSONObject err = new JSONObject();
                                            err.put("success", false);
                                            err.put("error", e.getMessage());
                                            result[0] = err;
                                        } catch (Exception ignored) {}
                                        latch.countDown();
                                        view.destroy();
                                    }
                                    return;
                                }

                                view.evaluateJavascript(
                                    "(function() {" +
                                    "  var u = document.querySelector(\"input[type='text'], input[id*='user'], input[name*='user'], input[name='username'], input[name='j_username']\");" +
                                    "  var p = document.querySelector(\"input[type='password'], input[name='j_password']\");" +
                                    "  if (u && p) {" +
                                    "    u.value = '" + safeUser + "';" +
                                    "    u.dispatchEvent(new Event('input', {bubbles: true}));" +
                                    "    u.dispatchEvent(new Event('change', {bubbles: true}));" +
                                    "    p.value = '" + safePass + "';" +
                                    "    p.dispatchEvent(new Event('input', {bubbles: true}));" +
                                    "    p.dispatchEvent(new Event('change', {bubbles: true}));" +
                                    "    var btn = document.querySelector(\"input[type='submit'], button[type='submit'], button.submit, .btn-primary\");" +
                                    "    if (btn) { btn.click(); return 'submitted'; }" +
                                    "    var form = document.querySelector('form');" +
                                    "    if (form) { form.submit(); return 'submitted'; }" +
                                    "    return 'no_submit';" +
                                    "  }" +
                                    "  return 'no_fields';" +
                                    "})()",
                                    fillResult -> {
                                        Log.d(TAG, "Login form fill: " + fillResult);
                                    }
                                );
                            }
                        });

                        loginWv.loadUrl(BNF_AUTH_URL);
                    } catch (Exception e) {
                        try {
                            JSONObject err = new JSONObject();
                            err.put("success", false);
                            err.put("error", e.getMessage());
                            result[0] = err;
                        } catch (Exception ignored) {}
                        latch.countDown();
                    }
                });

                boolean awaited = latch.await(60, TimeUnit.SECONDS);
                if (result[0] != null) {
                    return result[0].toString();
                }
                JSONObject timeout = new JSONObject();
                timeout.put("success", false);
                timeout.put("error", "Login timeout");
                return timeout.toString();

            } catch (Exception e) {
                try {
                    JSONObject err = new JSONObject();
                    err.put("success", false);
                    err.put("error", e.getMessage());
                    return err.toString();
                } catch (Exception je) {
                    return "{\"success\":false,\"error\":\"Login failed\"}";
                }
            }
        }

        @JavascriptInterface
        public String downloadAndExtractBpcRules() {
            try {
                String zipUrl = "https://gitflic.ru/project/magnolia1234/bpc_uploads/blob/raw?file=bypass-paywalls-chrome-clean-master.zip";
                URL url = new URL(zipUrl);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("GET");
                conn.setConnectTimeout(30000);
                conn.setReadTimeout(30000);
                conn.setRequestProperty("User-Agent", "Mozilla/5.0");
                conn.setInstanceFollowRedirects(true);

                int status = conn.getResponseCode();
                int redirects = 0;
                while ((status == 301 || status == 302 || status == 303 || status == 307 || status == 308) && redirects < 5) {
                    redirects++;
                    String location = conn.getHeaderField("Location");
                    url = new URL(url, location);
                    conn = (HttpURLConnection) url.openConnection();
                    conn.setRequestMethod("GET");
                    conn.setConnectTimeout(30000);
                    conn.setReadTimeout(30000);
                    conn.setRequestProperty("User-Agent", "Mozilla/5.0");
                    conn.setInstanceFollowRedirects(true);
                    status = conn.getResponseCode();
                }

                if (status != 200) {
                    JSONObject err = new JSONObject();
                    err.put("success", false);
                    err.put("error", "HTTP " + status);
                    return err.toString();
                }

                java.util.zip.ZipInputStream zis = new java.util.zip.ZipInputStream(conn.getInputStream());
                java.util.zip.ZipEntry entry;
                String sitesJs = null, contentScriptJs = null, contentScriptFrJs = null;
                byte[] buffer = new byte[8192];

                while ((entry = zis.getNextEntry()) != null) {
                    String name = entry.getName();
                    ByteArrayOutputStream baos = new ByteArrayOutputStream();
                    int len;
                    while ((len = zis.read(buffer)) != -1) baos.write(buffer, 0, len);
                    String content = baos.toString("UTF-8");

                    if (name.endsWith("sites.js")) sitesJs = content;
                    else if (name.endsWith("contentScript.js")) contentScriptJs = content;
                    else if (name.contains("contentScript_fr.js")) contentScriptFrJs = content;
                    zis.closeEntry();
                }
                zis.close();

                if (sitesJs == null || contentScriptJs == null || contentScriptFrJs == null) {
                    JSONObject err = new JSONObject();
                    err.put("success", false);
                    err.put("error", "Missing required files in zip");
                    return err.toString();
                }

                JSONObject result = new JSONObject();
                result.put("success", true);
                result.put("sites_js", sitesJs);
                result.put("script_js", contentScriptJs);
                result.put("script_fr_js", contentScriptFrJs);
                return result.toString();

            } catch (Exception e) {
                try {
                    JSONObject err = new JSONObject();
                    err.put("success", false);
                    err.put("error", e.getMessage());
                    return err.toString();
                } catch (Exception je) {
                    return "{\"success\":false,\"error\":\"BPC download failed\"}";
                }
            }
        }
    }

    // ─── Completion handling ───

    void onScrapeComplete(String articleId, String title) {
        if (completed) return;
        completed = true;
        isRunning = false;
        mainHandler.removeCallbacks(timeoutRunnable);

        // Let JS finish its post-scrape work (IndexedDB save, render, etc.)
        mainHandler.postDelayed(() -> {
            cleanup();
            stopSelf();
        }, 5000);
    }

    // ─── Notifications ───

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "Presse Scraper",
                NotificationManager.IMPORTANCE_DEFAULT
            );
            channel.setDescription("Notifications de téléchargement d'articles");
            NotificationManager mgr = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (mgr != null) mgr.createNotificationChannel(channel);
        }
    }

    private Notification buildProgressNotification(String message) {
        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder = new Notification.Builder(this, CHANNEL_ID);
        } else {
            builder = new Notification.Builder(this);
        }
        return builder
            .setContentTitle("Presse Scraper")
            .setContentText(message)
            .setSmallIcon(android.R.drawable.ic_menu_info_details)
            .setContentIntent(pi)
            .setOngoing(true)
            .setProgress(0, 0, true)
            .build();
    }

    private void vibratePhone() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                VibratorManager vm = (VibratorManager) getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
                if (vm != null) {
                    Vibrator v = vm.getDefaultVibrator();
                    if (v != null && v.hasVibrator()) {
                        v.vibrate(VibrationEffect.createOneShot(400, VibrationEffect.DEFAULT_AMPLITUDE));
                    }
                }
            } else {
                Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
                if (v != null && v.hasVibrator()) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        v.vibrate(VibrationEffect.createOneShot(400, VibrationEffect.DEFAULT_AMPLITUDE));
                    } else {
                        v.vibrate(400);
                    }
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Vibrate failed: " + e.getMessage());
        }
    }

    private void showFinalNotification(String title, String body, String articleId) {
        vibratePhone();
        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (articleId != null && !articleId.isEmpty()) {
            intent.putExtra("openArticleId", articleId);
        }
        PendingIntent pi = PendingIntent.getActivity(this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationManager mgr = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (mgr == null) return;

        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder = new Notification.Builder(this, CHANNEL_ID);
        } else {
            builder = new Notification.Builder(this);
        }
        Notification notif = builder
            .setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(android.R.drawable.ic_menu_info_details)
            .setContentIntent(pi)
            .setAutoCancel(true)
            .setPriority(Notification.PRIORITY_DEFAULT)
            .build();

        mgr.cancel(NOTIF_ID_PROGRESS);
        mgr.notify(NOTIF_ID_COMPLETE, notif);
    }

    // ─── Cleanup ───

    private void cleanup() {
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
    }

    @Override
    public void onDestroy() {
        isRunning = false;
        cleanup();
        mainHandler.removeCallbacks(timeoutRunnable);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private static String escapeJs(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\")
                .replace("'", "\\'")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r")
                .replace("</", "<\\/");
    }
}
