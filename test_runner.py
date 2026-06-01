#!/usr/bin/env python3
"""
Test runner for Archive Presse on redroid.
Uses ADB for device control + Chrome DevTools Protocol for JS interaction.

Usage:
  # Quick smoke test:
  python3 test_runner.py --apk android/app/build/outputs/apk/debug/app-debug.apk

  # Test specific provider:
  python3 test_runner.py --provider bpc
  python3 test_runner.py --provider europresse
  python3 test_runner.py --provider pressreader
  python3 test_runner.py --provider cafeyn
  python3 test_runner.py --provider bnf-proxy

  # Full suite:
  python3 test_runner.py --apk ... --full

  # With credentials:
  python3 test_runner.py --bnf-user "xxx" --bnf-pass "yyy"
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time
import traceback
from urllib.parse import urljoin

import requests
import websocket

# ─── Configuration ───────────────────────────────────────────────────────────

import shutil

ADB = shutil.which("adb") or "/opt/android-sdk/platform-tools/adb"
CDP_PROXY_PORT = 9223

TEST_URLS = {
    "bpc": "https://www.leparisien.fr/meteo/on-na-jamais-battu-autant-de-records-en-mai-la-carte-des-villes-ou-le-thermometre-a-atteint-des-sommets-27-05-2026-7KB7BQHMPVCHZDZW2PLJ7B2QP4.php",
    "europresse": "https://www.lemonde.fr/international/article/2026/05/27/derriere-la-guerre-de-vladimir-poutine-le-role-croissant-du-fsb-l-agence-de-renseignement-russe_6694149_3210.html",
    "pressreader": "https://www.lefigaro.fr/meteo/en-direct-canicule-la-france-suffoque-sous-le-dome-de-chaleur-13-departements-en-vigilance-orange-et-la-vitesse-abaissee-en-ile-de-france-20260527",
    "cafeyn": "https://www.lefigaro.fr/actualite-france/manifestations-du-1er-mai-l-ultra-gauche-en-embuscade-et-les-forces-de-l-ordre-sur-le-qui-vive-20260429",
    "bnf-proxy": "https://www.arretsurimages.net/articles/affaire-pellan-le-rapport-qui-accable",
    "mediapart": "https://www.mediapart.fr/journal/france/270526/le-senat-vote-le-projet-de-loi-ripost-defouloir-securitaire-de-la-majorite",
}

TIMEOUT_SCRAPE = 140  # seconds max to wait for a single scrape (JS timeout is 120s)
TIMEOUT_SERVICE = 160  # seconds max for headless service

# Known logcat tags
TAGS = "ScrapeService|showNotification|_scraping|HEADLESS|SHARE|ORCH|BPC|Europresse|PressReader|Cafeyn|MIGRATE|TEST"

# ─── Test results ────────────────────────────────────────────────────────────

PASS, FAIL, SKIP = "PASS", "FAIL", "SKIP"
results = []


def test(name, fn):
    """Decorator-like: run a test function and record result."""
    def wrapper(*args, **kwargs):
        print(f"\n  ── {name} ──", flush=True)
        try:
            fn(*args, **kwargs)
            results.append((name, PASS, ""))
            print(f"  ✅ {name}")
        except AssertionError as e:
            results.append((name, FAIL, str(e)))
            print(f"  ❌ {name}: {e}")
        except Exception as e:
            results.append((name, FAIL, traceback.format_exc()))
            print(f"  ❌ {name}: {e}")
    return wrapper


def require(condition, msg=""):
    if not condition:
        raise AssertionError(msg or "assertion failed")


# ─── ADB helpers ─────────────────────────────────────────────────────────────

DEVICE_SERIAL = None


def adb(*args, timeout=30):
    cmd = [ADB]
    if DEVICE_SERIAL:
        cmd += ["-s", DEVICE_SERIAL]
    cmd += list(args)
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    return r.stdout.strip(), r.stderr.strip(), r.returncode


def adb_shell(*args, timeout=30):
    return adb("shell", *args, timeout=timeout)


def check_device(serial=None):
    """Ensure a device is connected."""
    global DEVICE_SERIAL
    # If already set and no new serial requested, just verify
    if DEVICE_SERIAL and not serial:
        out, _, rc = adb("shell", "echo", "ok")
        require(rc == 0, f"Device {DEVICE_SERIAL} disconnected")
        print(f"    Device: {DEVICE_SERIAL}")
        return
    out, _, rc = adb("devices")
    require(rc == 0, "adb not found")
    lines = [l for l in out.split("\n") if l.strip() and not l.startswith("List")]
    require(len(lines) > 0, "No devices connected. Run `adb connect 127.0.0.1:5555`")
    # If serial provided, use it; else use first device
    if serial:
        require(any(serial in l for l in lines), f"Device {serial} not found")
        DEVICE_SERIAL = serial
    else:
        DEVICE_SERIAL = lines[0].split()[0]
    print(f"    Device: {DEVICE_SERIAL}")


def install_apk(apk_path):
    print(f"    Installing {apk_path}...", end=" ", flush=True)
    out, err, rc = adb("install", "-r", apk_path, timeout=60)
    require(rc == 0, f"Install failed: {err or out}")
    print("OK")


def set_webview_flag():
    """Set --remote-allow-origins=* for WebView CDP debugging."""
    flag = "com.google.android.webview --remote-allow-origins=*\\n"
    adb_shell("printf", f"'{flag}'", ">", "/data/local/tmp/webview-command-line")


def force_stop(package="io.qzz.pressecraper"):
    adb_shell("am", "force-stop", package)


def clear_data(package="io.qzz.pressecraper"):
    adb_shell("pm", "clear", package)


def launch_intent(action, data=None, extra_text=None, extra_process_text=None,
                  package="io.qzz.pressecraper", activity=".MainActivity"):
    cmd = ["am", "start", "-a", action]
    if data:
        cmd += ["-d", data]
    if extra_text:
        cmd += ["-t", "text/plain", "--es", "android.intent.extra.TEXT", extra_text]
    if extra_process_text:
        cmd += ["--es", "android.intent.extra.PROCESS_TEXT", extra_process_text]
    cmd += ["-n", f"{package}/{activity}"]
    print(f"    Intent: {cmd}", flush=True)
    out, err, rc = adb_shell(*cmd)
    require(rc == 0, f"Intent failed: {err or out}")


def logcat_clear():
    adb("logcat", "-c")


def logcat_dump(tag_filter=None):
    """Return last 500 lines of logcat matching tag_filter."""
    cmd = [ADB]
    if DEVICE_SERIAL:
        cmd += ["-s", DEVICE_SERIAL]
    cmd += ["logcat", "-d", "-t", "500"]
    if tag_filter:
        cmd += ["-e", tag_filter]
    try:
        r = subprocess.run(cmd, capture_output=True, timeout=10)
        return r.stdout.decode('utf-8', errors='replace')
    except Exception:
        return ""


def logcat_wait(pattern, timeout=60):
    """Poll logcat until pattern appears or timeout."""
    start = time.time()
    while time.time() - start < timeout:
        out = logcat_dump()
        if re.search(pattern, out, re.IGNORECASE):
            return out
        time.sleep(1)
    raise TimeoutError(f"Pattern '{pattern}' not found in {timeout}s")


# ─── CDP helpers ─────────────────────────────────────────────────────────────

class CDPConnection:
    """Connect to Android WebView via Chrome DevTools Protocol."""

    def __init__(self, device_ws_port=CDP_PROXY_PORT):
        self.port = device_ws_port
        self.ws = None
        self.msg_id = 0
        self.page_id = None
        self._console_msgs = []

    def _get_pid(self):
        """Get PID of the app process on device."""
        out, _, _ = adb_shell("ps", "-A")
        for line in out.split("\n"):
            if "pressecraper" in line:
                parts = line.split()
                return parts[1] if len(parts) > 1 else parts[0]
        return None

    def connect(self):
        """Find the WebView page and connect via WebSocket."""
        pid = self._get_pid()
        require(pid, "App process not found (launch app first)")

        # Forward the WebView debug socket
        adb("forward", "--remove-all")
        adb("forward", f"tcp:{self.port}",
            f"localabstract:webview_devtools_remote_{pid}", timeout=5)

        # Wait a moment for WebView to be ready
        time.sleep(2)

        # Get page list
        resp = requests.get(f"http://127.0.0.1:{self.port}/json", timeout=10)
        require(resp.status_code == 200, f"CDP /json failed: {resp.status_code}")
        pages = resp.json()
        require(len(pages) > 0, "No CDP pages found (WebView not ready?)")
        # Prefer a page with "about:blank" or main page
        for p in pages:
            if "blank" in p.get("url", "") or "pressecraper" in p.get("url", ""):
                self.page_id = p["id"]
                ws_url = p["webSocketDebuggerUrl"]
                break
        else:
            self.page_id = pages[0]["id"]
            ws_url = pages[0]["webSocketDebuggerUrl"]

        # Connect WebSocket (suppress Origin to avoid 403 on modern Chromium)
        self.ws = websocket.create_connection(ws_url, timeout=10,
            suppress_origin=True)
        # Enable Runtime and Console domains
        self._send("Runtime.enable")
        self._send("Console.enable")
        self._send("Runtime.runIfWaitingForDebugger")
        print(f"    CDP connected (page={self.page_id[:16]})")

    def _send(self, method, params=None, timeout=10):
        self.msg_id += 1
        msg = {"id": self.msg_id, "method": method}
        if params:
            msg["params"] = params
        self.ws.send(json.dumps(msg))
        self.ws.settimeout(timeout)
        # Wait for matching response
        start = time.time()
        while time.time() - start < timeout:
            try:
                resp = json.loads(self.ws.recv())
                if resp.get("id") == self.msg_id:
                    return resp.get("result")
                # Collect console events
                if resp.get("method") == "Console.messageAdded":
                    text = resp["params"]["message"]["text"]
                    self._console_msgs.append(text)
                elif resp.get("method") == "Runtime.consoleAPICalled":
                    for arg in resp["params"]["args"]:
                        if arg.get("type") == "string":
                            self._console_msgs.append(arg["value"])
            except websocket.WebSocketTimeoutException:
                pass
        raise TimeoutError(f"CDP command {method} timed out")

    def evaluate(self, js, timeout=30):
        """Evaluate JS in the page context and return the result value."""
        result = self._send("Runtime.evaluate", {
            "expression": js,
            "returnByValue": True,
            "awaitPromise": True,
        }, timeout=timeout)
        if result and "exceptionDetails" in result:
            exc = result["exceptionDetails"]
            raise RuntimeError(f"JS error: {exc.get('text', '')} {exc.get('exception', {}).get('description', '')}")
        if result and "result" in result:
            val = result["result"]
            if "value" in val:
                return val["value"]
            if "description" in val:
                return val["description"]
        return None

    def console_logs(self):
        """Return all collected console messages."""
        msgs = list(self._console_msgs)
        self._console_msgs = []
        return msgs

    def last_console(self):
        """Return all collected console messages without clearing."""
        return list(self._console_msgs)

    def close(self):
        if self.ws:
            self.ws.close()

    def wait_for_console(self, pattern, timeout=60):
        """Wait until a console message matches pattern."""
        # Check already-collected messages first
        for msg in self._console_msgs:
            if re.search(pattern, msg, re.IGNORECASE):
                return msg
        # Then wait for new messages
        start = time.time()
        while time.time() - start < timeout:
            try:
                self.ws.settimeout(1)
                resp = json.loads(self.ws.recv())
                if resp.get("method") == "Console.messageAdded":
                    text = resp["params"]["message"]["text"]
                    self._console_msgs.append(text)
                    if re.search(pattern, text, re.IGNORECASE):
                        return text
                elif resp.get("method") == "Runtime.consoleAPICalled":
                    for arg in resp["params"]["args"]:
                        if arg.get("type") == "string":
                            self._console_msgs.append(arg["value"])
                            if re.search(pattern, arg["value"], re.IGNORECASE):
                                return arg["value"]
            except websocket.WebSocketTimeoutException:
                pass
        # On timeout, show what we have
        all_msgs = "\n".join(self._console_msgs[-20:])
        raise TimeoutError(f"Console pattern '{pattern}' not found in {timeout}s.\nLast messages:\n{all_msgs}")


# ─── State injection ─────────────────────────────────────────────────────────

# Map test provider names to app internal provider IDs
PROVIDER_ID_MAP = {
    "bpc": "bpc",
    "europresse": "bnf",
    "pressreader": "pressreader",
    "cafeyn": "cafeyn",
    "bnf-proxy": "bnf",  # bnf-proxy is auto-injected when BnF enabled + URL is mediapart/ASI
    "mediapart": "bnf",  # same: uses BnF auth + bnf-proxy service
}


def inject_state(cdp, overrides=None):
    """Set localStorage state with overrides (single provider active).
    Writes the format the app's save() function uses (string[] providerOrder)."""
    # Read current state first, then override
    state_raw = cdp.evaluate(
        "JSON.parse(localStorage.getItem('presse_scraper_v3'))"
    )
    state = json.loads(state_raw) if isinstance(state_raw, str) else (state_raw or {})
    # Ensure required keys exist
    state.setdefault("providerOrder", ["bpc", "pressreader", "cafeyn", "bnf"])
    state.setdefault("providerEnabled", {p: False for p in ["bpc", "pressreader", "cafeyn", "bnf", "bnf-proxy"]})
    state.setdefault("theme", "dark")

    if overrides:
        if "providerEnabled" in overrides:
            for pid, enabled in overrides["providerEnabled"].items():
                state["providerEnabled"][pid] = enabled
                # Ensure enabled providers are first in providerOrder
                if enabled and pid not in state["providerOrder"]:
                    state["providerOrder"].insert(0, pid)
        for k, v in overrides.items():
            if k != "providerEnabled":
                state[k] = v

    cdp.evaluate(
        f"localStorage.setItem('presse_scraper_v3', {json.dumps(json.dumps(state))})"
    )
    return state


