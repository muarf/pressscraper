package io.qzz.pressecraper;

import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;
import android.util.Log;
import android.webkit.CookieManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKeys;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@CapacitorPlugin(name = "BnfLogin")
public class BnfLoginPlugin extends Plugin {

    private static final String TAG = "BnfLoginPlugin";
    private static final String BNF_AUTH_URL = "https://bnf.idm.oclc.org/login?url=https://nouveau.europresse.com/access/ip/default.aspx?un=D000067U_1";
    private static final String EUROPRESSE_DOMAIN = "nouveau-europresse-com.bnf.idm.oclc.org";

    private WebView webView;
    private PluginCall pendingCall;
    private Handler timeoutHandler;
    private Runnable timeoutRunnable;

    @Override
    public void load() {
        super.load();
        try {
            java.net.CookieManager cookieManager = new java.net.CookieManager(null, java.net.CookiePolicy.ACCEPT_ALL);
            java.net.CookieHandler.setDefault(cookieManager);
            Log.d(TAG, "CookieHandler initialized successfully");
        } catch (Exception e) {
            Log.e(TAG, "Failed to initialize CookieHandler", e);
        }
    }

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

        // Set timeout (60 seconds)
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
        timeoutHandler.postDelayed(timeoutRunnable, 60000);

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
        // Clean up any existing WebView
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
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                Log.d(TAG, "Page finished: " + url);

                // Check if redirected to Europresse (login succeeded)
                if (url.contains(EUROPRESSE_DOMAIN) && !url.contains("login")) {
                    handleLoginSuccess(url);
                    return;
                }

