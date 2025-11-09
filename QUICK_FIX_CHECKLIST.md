# Quick Fix Checklist - HTTP 530 Errors

## ✅ Immediate Actions (Do These First)

### 1. Check Worker Logs
```bash
npx wrangler tail --format=pretty
```
**Look for**: `⚠️ Cloudflare error (530)` messages

### 2. Verify API Key is Set
```bash
npx wrangler secret list | findstr COINCAP_API_KEY
```
**Expected**: Should show `COINCAP_API_KEY`

**If missing**:
```bash
npx wrangler secret put COINCAP_API_KEY
# Paste your CoinCap Pro API key when prompted
```

### 3. Test Worker Endpoint
```powershell
$ts = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
Invoke-RestMethod -Uri "https://crypto-mood-dashboard-production.smah0085.workers.dev/price?coin=bitcoin&_=$ts" -TimeoutSec 30
```

**Expected**: 
- ✅ Success: `{ price: 101957, source: "coincap" }`
- ❌ Failure: `502 Bad Gateway` with 530 error details

### 4. Check CoinCap API Status
- Visit: https://pro.coincap.io/ (check if dashboard loads)
- Test: `curl https://api.coincap.io/v2/assets?ids=bitcoin`
- Check: CoinCap status page (if exists)

## 🔍 Diagnosis Results

### If API Key is Missing:
**Fix**: Set it with `npx wrangler secret put COINCAP_API_KEY`

### If API Key is Set but Still Getting 530:
**Likely Cause**: CoinCap API infrastructure issue (outside our control)

**Solutions**:
1. Wait 5-10 minutes and retry
2. Check CoinCap status page
3. Contact CoinCap support
4. Monitor worker logs for improvements

### If Worker Logs Show Success:
**Fix**: Clear browser cache and retry frontend

## 🎯 Expected Outcomes

### ✅ Success (CoinCap Working):
```
Worker Logs:
  [rateLimitedFetch] Attempt 1/5 for https://api.coincap.io/v2/assets?ids=bitcoin
  [rateLimitedFetch] ✅ Success on attempt 1, latency=450ms
  ✅ [fetchAssetsBatch] Got 1 assets from CoinCap

Frontend:
  ✅ No errors
  ✅ Price data displays
  ✅ source: "coincap"
```

### ❌ Failure (CoinCap Returning 530):
```
Worker Logs:
  [rateLimitedFetch] ⚠️ Cloudflare error (530), backing off 2s
  [rateLimitedFetch] ⚠️ Cloudflare error (530), backing off 4s
  ...
  [rateLimitedFetch] ❌ Exhausted 5 retries. CoinCap API returned 530

Frontend:
  ❌ Error: HTTP 502
  ❌ Message: "CoinCap API is experiencing connectivity issues (Cloudflare error 530)..."
```

## 📋 Action Plan

### Step 1: Verify Setup (5 minutes)
- [ ] Check API key is set
- [ ] Check worker logs
- [ ] Test worker endpoint

### Step 2: Diagnose Issue (10 minutes)
- [ ] Identify if API key issue or CoinCap API issue
- [ ] Check CoinCap status
- [ ] Review worker logs for patterns

### Step 3: Apply Fix (5 minutes)
- [ ] If API key missing: Set it
- [ ] If CoinCap down: Wait and retry
- [ ] If persistent: Contact CoinCap support

### Step 4: Monitor (Ongoing)
- [ ] Check worker logs periodically
- [ ] Test endpoint every 5-10 minutes
- [ ] Monitor for recovery

## 🚀 Quick Test Script

Run this to test everything:

```powershell
# 1. Check API key
Write-Host "1. Checking API key..." -ForegroundColor Yellow
npx wrangler secret list | findstr COINCAP_API_KEY

# 2. Test worker
Write-Host "`n2. Testing worker..." -ForegroundColor Yellow
$ts = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
try {
    $result = Invoke-RestMethod -Uri "https://crypto-mood-dashboard-production.smah0085.workers.dev/price?coin=bitcoin&_=$ts" -TimeoutSec 30
    Write-Host "✅ SUCCESS: Price=`$$($result.price), Source=$($result.source)" -ForegroundColor Green
} catch {
    Write-Host "❌ FAILED: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response.StatusCode -eq 502) {
        Write-Host "   This is likely a CoinCap API issue (530 error)" -ForegroundColor Yellow
        Write-Host "   Check worker logs: npx wrangler tail" -ForegroundColor Gray
    }
}

# 3. Check logs
Write-Host "`n3. To check logs, run:" -ForegroundColor Yellow
Write-Host "   npx wrangler tail --format=pretty" -ForegroundColor Gray
```

## 📞 If Still Having Issues

1. **Check worker logs**: `npx wrangler tail`
2. **Verify API key**: `npx wrangler secret list`
3. **Test CoinCap directly**: `curl https://api.coincap.io/v2/assets?ids=bitcoin`
4. **Wait 10 minutes** and retry (530 errors are often temporary)
5. **Contact CoinCap support** if issue persists

## 🎯 Most Likely Cause

Based on the error (`Server error 530`), the most likely cause is:

**CoinCap API infrastructure issue** (not a worker code issue)

**Evidence**:
- Worker code is correct (uses proper CoinCap API endpoints)
- Worker has proper authentication
- Error is HTTP 530 (Cloudflare origin error from CoinCap)
- Worker retries 5 times but all fail with 530

**Solution**: Wait for CoinCap API to recover, or contact CoinCap support.