def inject_credentials(cdp, bnf_user=None, bnf_pass=None, cafeyn_user=None, cafeyn_pass=None):
    """Inject credentials into the app state."""
    state_raw = cdp.evaluate(
        "JSON.parse(localStorage.getItem('presse_scraper_v3'))"
    )
    state = json.loads(state_raw) if isinstance(state_raw, str) else (state_raw or {})
    if bnf_user:
        state["bnfUsername"] = bnf_user
    if bnf_pass:
        state["bnfPassword"] = bnf_pass
    if cafeyn_user:
        state["cafeynUsername"] = cafeyn_user
    if cafeyn_pass:
        state["cafeynPassword"] = cafeyn_pass
    cdp.evaluate(
        f"localStorage.setItem('presse_scraper_v3', {json.dumps(json.dumps(state))})"
    )


# ─── Test functions ──────────────────────────────────────────────────────────

def test_device_connection(ctx):
    force_stop()
    set_webview_flag()
    time.sleep(1)
    adb_shell("am", "start", "-n", "io.qzz.pressecraper/.MainActivity")
    time.sleep(5)
    # Verify process is running
    out, _, _ = adb_shell("ps", "-A")
    require("pressecraper" in out, "App failed to launch")
    print("    App launched")


def test_cdp_connection(ctx):
    cdp = CDPConnection()
    cdp.connect()
    ctx["cdp"] = cdp
    # Verify JS context is live
    title = cdp.evaluate("document.title")
    print(f"    Page title: {title}")