                // Check for login errors
                view.evaluateJavascript(
                    "(function() {" +
                    "  var errors = document.querySelectorAll('.erreur, .error, [class*=\"error\"], .alert-danger, #error');" +
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
                if (url.contains("bnf.idm.oclc.org") || url.contains("login") || url.contains("idm.oclc.org")) {
                    String jsCode =
                        "(function() {" +
                        "  var u = document.querySelector(\"input[type='text'], input[id*='user'], input[name*='user'], input[name='username'], input[name='j_username']\");" +
                        "  var p = document.querySelector(\"input[type='password'], input[name='j_password']\");" +
                        "  if (u && p) {" +
                        "    u.value = '" + safeUsername + "';" +
                        "    u.dispatchEvent(new Event('input', {bubbles: true}));" +
                        "    u.dispatchEvent(new Event('change', {bubbles: true}));" +
                        "    p.value = '" + safePassword + "';" +
                        "    p.dispatchEvent(new Event('input', {bubbles: true}));" +
                        "    p.dispatchEvent(new Event('change', {bubbles: true}));" +
                        "    var btn = document.querySelector(\"input[type='submit'], button[type='submit'], button.submit, .btn-primary\");" +
                        "    if (btn) { btn.click(); return 'submitted'; }" +
                        "    var form = document.querySelector('form');" +
                        "    if (form) { form.submit(); return 'submitted'; }" +
                        "    return 'no_submit';" +
                        "  }" +
                        "  return 'no_fields';" +
                        "})()";

                    view.evaluateJavascript(jsCode, fillResult -> {
                        Log.d(TAG, "Form fill: " + fillResult);
                    });
                }
            }
        });

        webView.loadUrl(BNF_AUTH_URL);
    }

    private void handleLoginSuccess(String url) {
        if (timeoutHandler != null && timeoutRunnable != null) {
            timeoutHandler.removeCallbacks(timeoutRunnable);
        }

        CookieManager cookieManager = CookieManager.getInstance();
        String cookiesStr = cookieManager.getCookie("https://" + EUROPRESSE_DOMAIN);
        Log.d(TAG, "Cookies: " + (cookiesStr != null ? cookiesStr.substring(0, Math.min(200, cookiesStr.length())) + "..." : "null"));

        JSObject result = new JSObject();

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
                        cookie.put("domain", EUROPRESSE_DOMAIN);
                        cookie.put("path", "/");
                        cookieArray.put(cookie);
                    }
                }
                result.put("success", true);
                result.put("cookies", cookieArray);
                result.put("cookieHeader", cookiesStr);
            } catch (JSONException e) {
                result.put("success", false);
                result.put("error", "Cookie parsing error: " + e.getMessage());
            }
        } else {
            result.put("success", false);
            result.put("error", "No cookies found after login");
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

        Log.d(TAG, "HTTP Request: " + method.toUpperCase() + " " + urlStr);

        // Run on background thread
        new Thread(() -> {
            try {
                URL url = new URL(urlStr);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod(method.toUpperCase());
                conn.setConnectTimeout(30000);
                conn.setReadTimeout(30000);

                // Set headers
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

                // Merge JS Cookie header with system CookieHandler store
                StringBuilder mergedCookies = new StringBuilder();
                if (jsCookie != null && !jsCookie.isEmpty()) {
                    mergedCookies.append(jsCookie);
                }
                try {
                    java.net.CookieManager cookieManager = (java.net.CookieManager) java.net.CookieHandler.getDefault();
                    if (cookieManager != null) {
                        for (java.net.HttpCookie cookie : cookieManager.getCookieStore().getCookies()) {
                            if (mergedCookies.length() > 0) {
                                mergedCookies.append("; ");
                            }
                            mergedCookies.append(cookie.getName()).append("=").append(cookie.getValue());
                        }
                    }
                } catch (Exception ce) {
                    Log.w(TAG, "   Error retrieving system cookies: " + ce.getMessage());
                }

                if (mergedCookies.length() > 0) {
                    String finalCookies = mergedCookies.toString();
                    conn.setRequestProperty("Cookie", finalCookies);
                    Log.d(TAG, "   Merged Cookie Header: " + (finalCookies.length() > 60 ? finalCookies.substring(0, 60) + "..." : finalCookies));
                }

                // Set body for POST/PUT
                String bodyStr = call.getString("body", null);
                if (bodyStr != null && (method.equalsIgnoreCase("POST") || method.equalsIgnoreCase("PUT"))) {
                    conn.setDoOutput(true);
                    OutputStream os = conn.getOutputStream();
                    os.write(bodyStr.getBytes("UTF-8"));
                    os.flush();
                    os.close();
                    Log.d(TAG, "   Request Body size: " + bodyStr.length() + " chars");
                }

                int status = conn.getResponseCode();
                Log.d(TAG, "   Response Status Code: " + status);

                int redirectCount = 0;
                String finalCookies = mergedCookies.toString();
                while ((status == 301 || status == 302 || status == 303 || status == 307 || status == 308) && redirectCount < 5) {
                    redirectCount++;
                    String location = conn.getHeaderField("Location");
                    if (location == null || location.isEmpty()) {
                        break;
                    }

                    // Resolve redirect URL
                    URL base = conn.getURL();
                    URL next = new URL(base, location);

                    Log.d(TAG, "   Redirecting (" + redirectCount + ") to: " + next.toExternalForm());

                    conn = (HttpURLConnection) next.openConnection();
                    conn.setRequestMethod("GET"); // POST redirects are followed as GET
                    conn.setConnectTimeout(30000);
                    conn.setReadTimeout(30000);

                    // Update finalCookies with newly stored cookies in CookieManager
                    StringBuilder newCookies = new StringBuilder(finalCookies);
                    try {
                        java.net.CookieManager cookieManager = (java.net.CookieManager) java.net.CookieHandler.getDefault();
                        if (cookieManager != null) {
                            for (java.net.HttpCookie cookie : cookieManager.getCookieStore().getCookies()) {
                                String cookieString = cookie.getName() + "=" + cookie.getValue();
                                if (newCookies.indexOf(cookieString) == -1) {
                                    if (newCookies.length() > 0) {
                                        newCookies.append("; ");
                                    }
                                    newCookies.append(cookieString);
                                }
                            }
                        }
                    } catch (Exception ce) {
                        Log.w(TAG, "   Error merging redirect cookies: " + ce.getMessage());
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
                    Log.d(TAG, "   Redirect Response Status Code: " + status);
                }

                // Log final response headers (especially Set-Cookie)
                java.util.Map<String, java.util.List<String>> headerFields = conn.getHeaderFields();
                for (java.util.Map.Entry<String, java.util.List<String>> entry : headerFields.entrySet()) {
                    String key = entry.getKey();
                    if (key != null && key.equalsIgnoreCase("Set-Cookie")) {
                        for (String cookieVal : entry.getValue()) {
                            Log.d(TAG, "   Response Set-Cookie: " + cookieVal);
                        }
                    }
                }

                // Read response
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

                Log.d(TAG, "   Response Body size: " + sb.length() + " chars");

                JSObject result = new JSObject();
                result.put("status", status);
                result.put("data", sb.toString());
                call.resolve(result);

            } catch (Exception e) {
                Log.e(TAG, "   HTTP request failed", e);
                JSObject result = new JSObject();
                result.put("error", e.getMessage());
                call.resolve(result);
            }
        }).start();
    }

    @PluginMethod()
    public void downloadFile(PluginCall call) {
        String urlStr = call.getString("url", "");
        String filename = call.getString("filename", "download.pdf");

        if (urlStr.isEmpty()) {
            JSObject result = new JSObject();
            result.put("error", "URL required");
            call.resolve(result);
            return;
        }

        new Thread(() -> {
            try {
                URL url = new URL(urlStr);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("GET");
                conn.setConnectTimeout(30000);
                conn.setReadTimeout(60000);

                int status = conn.getResponseCode();
                if (status != 200) {
                    JSObject result = new JSObject();
                    result.put("error", "HTTP " + status);
                    call.resolve(result);
                    return;
                }

                // Sauvegarder dans le dossier Downloads de l'app
                java.io.File downloadsDir = android.os.Environment.getExternalStoragePublicDirectory(
                    android.os.Environment.DIRECTORY_DOCUMENTS);
                if (!downloadsDir.exists()) downloadsDir.mkdirs();
                java.io.File outFile = new java.io.File(downloadsDir, filename);

                java.io.InputStream is = conn.getInputStream();
                java.io.FileOutputStream fos = new java.io.FileOutputStream(outFile);
                byte[] buffer = new byte[8192];
                int len;
                while ((len = is.read(buffer)) != -1) {
                    fos.write(buffer, 0, len);
                }
                fos.close();
                is.close();

                JSObject result = new JSObject();
                result.put("success", true);
                result.put("path", outFile.getAbsolutePath());
                call.resolve(result);

            } catch (Exception e) {
                Log.e(TAG, "downloadFile error", e);
                JSObject result = new JSObject();
                result.put("error", e.getMessage());
                call.resolve(result);
            }
        }).start();
    }

    @PluginMethod()
    public void showNotification(PluginCall call) {
        String title = call.getString("title", "Presse Scraper");
        String body = call.getString("body", "");
        String articleId = call.getString("articleId", "");

        try {
            android.app.NotificationManager notificationManager =
                (android.app.NotificationManager) getContext().getSystemService(android.content.Context.NOTIFICATION_SERVICE);

            // Create notification channel for Android O+
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                android.app.NotificationChannel channel = new android.app.NotificationChannel(
                    "presse_scraper", "Articles", android.app.NotificationManager.IMPORTANCE_DEFAULT);
                channel.setDescription("Notifications d'articles téléchargés");
                notificationManager.createNotificationChannel(channel);
            }

            // Build intent to open the app
            android.content.Intent intent = new android.content.Intent(getContext(), MainActivity.class);
            intent.setFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK | android.content.Intent.FLAG_ACTIVITY_CLEAR_TOP);
            if (articleId != null && !articleId.isEmpty()) {
                intent.putExtra("openArticleId", articleId);
            }

            android.app.PendingIntent pendingIntent = android.app.PendingIntent.getActivity(
                getContext(), 0, intent,
                android.app.PendingIntent.FLAG_UPDATE_CURRENT | android.app.PendingIntent.FLAG_IMMUTABLE);

            // Build notification
            androidx.core.app.NotificationCompat.Builder builder =
                new androidx.core.app.NotificationCompat.Builder(getContext(), "presse_scraper")
                    .setSmallIcon(android.R.drawable.ic_menu_info_details)
                    .setContentTitle(title)
                    .setContentText(body)
                    .setPriority(androidx.core.app.NotificationCompat.PRIORITY_DEFAULT)
                    .setContentIntent(pendingIntent)
                    .setAutoCancel(true);

            notificationManager.notify((int) System.currentTimeMillis(), builder.build());

            JSObject result = new JSObject();
            result.put("success", true);
            call.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "showNotification error", e);
            JSObject result = new JSObject();
            result.put("error", e.getMessage());
            call.resolve(result);
        }
    }

    @PluginMethod()
    public void requestNotificationPermission(PluginCall call) {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
            // Android 13+ needs runtime permission
            if (getContext().checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                    != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                // Request permission via activity
                getActivity().requestPermissions(
                    new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 1001);
            }
        }
        JSObject result = new JSObject();
        result.put("success", true);
        call.resolve(result);
    }

    // ===== CLIENT-SIDE PDF GENERATION =====

    /**
     * Generates a PDF silently from an HTML string using Android's native print framework.
     * The PDF is saved to the app's cache directory (no extra permissions needed).
     */
    @PluginMethod()
    public void printHtmlToPdf(PluginCall call) {
        String html = call.getString("html", "");
        String filename = call.getString("filename", "article_" + System.currentTimeMillis() + ".pdf");

        if (html.isEmpty()) {
            JSObject result = new JSObject();
            result.put("success", false);
            result.put("error", "Le contenu HTML est vide");
            call.resolve(result);
            return;
        }

        this.pendingCall = call;

        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                WebView printWebView = new WebView(getContext());
                printWebView.getSettings().setJavaScriptEnabled(true);

                // Premium CSS template for the PDF
                String styledHtml = "<html><head><meta charset='UTF-8'>" +
                    "<style>" +
                    "body { font-family: 'Georgia', serif; padding: 40px; color: #111; line-height: 1.8; font-size: 16px; }" +
                    "h1 { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 26px; font-weight: 700; color: #000; margin-bottom: 25px; line-height: 1.25; }" +
                    "p { margin-bottom: 16px; text-align: justify; }" +
                    "img { max-width: 100%; height: auto; display: block; margin: 20px auto; }" +
                    ".source { font-style: italic; color: #666; margin-bottom: 20px; font-size: 14px; }" +
                    "</style></head><body>" + html + "</body></html>";

                printWebView.loadDataWithBaseURL("file:///android_asset/", styledHtml, "text/html", "UTF-8", null);
                printWebView.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView view, String url) {
                        Log.d(TAG, "printHtmlToPdf: WebView page loaded, starting PDF generation");

                        PrintAttributes attributes = new PrintAttributes.Builder()
                            .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                            .setResolution(new PrintAttributes.Resolution("pdf", "pdf", 600, 600))
                            .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                            .build();

                        PrintDocumentAdapter printAdapter = printWebView.createPrintDocumentAdapter(filename);

                        File pdfFile = new File(getContext().getCacheDir(), filename);

                        android.print.PDFPrintHelper.print(printAdapter, attributes, pdfFile, new android.print.PDFPrintHelper.PDFPrintCallback() {
                            @Override
                            public void onSuccess(String path) {
                                Log.d(TAG, "printHtmlToPdf: PDF saved to " + path);
                                JSObject ret = new JSObject();
                                ret.put("success", true);
                                ret.put("path", path);
                                call.resolve(ret);
                                printWebView.destroy();
                            }

                            @Override
                            public void onError(String error) {
                                Log.e(TAG, "printHtmlToPdf failed: " + error);
                                JSObject ret = new JSObject();
                                ret.put("success", false);
                                ret.put("error", error);
                                call.resolve(ret);
                                printWebView.destroy();
                            }
                        });
                    }
                });
            } catch (Exception e) {
                Log.e(TAG, "printHtmlToPdf: exception", e);
                JSObject ret = new JSObject();
                ret.put("success", false);
                ret.put("error", "Exception: " + e.getMessage());
                call.resolve(ret);
            }
        });
    }

    /**
     * Opens a local PDF file using the system's default PDF viewer via FileProvider.
     */
    @PluginMethod()
    public void openPdfFile(PluginCall call) {
        String path = call.getString("path", "");
        if (path.isEmpty()) {
            JSObject result = new JSObject();
            result.put("success", false);
            result.put("error", "Chemin d'accès obligatoire");
            call.resolve(result);
            return;
        }

        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                File file = new File(path);
                if (!file.exists()) {
                    JSObject result = new JSObject();
                    result.put("success", false);
                    result.put("error", "Fichier PDF inexistant: " + path);
                    call.resolve(result);
                    return;
                }

                Uri fileUri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    file
                );

                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setDataAndType(fileUri, "application/pdf");
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

                getContext().startActivity(intent);

                JSObject result = new JSObject();
                result.put("success", true);
                call.resolve(result);
            } catch (Exception e) {
                Log.e(TAG, "openPdfFile error", e);
                JSObject result = new JSObject();
                result.put("success", false);
                result.put("error", "Erreur ouverture PDF: " + e.getMessage());
                call.resolve(result);
            }
        });
    }

    /**
     * Retourne le User-Agent réel de la WebView Android de l'appareil.
     * Permet au JS d'utiliser un UA dynamique et authentique plutôt qu'une chaîne statique,
     * ce qui réduit le risque d'être détecté comme bot par Europresse.
     */
    @PluginMethod()
    public void getWebViewUserAgent(PluginCall call) {
        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                String ua = android.webkit.WebSettings.getDefaultUserAgent(getContext());
                JSObject result = new JSObject();
                result.put("userAgent", ua);
                call.resolve(result);
            } catch (Exception e) {
                Log.e(TAG, "getWebViewUserAgent error", e);
                // Fallback graceful — le JS utilisera son UA statique de secours
                JSObject result = new JSObject();
                result.put("userAgent", "");
                call.resolve(result);
            }
        });
    }

    // ===== STOCKAGE SÉCURISÉ DES IDENTIFIANTS =====

    private static final String CREDS_PREFS_FILE = "bnf_secure_prefs";
    private static final String KEY_USERNAME = "bnf_username";
    private static final String KEY_PASSWORD = "bnf_password";

    /**
     * Retourne une instance de SharedPreferences chiffrées via Android Keystore.
     * Le fichier de préférences est chiffré avec AES-256-GCM pour les valeurs
     * et AES-256-SIV pour les clés.
     */
    private SharedPreferences getEncryptedPrefs() throws Exception {
        String masterKeyAlias = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC);
        return EncryptedSharedPreferences.create(
            CREDS_PREFS_FILE,
            masterKeyAlias,
            getContext(),
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        );
    }

    /**
     * Enregistre les identifiants BnF de manière chiffrée dans le Keystore Android.
     * Appelé depuis JS : BnfLogin.saveCredentials({ username, password })
     */
    @PluginMethod()
    public void saveCredentials(PluginCall call) {
        String username = call.getString("username", "");
        String password = call.getString("password", "");
        try {
            SharedPreferences prefs = getEncryptedPrefs();
            prefs.edit()
                .putString(KEY_USERNAME, username)
                .putString(KEY_PASSWORD, password)
                .apply();
            Log.d(TAG, "saveCredentials: identifiants enregistrés de manière sécurisée");
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

    /**
     * Récupère les identifiants BnF chiffrés depuis le Keystore Android.
     * Appelé depuis JS : BnfLogin.getCredentials()
     */
    @PluginMethod()
    public void getCredentials(PluginCall call) {
        try {
            SharedPreferences prefs = getEncryptedPrefs();
            String username = prefs.getString(KEY_USERNAME, "");
            String password = prefs.getString(KEY_PASSWORD, "");
            Log.d(TAG, "getCredentials: lecture OK, username=" + (username.isEmpty() ? "(vide)" : "(présent)"));
            JSObject result = new JSObject();
            result.put("username", username);
            result.put("password", password);
            call.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "getCredentials error", e);
            JSObject result = new JSObject();
            result.put("username", "");
            result.put("password", "");
            call.resolve(result);
        }
    }

    /**
     * Supprime les identifiants BnF chiffrés du Keystore Android.
     * Appelé depuis JS : BnfLogin.clearCredentials()
     */
    @PluginMethod()
    public void clearCredentials(PluginCall call) {
        try {
            SharedPreferences prefs = getEncryptedPrefs();
            prefs.edit()
                .remove(KEY_USERNAME)
                .remove(KEY_PASSWORD)
                .apply();
            Log.d(TAG, "clearCredentials: identifiants supprimés");
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
}
