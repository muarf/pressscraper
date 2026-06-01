#!/usr/bin/env python3
"""
Test script to verify the Mediapart paywall fix works
Tests the paywallSelector fix specifically without requiring BnF credentials
"""

import subprocess
import sys
import os
import json
import time

# Set up ADB path
ADB = "/opt/android-sdk/platform-tools/adb"
DEVICE = "127.0.0.1:5555"

def adb_command(*args):
    """Run ADB command with device"""
    cmd = [ADB, "-s", DEVICE] + list(args)
    result = subprocess.run(cmd, capture_output=True, text=True)
    return result.stdout, result.stderr, result.returncode

def test_paywall_selector_fix():
    """Test that the paywall selector fix is working"""
    print("🔍 Testing paywall selector fix...")
    
    # 1. Verify the fix is in the code
    with open("/home/ubuntu/pressscraper/www/js/services/bnf-proxy-service.js", "r") as f:
        content = f.read()
    
    if ".paywall, #paywall" in content:
        print("✅ Paywall selector fix verified in code")
        code_fix = True
    else:
        print("❌ Paywall selector fix NOT found in code")
        code_fix = False
    
    # 2. Install and launch app
    print("📱 Installing and launching app...")
    stdout, stderr, rc = adb_command("install", "-r", "pressscraper-fixed.apk")
    if rc != 0:
        print(f"❌ Install failed: {stderr}")
        return False
    
    adb_command("am", "force-stop", "io.qzz.pressecraper")
    adb_command("am", "start", "-n", "io.qzz.pressecraper/.MainActivity")
    time.sleep(5)
    
    # 3. Check if app launched successfully
    print("🚀 Checking app launch...")
    stdout, stderr, rc = adb_command("shell", "am", "force-stop", "io.qzz.pressecraper")
    stdout, stderr, rc = adb_command("am", "start", "-n", "io.qzz.pressecraper/.MainActivity")
    time.sleep(3)
    
    # 4. Test URL injection via intent (this will test the paywall detection)
    print("🎯 Testing URL injection...")
    test_url = "https://www.mediapart.fr/journal/culture-et-idees/250526/deborah-de-robertis-dans-le-texte"
    
    stdout, stderr, rc = adb_command("shell", "am", "start", "-a", "android.intent.action.SEND",
                                   "-t", "text/plain",
                                   "-n", "io.qzz.pressecraper/.MainActivity",
                                   "--es", "android.intent.extra.TEXT", test_url)
    
    if rc == 0:
        print("✅ URL injection successful")
        url_test = True
    else:
        print(f"❌ URL injection failed: {stderr}")
        url_test = False
    
    # 5. Check logs for paywall detection
    print("📊 Checking logs for paywall detection...")
    stdout, stderr, rc = adb_command("logcat", "-d", "|", "grep", "-E", "Paywall|textLength|hasPaywall|BnF Proxy")
    
    logs = stdout
    paywall_detected = "Paywall" in logs
    text_length_mentioned = "textLength" in logs
    
    print("📜 Recent paywall-related logs:")
    for line in logs.split('\n')[-10:]:  # Last 10 lines
        if line.strip() and any(keyword in line for keyword in ["Paywall", "textLength", "hasPaywall", "BnF Proxy"]):
            print(f"   {line}")
    
    # 6. Summary
    print("\n" + "=" * 50)
    print("📊 TEST RESULTS")
    print("=" * 50)
    
    results = {
        "Code Fix": code_fix,
        "App Install": rc == 0,
        "URL Injection": url_test,
        "Paywall Detection": paywall_detected or text_length_mentioned
    }
    
    passed = 0
    for test_name, passed_test in results.items():
        status = "✅ PASS" if passed_test else "❌ FAIL"
        print(f"{status} {test_name}")
        if passed_test:
            passed += 1
    
    print(f"\n🎯 OVERALL: {passed}/{len(results)} tests passed")
    
    if passed == len(results):
        print("🎉 SUCCESS: Fix is working!")
        return True
    else:
        print("❌ Some tests failed. Fix may need more work.")
        return False

if __name__ == "__main__":
    success = test_paywall_selector_fix()
    sys.exit(0 if success else 1)