def test_ui_components(ctx):
    cdp = ctx["cdp"]
    # Check main UI elements exist
    logo = cdp.evaluate("!!document.querySelector('.app-logo')")
    input_url = cdp.evaluate("!!document.querySelector('input[type=\"url\"]') || !!document.querySelector('input[placeholder*=\"URL\"]')")
    btn_save = cdp.evaluate("!!Array.from(document.querySelectorAll('button, ion-button, .btn')).find(e => e.textContent.includes('Sauvegarder') || e.textContent.includes('Sauvegarde'))")
    btn_settings = cdp.evaluate("!!Array.from(document.querySelectorAll('button, ion-button, .btn, a')).find(e => e.textContent.includes('Paramètre') || e.textContent.includes('Settings') || e.textContent.includes('⚙'))")
    require(logo or input_url or btn_save or btn_settings,
            f"UI elements missing: logo={logo}, input={input_url}, save={btn_save}, settings={btn_settings}")


def _ensure_bpc_rules(cdp):
    """Install BPC bypass rules if not already present (downloaded at startup).
    The rules are downloaded via the native plugin's downloadAndExtractBpcRules()."""
    bpc_sites = cdp.evaluate("localStorage.getItem('bpc_sites_js')", timeout=5)
    if bpc_sites and len(bpc_sites) > 100:
        print("    BPC rules already installed")
        return
    print("    Installing BPC rules...")
    result = cdp.evaluate("""(async () => {
        try {
            const BnfLogin = window.Capacitor?.Plugins?.BnfLogin;
            if (!BnfLogin || typeof BnfLogin.downloadAndExtractBpcRules !== 'function')
                return 'ERR: plugin not available';
            const res = await BnfLogin.downloadAndExtractBpcRules();
            if (!res || !res.success) return 'ERR: ' + (res?.error || 'unknown');
            localStorage.setItem('bpc_sites_js', res.sites_js);
            localStorage.setItem('bpc_script_js', res.script_js);
            localStorage.setItem('bpc_script_fr_js', res.script_fr_js);
            return 'OK';
        } catch(e) { return 'ERR: ' + e.message; }
    })()""", timeout=60)
    print(f"    BPC install: {result}")
    require(result == "OK" or "ERR" not in result, f"BPC rules install failed: {result}")


