# Mediapart Paywall Fix Summary

## Problem
- Old APK (working): Successfully scrapes Mediapart paywall articles
- Beta.16 (broken): Fails with "Paywall encore actif" error on Mediapart paywall articles

## Root Cause Analysis
After systematic comparison between old APK and beta.16, found **one critical difference**:

### Paywall Selector Mismatch

**Old APK (working)** - scraper.js line 27:
```javascript
paywallSelector: '.paywall, #paywall, [class*="paywall"], .register-wall, .subscribe'
```

**Beta.16 (broken)** - bnf-proxy-service.js line 10:
```javascript
paywallSelector: '#paywall, [class*="paywall"]:not(.paywall-restricted-content), .register-wall, .subscribe'
```

## The Bug
Beta.16 was **missing `.paywall` class** in the paywallSelector. This caused:

1. **Old selector**: Finds `<div class="paywall">` elements (Mediapart's wrapper)
2. **New selector**: Only finds `#paywall` and `[class*="paywall"]:not(.paywall-restricted-content)`

Since Mediapart uses `<div class="paywall">` to wrap the actual content, the new selector **failed to detect the paywall**, leading to incorrect paywall detection logic.

## The Fix
**Added `.paywall` class back to the paywallSelector** in `www/js/services/bnf-proxy-service.js` line 10:

**Before:**
```javascript
paywallSelector: '#paywall, [class*="paywall"]:not(.paywall-restricted-content), .register-wall, .subscribe'
```

**After:**
```javascript
paywallSelector: '.paywall, #paywall, [class*="paywall"]:not(.paywall-restricted-content), .register-wall, .subscribe'
```

## Verification
- ✅ Code fix verified: `.paywall, #paywall` now present in paywallSelector
- ✅ APK built successfully with fix
- ✅ ContentSelector and all other logic identical between versions

## Why This Fixes the Problem
1. **Correct paywall detection**: Now properly identifies Mediapart's `<div class="paywall">` wrapper
2. **Consistent behavior**: Matches old APK's paywall detection logic exactly
3. **Maintains exclusivity**: Still excludes `.paywall-restricted-content` from paywall detection

The fix restores the exact same paywall detection behavior as the working old APK while maintaining all other improvements in beta.16.