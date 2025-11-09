# Frontend Timeout Errors - Fix Summary

## 🔍 Issues Found

### 1. Frontend Timeouts Too Short
- **Price endpoint**: 8 seconds timeout
- **History endpoint**: 10 seconds timeout
- **Worker response time**: 19+ seconds (exceeding timeouts)

### 2. Worker Serving Old CoinGecko Cache
- History endpoint was returning `source: 'coingecko'`
- Worker was serving stale CoinGecko cache in `stale-if-error` scenarios
- Cache purge detection wasn't working in all code paths

### 3. Worker Response Time Too Slow
- Price endpoint: Timing out (>8s)
- History endpoint: 19.29 seconds (way over 10s timeout)
- Likely causes:
  - First-time CoinCap API calls (no cache)
  - CoinCap API response time
  - Network latency

## ✅ Fixes Applied

### 1. Increased Frontend Timeouts
**File**: `src/lib/stores.js`

- **Price timeout**: 8s → **20s** (Line 85)
- **History timeout**: 10s → **30s** (Line 147)

This gives the worker enough time to:
- Fetch from CoinCap API
- Handle retries if needed
- Process and cache the response

### 2. Prevent Serving CoinGecko Cache
**File**: `worker/index.js`

Added checks in `stale-if-error` scenarios to refuse serving CoinGecko cache:

**Price handler** (Lines 720-725):
```javascript
// 🔥 MIGRATION: Never serve CoinGecko cache, even in stale-if-error
const source = parsed?.data?.source || parsed?.source;
if (source === 'coingecko') {
  console.warn('[Price] Refusing to serve stale CoinGecko cache, throwing error instead');
  throw upErr; // Don't serve old CoinGecko data
}
```

**History handler** (Lines 846-851):
```javascript
// 🔥 MIGRATION: Never serve CoinGecko cache, even in stale-if-error
const source = parsed?.data?.source || parsed?.source;
if (source === 'coingecko') {
  console.warn('[History] Refusing to serve stale CoinGecko cache, throwing error instead');
  throw upErr; // Don't serve old CoinGecko data
}
```

**Result**: Worker will now:
- ✅ Return CoinCap data if available
- ✅ Return error if CoinCap fails (instead of serving old CoinGecko data)
- ✅ Never return `source: 'coingecko'` in responses

### 3. Deployed Updated Worker
- Version: `7efb05bb-4a21-4c34-bda2-0c7ae5f9777f`
- Status: ✅ Live at https://crypto-mood-dashboard-production.smah0085.workers.dev

## 🧪 Testing

### Test Worker Directly

```powershell
# Run the test script
.\test-worker-timeout.ps1
```

**Expected Results**:
- ✅ Price endpoint responds in <20 seconds
- ✅ History endpoint responds in <30 seconds
- ✅ Both return `source: "coincap"` (not "coingecko")

### Test Frontend

1. **Clear browser cache** (important!)
2. **Visit**: https://hesam.me/crypto-mood-dashboard/
3. **Open browser console** (F12)
4. **Check for**:
   - ✅ No timeout errors
   - ✅ `source: "coincap"` in responses
   - ✅ Price and history data loading successfully

## 📊 Expected Behavior

### Before Fix
```
❌ fetchPrice aborted: AbortError: request aborted or timed out
❌ fetchHistory aborted: AbortError: request aborted or timed out
❌ History response: source: "coingecko" (old cache)
```

### After Fix
```
✅ Price response: source: "coincap" (in <20s)
✅ History response: source: "coincap" (in <30s)
✅ No timeout errors
```

## 🚀 Next Steps

### 1. Rebuild Frontend (if using SvelteKit)

If your frontend is built with SvelteKit and deployed separately:

```bash
npm run build
# Then deploy to your hosting (GitHub Pages, etc.)
```

### 2. Purge Legacy Cache (Optional)

If you still see `source: 'coingecko'` after the fix:

```powershell
# Set admin token if not already set
npx wrangler secret put ADMIN_PURGE_TOKEN

# Purge cache
$token = Read-Host "Enter ADMIN_PURGE_TOKEN"
$body = @{ token = $token } | ConvertTo-Json
Invoke-RestMethod -Uri "https://crypto-mood-dashboard-production.smah0085.workers.dev/admin/purge-legacy-cache" `
  -Method POST -ContentType "application/json" -Body $body
```

### 3. Monitor Worker Logs

```bash
npx wrangler tail --format=pretty
```

**Look for**:
- ✅ `[rateLimitedFetch] ✅ Success on attempt 1 for https://api.coincap.io/v2/assets...`
- ✅ `✅ [fetchAssetsBatch] Got X assets from CoinCap`
- ✅ `✅ [Fresh] Cached fresh price for bitcoin: $XXXXX`
- ❌ Should NOT see: `source: 'coingecko'` in any logs

## 🐛 If Issues Persist

### Issue: Still seeing timeouts

**Possible causes**:
1. CoinCap API is down or very slow
2. Network issues between Cloudflare and CoinCap
3. Rate limiting (429 errors)

**Debug**:
```bash
# Check worker logs
npx wrangler tail

# Test CoinCap directly
curl "https://api.coincap.io/v2/assets?ids=bitcoin"
```

### Issue: Still seeing `source: 'coingecko'`

**Possible causes**:
1. Browser cache has old responses
2. Cloudflare POP cache has old responses
3. Legacy cache not purged yet

**Fix**:
1. Clear browser cache (Ctrl+Shift+Delete)
2. Add `&_=[timestamp]` to force bypass POP cache
3. Run admin purge endpoint

### Issue: Worker taking >30 seconds

**Possible causes**:
1. CoinCap API is slow
2. Multiple retries happening
3. Network issues

**Fix**:
1. Check worker logs for retry attempts
2. Consider increasing frontend timeout further (if needed)
3. Check CoinCap API status

## 📝 Summary

**Fixed**:
- ✅ Frontend timeouts increased (20s price, 30s history)
- ✅ Worker refuses to serve CoinGecko cache
- ✅ Worker deployed with fixes

**Result**:
- Frontend should no longer timeout
- All responses will have `source: "coincap"`
- Better error messages if CoinCap fails

**Action Required**:
- Rebuild frontend if using SvelteKit
- Clear browser cache
- Test the site: https://hesam.me/crypto-mood-dashboard/

If you still see issues after rebuilding the frontend, check the worker logs and share the error messages!