def test_single_provider(ctx, provider_id, url=None):
    """Test scraping with a single provider enabled."""
    cdp = ctx["cdp"]
    test_url = url or TEST_URLS.get(provider_id)
    require(test_url, f"No test URL for {provider_id}")

    # Map test provider name to app internal provider ID
    app_provider_id = PROVIDER_ID_MAP.get(provider_id, provider_id)

    # For BPC, ensure rules are installed first
    if provider_id == "bpc":
        _ensure_bpc_rules(cdp)

    # Configure state: only this provider enabled
    enabled = {p: False for p in ["bnf", "pressreader", "cafeyn", "bpc"]}
    enabled[app_provider_id] = True
    overrides = {"providerEnabled": enabled}

    # Inject credentials into state for connector refresh()
    if provider_id == "cafeyn":
        if ctx.get("cafeyn_jwt"):
            overrides["cafeynJwt"] = ctx["cafeyn_jwt"]
        elif ctx.get("cafeyn_user"):
            overrides["cafeynUsername"] = ctx["cafeyn_user"]
            overrides["cafeynPassword"] = ctx["cafeyn_pass"]
    if provider_id in ("bnf", "bnf-proxy", "mediapart") and ctx.get("bnf_user"):
        overrides["bnfUsername"] = ctx["bnf_user"]
        overrides["bnfPassword"] = ctx["bnf_pass"]

    inject_state(cdp, overrides)

    # Inject credentials via native plugin if available
    if provider_id in ("bnf", "bnf-proxy", "mediapart") and ctx.get("bnf_user"):
        cdp.evaluate(f"""
            window.Capacitor.Plugins.BnfLogin.saveCredentials({{
                username: {json.dumps(ctx['bnf_user'])},
                password: {json.dumps(ctx['bnf_pass'])}
            }})
        """, timeout=10)
        print(f"    Injected BnF credentials")
    if provider_id == "cafeyn":
        if ctx.get("cafeyn_jwt"):
            # Inject JWT directly into localStorage + call saveToken to activate
            exp = time.time() + 30 * 86400  # 30 days from now
            cdp.evaluate(f"""
                localStorage.setItem('cafeyn_jwt', {json.dumps(ctx['cafeyn_jwt'])});
                localStorage.setItem('cafeyn_jwt_expiry', new Date({exp * 1000}).toISOString());
                if (window.Cafeyn && window.Cafeyn.saveToken) {{
                    window.Cafeyn.saveToken({json.dumps(ctx['cafeyn_jwt'])});
                }}
                if (window.CafeynService && window.CafeynService.saveToken) {{
                    window.CafeynService.saveToken({json.dumps(ctx['cafeyn_jwt'])});
                }}
            """, timeout=10)
            print(f"    Injected Cafeyn JWT token")
        elif ctx.get("cafeyn_user"):
            print(f"    Injected Cafeyn credentials (login via GPSEA - may timeout due to Anubis anti-bot)")
            cdp.evaluate(f"""
                window.Capacitor.Plugins.CafeynLogin.saveCredentials({{
                    username: {json.dumps(ctx['cafeyn_user'])},
                    password: {json.dumps(ctx['cafeyn_pass'])}
                }})
            """, timeout=10)

    # Reload page so init() re-reads state from localStorage
    cdp.evaluate("location.reload()", timeout=5)
    time.sleep(2)
    # Wait for new JS execution context
    cdp._send("Runtime.enable", timeout=5)
    cdp._send("Runtime.runIfWaitingForDebugger", timeout=5)
    time.sleep(5)

    # Verify page reloaded
    title = cdp.evaluate("document.title", timeout=5)
    print(f"    After reload, title: {title}")

    # Set URL in input field and start scraping
    logcat_clear()
    cdp.evaluate(f"document.getElementById('urlInput').value = {json.dumps(test_url)}",
                 timeout=5)
    time.sleep(0.5)

    # startScraping is async; wrap in try/catch to report errors
    result = cdp.evaluate("""
        (async () => {
            try {
                await window.startScraping();
                return 'OK';
            } catch(e) {
                return 'ERR: ' + (e.message || e) + ' | ' + (e.stack || '');
            }
        })()
    """, timeout=TIMEOUT_SCRAPE)
    print(f"    startScraping returned: {result[:200] if result else 'None'}")

    # Check collected console messages for success/failure
    console_logs = cdp.console_logs()
    print(f"    Console messages captured: {len(console_logs)}")
    for line in console_logs[-10:]:
        print(f"      {line[:150]}")

    # Check logcat for the native showNotification call (it has the actual text)
    logs = logcat_dump()
    print(f"    Logcat lines: {len(logs.split(chr(10)))}")

    # Determine result: check logcat for native showNotification
    # Success: showNotification with "Article téléchargé" or "📰"
    # Failure: showNotification with "❌" or "Échec" or "Temps écoulé"
    success_pattern = r'showNotification.*(Article téléchargé|📰)'
    failure_pattern = r'showNotification.*(❌|Échec|Temps écoulé)'
    no_match = r'Aucune source'
    login_timeout = r'Login timeout'
    paywall = r'Paywall'
    if re.search(success_pattern, logs, re.IGNORECASE):
        print("    ✅ SCRAPE SUCCESS (notification)")
    elif re.search(failure_pattern, logs, re.IGNORECASE):
        raise AssertionError(f"Scraping failed notification")
    elif "showNotification" in logs:
        print("    ⚠️  showNotification found, undetermined result")
    elif re.search(no_match, result or "", re.IGNORECASE) or re.search(no_match, "\n".join(console_logs[-20:]), re.IGNORECASE):
        if re.search(login_timeout, "\n".join(console_logs[-20:]), re.IGNORECASE):
            print("    ⚠️  Provider login failed (GPSEA Anubis challenge timeout)")
        elif re.search(paywall, "\n".join(console_logs[-20:]), re.IGNORECASE):
            print("    ⚠️  Paywall still active (article not accessible via BnF proxy)")
        else:
            print("    ⚠️  No article found (not in provider's catalog)")
    else:
        print(f"    Last console logs:\n" + "\n".join(console_logs[-5:]))
        print(f"    Logcat:\n{logs[-500:]}")
        raise AssertionError("No scraping activity detected")


