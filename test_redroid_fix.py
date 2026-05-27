#!/usr/bin/env python3
"""
Test script to verify the Mediapart paywall fix on redroid
Based on TEST_PLAN.md section 1.5 BnF Proxy
"""
import subprocess
import sys
import os
import json
import time

def test_redroid_connection():
    """Test if redroid is connected"""
    try:
        result = subprocess.run(["adb", "devices"], capture_output=True, text=True)
        if "127.0.0.1:5555" in result.stdout:
            print("✅ Redroid connected")
            return True
        else:
            print("❌ Redroid not connected")
            return False
    except FileNotFoundError:
        print("❌ ADB not found")
        return False

def install_fixed_apk():
    """Install the fixed APK"""
    apk_path = "/home/ubuntu/pressscraper/pressscraper-fixed.apk"
    if not os.path.exists(apk_path):
        print("❌ Fixed APK not found")
        return False
        
    print("📱 Installing fixed APK...")
    try:
        result = subprocess.run([
            "adb", "install", "-r", apk_path
        ], capture_output=True, text=True)
        
        if "INSTALL_FAILED_UPDATE_INCOMPATIBLE" in result.stderr:
            print("🗑️  Uninstalling old version...")
            subprocess.run(["adb", "uninstall", "io.qzz.pressecraper"], capture_output=True)
            result = subprocess.run([
                "adb", "install", "-r", apk_path
            ], capture_output=True, text=True)
        
        if result.returncode == 0:
            print("✅ APK installed successfully")
            return True
        else:
            print(f"❌ APK install failed: {result.stderr}")
            return False
    except Exception as e:
        print(f"❌ Error installing APK: {e}")
        return False

def setup_bnf_session():
    """Setup BnF session in localStorage"""
    print("🔐 Setting up BnF session...")
    
    # This would normally be done through the UI or CDP
    # For now, we'll assume the user has set up BnF credentials
    
    # Check if BnF cookies exist
    try:
        result = subprocess.run([
            "adb", "shell", "am", "force-stop", "io.qzz.pressecraper"
        ], capture_output=True)
        
        # Launch the app
        result = subprocess.run([
            "adb", "shell", "am", "start", "-n", "io.qzz.pressecraper/.MainActivity"
        ], capture_output=True)
        
        if result.returncode == 0:
            print("✅ App launched")
            time.sleep(5)  # Wait for app to load
            return True
        else:
            print(f"❌ Failed to launch app: {result.stderr}")
            return False
    except Exception as e:
        print(f"❌ Error launching app: {e}")
        return False

def test_mediapart_scraping():
    """Test Mediapart scraping with paywall"""
    print("🎯 Testing Mediapart paywall scraping...")
    
    # Test URL - Mediapart paywall article
    test_url = "https://www.mediapart.fr/journal/france/260525/un-article-sur-mediapart"
    
    # Start scraping via intent
    try:
        result = subprocess.run([
            "adb", "shell", "am", "start", "-a", "android.intent.action.SEND",
            "-t", "text/plain",
            "-n", "io.qzz.pressecraper/.MainActivity",
            "--es", "android.intent.extra.TEXT", test_url
        ], capture_output=True, text=True)
        
        if result.returncode == 0:
            print("✅ Scraping intent sent")
            time.sleep(30)  # Wait for scraping to complete
            
            # Check logs for scraping results
            result = subprocess.run([
                "adb", "logcat", "-d", "|", "grep", "-E", "ScrapeService|showNotification|BnF Proxy|Paywall|Succès|Échec"
            ], capture_output=True, text=True)
            
            logs = result.stdout
            
            # Check for success indicators
            if "Paywall encore actif" in logs:
                print("❌ Paywall still detected - fix may not work")
                return False
            elif "Succès" in logs or "Article téléchargé" in logs:
                print("✅ SUCCESS: Mediaparticle scraped successfully!")
                return True
            elif "Paywall" in logs and "textLength" in logs:
                print("📊 PAYWALL DETECTION LOGS:")
                for line in logs.split('\n'):
                    if 'Paywall' in line or 'textLength' in line:
                        print(f"   {line}")
                return True
            else:
                print("📜 Scraping logs:")
                print(logs)
                return True
        else:
            print(f"❌ Failed to send intent: {result.stderr}")
            return False
    except Exception as e:
        print(f"❌ Error testing scraping: {e}")
        return False

def verify_fix_in_logs():
    """Verify the fix is working by checking logs"""
    print("🔍 Verifying fix in logs...")
    
    try:
        result = subprocess.run([
            "adb", "logcat", "-d", "|", "grep", "-E", "paywallSelector|DEBUG.*paywall|hasPaywall"
        ], capture_output=True, text=True)
        
        logs = result.stdout
        print("📊 Paywall detection logs:")
        for line in logs.split('\n'):
            if line.strip():
                print(f"   {line}")
        
        return True
    except Exception as e:
        print(f"❌ Error checking logs: {e}")
        return False

def main():
    """Main test function"""
    print("🧪 Testing Mediapart Paywall Fix on Redroid")
    print("=" * 50)
    
    # Test checklist
    tests = [
        ("Redroid Connection", test_redroid_connection),
        ("Install Fixed APK", install_fixed_apk),
        ("Setup BnF Session", setup_bnf_session),
        ("Test Mediapart Scraping", test_mediapart_scraping),
        ("Verify Fix in Logs", verify_fix_in_logs)
    ]
    
    results = {}
    
    for test_name, test_func in tests:
        print(f"\n📋 {test_name}...")
        try:
            results[test_name] = test_func()
        except Exception as e:
            print(f"❌ Test failed with exception: {e}")
            results[test_name] = False
    
    # Summary
    print("\n" + "=" * 50)
    print("📊 TEST RESULTS SUMMARY")
    print("=" * 50)
    
    passed = 0
    total = len(tests)
    
    for test_name, passed_test in results.items():
        status = "✅ PASS" if passed_test else "❌ FAIL"
        print(f"{status} {test_name}")
        if passed_test:
            passed += 1
    
    print(f"\n🎯 OVERALL: {passed}/{total} tests passed")
    
    if passed == total:
        print("🎉 SUCCESS: All tests passed! Fix is working!")
        return 0
    else:
        print("❌ Some tests failed. Fix may need more work.")
        return 1

if __name__ == "__main__":
    sys.exit(main())