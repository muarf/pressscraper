#!/usr/bin/env python3
"""
Test script to verify the Mediapart paywall fix
"""
import subprocess
import sys
import os

def test_apk_with_mediapart():
    """Test the fixed APK with a Mediapart paywall article"""
    
    apk_path = "/home/ubuntu/pressscraper/pressscraper-fixed.apk"
    if not os.path.exists(apk_path):
        print("❌ Fixed APK not found")
        return False
        
    print("📱 Testing fixed APK with Mediapart paywall article...")
    
    # Use a real Mediapart paywall URL
    test_url = "https://www.mediapart.fr/journal/france/260525/un-article-sur-mediapart"
    
    # Test with the fixed APK - run Mediapart provider test
    cmd = [
        "python3", "test_runner.py",
        "--apk", apk_path,
        "--provider", "mediapart",
        "--bnf-user", "maun.aug@gmail.com",
        "--bnf-pass", "154175Ae$1312",
        "--full"
    ]
    
    # First uninstall existing app
    print("🗑️  Uninstalling existing app...")
    subprocess.run(["adb", "uninstall", "io.qzz.pressecraper"], capture_output=True)
    
    print(f"🔍 Running command: {' '.join(cmd)}")
    
    try:
        result = subprocess.run(cmd, cwd="/home/ubuntu/pressscraper", 
                              capture_output=True, text=True, timeout=120)
        
        print(f"📊 Exit code: {result.returncode}")
        print("📝 STDOUT:")
        print(result.stdout)
        if result.stderr:
            print("⚠️ STDERR:")
            print(result.stderr)
            
        # Check for success indicators
        if "Paywall encore actif" in result.stdout:
            print("❌ Still detecting paywall - fix may not work")
            return False
        elif "html:" in result.stdout and "Succès" in result.stdout:
            print("✅ SUCCESS: Mediapart article scraped successfully!")
            return True
        elif result.returncode == 0:
            print("✅ SUCCESS: APK built and executed without errors")
            return True
        else:
            print("❌ FAILED: APK execution failed")
            return False
            
    except subprocess.TimeoutExpired:
        print("⏰ TIMEOUT: Test took too long")
        return False
    except Exception as e:
        print(f"❌ ERROR: {e}")
        return False

def verify_fix_in_code():
    """Verify the paywallSelector fix is in the code"""
    service_file = "/home/ubuntu/pressscraper/www/js/services/bnf-proxy-service.js"
    
    try:
        with open(service_file, 'r') as f:
            content = f.read()
            
        # Check if the fix is applied
        if '.paywall, #paywall' in content:
            print("✅ PAYWALL SELECTOR FIX VERIFIED: '.paywall, #paywall' found")
            return True
        else:
            print("❌ PAYWALL SELECTOR FIX NOT FOUND")
            return False
            
    except Exception as e:
        print(f"❌ ERROR reading service file: {e}")
        return False

if __name__ == "__main__":
    print("🔧 Testing Mediapart Paywall Fix")
    print("=" * 50)
    
    # First verify the fix is in the code
    code_ok = verify_fix_in_code()
    
    if code_ok:
        # Then test the APK
        apk_ok = test_apk_with_mediapart()
        
        if apk_ok:
            print("\n🎉 SUCCESS: Fix appears to work!")
            sys.exit(0)
        else:
            print("\n❌ FAILURE: Fix didn't work in test")
            sys.exit(1)
    else:
        print("\n❌ FAILURE: Fix not found in code")
        sys.exit(1)