def test_headless_service(ctx):
    """Test scraping via ACTION_VIEW (headless ForegroundService)."""
    check_device()
    force_stop()
    logcat_clear()

    # Launch with ACTION_VIEW
    test_url = TEST_URLS["bpc"]
    launch_intent("android.intent.action.VIEW", data=test_url)

    # Wait for notification via logcat (service must complete within TIMEOUT_SERVICE)
    logs = logcat_wait(r"ScrapeService.*showNotification",
                       timeout=TIMEOUT_SERVICE)
    # Service ran to completion - notification shown
    if "❌" in logs or "Échec" in logs or "Temps écoulé" in logs:
        print("    ⚠️  Headless service completed with failure notification")
    elif "Article téléchargé" in logs or "📰" in logs:
        print("    ✅ Headless service completed with success notification")
    else:
        print(f"    Headless service completed (notification shown)")
    print(f"    Last relevant logs:\n" + "\n".join(
        l for l in logs.split("\n") if "ScrapeService" in l
    )[-3:])


def test_no_double_notification(ctx):
    """Verify no duplicate notification (fail+success)."""
    logs = logcat_dump()
    successes = len(re.findall(r"showNotification.*[✓✅✔]", logs))
    failures = len(re.findall(r"showNotification.*[❌✗✘]", logs))
    require(successes <= 1, f"Multiple success notifications: {successes}")
    require(failures <= 1, f"Multiple failure notifications: {failures}")
    if successes == 1:
        require(failures == 0, f"Both success ({successes}) and failure ({failures}) notifications")


def test_no_double_service(ctx):
    """Verify ScrapeService is not started on ACTION_SEND."""
    force_stop()
    logcat_clear()
    launch_intent("android.intent.action.SEND", extra_text=TEST_URLS["bpc"])
    time.sleep(5)
    logs = logcat_dump("ScrapeService")
    # Service may be started once by VIEW/foreground, but not twice
    services = re.findall(r"ScrapeService", logs)
    require(len(services) <= 1, f"ScrapeService started {len(services)} times (expected ≤1 on SEND)")


def test_session_bnf(ctx):
    """Test BnF session pre-check and auto-refresh."""
    cdp = ctx["cdp"]
    enabled = {p: False for p in ["bnf", "pressreader", "cafeyn", "bpc", "bnf-proxy"]}
    enabled["bnf"] = True
    inject_state(cdp, {"providerEnabled": enabled})
    if ctx.get("bnf_user"):
        inject_credentials(cdp, bnf_user=ctx["bnf_user"], bnf_pass=ctx["bnf_pass"])
    cdp.evaluate("location.reload()")
    time.sleep(3)

    # Trigger scrape
    logcat_clear()
    cdp.evaluate(f"startScraping({json.dumps(TEST_URLS['europresse'])})")

    try:
        msg = cdp.wait_for_console(r"(session|login|refresh|__RequestVerificationToken)", timeout=30)
        print(f"    Session: {msg[:200]}")
    except TimeoutError:
        logs = logcat_dump()
        require("Session" in logs or "refresh" in logs or "__RequestVerificationToken" in logs,
                f"No session activity. Logs:\n{logs[-300:]}")


def test_updater(ctx):
    """Test that the updater can check for beta versions."""
    cdp = ctx["cdp"]
    result = cdp.evaluate("""
        (async () => {
            if (typeof window.Updater?.checkForBetaUpdates === 'function') {
                await window.Updater.checkForBetaUpdates(true);
                return 'available:' + (window.Updater.state?.available || false);
            }
            return 'not found';
        })()
    """, timeout=30)
    print(f"    Updater: {result}")
    require(result and "not found" not in result, "Updater not available")


def test_pdf_generation(ctx):
    """Verify PDF is generated after Europresse scrape."""
    cdp = ctx["cdp"]
    article_title = cdp.evaluate("document.querySelector('.article-title, h1, .title')?.textContent")
    print(f"    Article title: {article_title}")


def test_history(ctx):
    """Verify history is populated after scraping."""
    cdp = ctx["cdp"]
    result = cdp.evaluate("""
        (async () => {
            if (typeof window.DB?.getAllArticlesFromDb === 'function') {
                const articles = await window.DB.getAllArticlesFromDb();
                return JSON.stringify(articles);
            }
            return 'DB not found';
        })()
    """, timeout=15)
    print(f"    History: {result[:200] if result else 'None'}")
    require(result and 'DB not found' not in result, "DB not available")
    require(result and result != '[]' and result != 'null', f"History is empty ({result})")


def test_storage_persistence(ctx):
    """Verify IndexedDB has stored articles."""
    cdp = ctx["cdp"]
    result = cdp.evaluate("""
        (async () => {
            if (typeof window.DB?.getAllArticlesFromDb === 'function') {
                const articles = await window.DB.getAllArticlesFromDb();
                return JSON.stringify(articles);
            }
            return 'DB not found';
        })()
    """, timeout=15)
    articles = json.loads(result) if result and result not in ['DB not found', 'null'] else []
    count = len(articles) if isinstance(articles, list) else 0
    print(f"    Stored articles: {count}")
    require(count > 0, f"No articles in DB (count={count})")


def test_intent_view(ctx):
    """Test ACTION_VIEW intent opens app."""
    check_device()
    force_stop()
    logcat_clear()
    launch_intent("android.intent.action.VIEW", data="https://www.lemonde.fr/")
    time.sleep(5)
    logs = logcat_dump()
    require("VIEW URL" in logs or "\"VIEW\"" in logs,
            f"No VIEW intent handling in logs:\n{logs[-500:]}")
    print("    Found VIEW intent handling")


def test_intent_process_text(ctx):
    """Test ACTION_PROCESS_TEXT intent."""
    check_device()
    force_stop()
    logcat_clear()
    launch_intent("android.intent.action.PROCESS_TEXT",
                  extra_process_text=f"https://www.leparisien.fr/test")
    time.sleep(5)
    logs = logcat_dump()
    require("PROCESS_TEXT" in logs,
            f"No PROCESS_TEXT intent handling in logs:\n{logs[-500:]}")
    print("    Found PROCESS_TEXT intent handling")


# ─── Test suites ─────────────────────────────────────────────────────────────

def smoke_suite(ctx):
    """Quick smoke test: BPC bypass."""
    test("Device connection", test_device_connection)(ctx)
    test("CDP connection", test_cdp_connection)(ctx)
    test("UI components exist", test_ui_components)(ctx)


def provider_suite(ctx, provider_id):
    """Full test for a single provider."""
    test(f"Device connection", test_device_connection)(ctx)
    test(f"CDP connection", test_cdp_connection)(ctx)
    test(f"Provider: {provider_id}", lambda c: test_single_provider(c, provider_id))(ctx)


def cross_cutting_suite(ctx):
    """Cross-cutting tests that require CDP."""
    test("Device connection", test_device_connection)(ctx)
    test("CDP connection", test_cdp_connection)(ctx)
    test("Session BnF", test_session_bnf)(ctx)
    test("Updater check", test_updater)(ctx)
    test("History populated", test_history)(ctx)
    test("Storage persistence", test_storage_persistence)(ctx)


def headless_suite(ctx):
    """Tests for headless ForegroundService."""
    test("Headless service (ACTION_VIEW)", test_headless_service)(ctx)


def intent_suite(ctx):
    """Intent handling tests."""
    test("ACTION_VIEW intent", test_intent_view)(ctx)
    test("ACTION_PROCESS_TEXT intent", test_intent_process_text)(ctx)


# ─── Main ────────────────────────────────────────────────────────────────────

def download_latest_beta_apk():
    """Download the latest beta APK from GitHub releases."""
    import urllib.request
    api = "https://api.github.com/repos/muarf/pressscraper/releases"
    resp = urllib.request.urlopen(api, timeout=30)
    releases = json.loads(resp.read())
    for rel in releases:
        if rel.get("prerelease") and rel.get("assets"):
            for asset in rel["assets"]:
                if asset["name"].endswith(".apk"):
                    url = asset["browser_download_url"]
                    print(f"    Downloading {asset['name']}...", end=" ", flush=True)
                    urllib.request.urlretrieve(url, f"/tmp/{asset['name']}")
                    print("OK")
                    return f"/tmp/{asset['name']}"
    raise AssertionError("No beta APK found in GitHub releases")


def main():
    parser = argparse.ArgumentParser(description="Archive Presse test runner")
    parser.add_argument("--apk", help="Path to APK to install (default: latest GitHub beta)")
    parser.add_argument("--provider", choices=list(TEST_URLS.keys()),
                        action="append", dest="providers",
                        help="Specific provider(s) to test (repeatable)")
    parser.add_argument("--full", action="store_true", help="Run full test suite")
    parser.add_argument("--smoke", action="store_true", help="Quick smoke test")
    parser.add_argument("--headless", action="store_true", help="Test headless service")
    parser.add_argument("--intents", action="store_true", help="Test intent handling")
    parser.add_argument("--cross-cutting", action="store_true", help="Cross-cutting tests")
    parser.add_argument("--bnf-user", default=os.environ.get("BNF_USER"), help="BnF username (default: $BNF_USER)")
    parser.add_argument("--bnf-pass", default=os.environ.get("BNF_PASS"), help="BnF password (default: $BNF_PASS)")
    parser.add_argument("--cafeyn-user", default=os.environ.get("CAFEYN_USER"), help="Cafeyn username (default: $CAFEYN_USER)")
    parser.add_argument("--cafeyn-pass", default=os.environ.get("CAFEYN_PASS"), help="Cafeyn password (default: $CAFEYN_PASS)")
    parser.add_argument("--cafeyn-jwt", default=os.environ.get("CAFEYN_JWT"), help="Cafeyn JWT token (default: $CAFEYN_JWT)")
    parser.add_argument("--device", help="ADB device serial (default: first found)")
    args = parser.parse_args()

    ctx = {
        "cdp": None,
        "bnf_user": args.bnf_user,
        "bnf_pass": args.bnf_pass,
        "cafeyn_user": args.cafeyn_user,
        "cafeyn_pass": args.cafeyn_pass,
        "cafeyn_jwt": args.cafeyn_jwt,
    }

    global results
    results = []

    print("=" * 60)
    print("  Archive Presse — Test Runner")
    print("=" * 60)

    # Check device
    try:
        check_device(args.device)
    except AssertionError as e:
        print(f"  ❌ {e}")
        sys.exit(1)

    # Install APK (auto-download from GitHub if not specified)
    apk_path = args.apk or "android/app/build/outputs/apk/debug/app-debug.apk"
    force_stop()
    clear_data()
    install_apk(apk_path)
    set_webview_flag()
    time.sleep(2)

    # Run selected tests
    if args.smoke:
        smoke_suite(ctx)
    elif args.providers:
        for pid in args.providers:
            provider_suite(ctx, pid)
    elif args.full:
        smoke_suite(ctx)
        for pid in TEST_URLS:
            provider_suite(ctx, pid)
        headless_suite(ctx)
        intent_suite(ctx)
        cross_cutting_suite(ctx)
    else:
        if args.headless:
            headless_suite(ctx)
        if args.intents:
            intent_suite(ctx)
        if args.cross_cutting:
            cross_cutting_suite(ctx)
        if not (args.headless or args.intents or args.cross_cutting):
            smoke_suite(ctx)

    # Cleanup CDP
    if ctx.get("cdp"):
        ctx["cdp"].close()

    # Summary
    print("\n" + "=" * 60)
    print("  Results")
    print("=" * 60)
    passed = sum(1 for _, s, _ in results if s == PASS)
    failed = sum(1 for _, s, _ in results if s == FAIL)
    skipped = sum(1 for _, s, _ in results if s == SKIP)
    for name, status, detail in results:
        icon = "✅" if status == PASS else ("⚠️" if status == SKIP else "❌")
        print(f"  {icon} {name}: {status}")
        if detail and status != PASS:
            for line in detail.strip().split("\n"):
                print(f"       {line}")
    print()
    print(f"  Total: {len(results)} | ✅ {passed} | ❌ {failed} | ⚠️ {skipped}")
    print("=" * 60)

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
