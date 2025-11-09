# CoinCap Migration Fix - Verification Guide

## 🎯 What Was Fixed

### 1. **Auto-Purge Legacy CoinGecko Cache**
   - `getCachedPriceData()` now detects `source: "coingecko"` and deletes those entries automatically
   - `getCachedHistoryData()` does the same for historical data
   - Fresh CoinCap data is fetched immediately after purging legacy entries
   - Logs: `🧹 [Migration] Found legacy CoinGecko cache for..., deleting and forcing CoinCap refresh`

### 2. **Enhanced rateLimitedFetch() Diagnostics**
   - Tracks `lastError` with type, name, and message
   - Explicitly detects DNS/Network errors (TypeError, ENOTFOUND)
   - Logs DNS errors with ⚠️: `[rateLimitedFetch] ⚠️ Network/DNS error on attempt X for URL...`
   - Exhausted retries now include: `Last error: DNS/Network - [error message]`

### 3. **Admin Endpoint: `/admin/purge-legacy-cache`**
   - Protected with `ADMIN_PURGE_TOKEN` secret
   - Scans all supported coins and deletes legacy CoinGecko cache entries
   - Returns detailed report: `{ status, deleted, keys, errors, timestamp }`

### 4. **Better Error Responses**
   - Price/History endpoints return 502 (Bad Gateway) for upstream failures
   - Error responses include: `code`, `details`, `diagnostic { type, message }`
   - Clients get actionable error information for debugging

## 📋 Pre-Deployment Checklist

### Step 1: Set Admin Token Secret

```powershell
# Generate a secure random token (PowerShell on Windows)
$token = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | ForEach-Object {[char]$_})
Write-Output $token

# Set it as a Wrangler secret
npx wrangler secret put ADMIN_PURGE_TOKEN
# Paste the token when prompted
```

### Step 2: Deploy Worker

```bash
npx wrangler deploy
```

**Expected Output:**
```
Total Upload: ... KiB / gzip: ... KiB
Uploaded crypto-mood-dashboard-production (X.XX sec)
Deployed crypto-mood-dashboard-production triggers (X.XX sec)
  https://crypto-mood-dashboard-production.smah0085.workers.dev
Current Version ID: [new version ID]
```

## 🧪 Verification Steps

### Test 1: Direct CoinCap API Connectivity

Test from your local machine to confirm CoinCap is reachable:

```bash
# Test without auth (should work)
curl -i "https://api.coincap.io/v2/assets?ids=bitcoin"

# Test with auth (Pro key - replace with your actual key)
curl -i "https://api.coincap.io/v2/assets?ids=bitcoin" \
  -H "Authorization: Bearer YOUR_COINCAP_API_KEY"
```

**Expected**: HTTP 200, JSON response with Bitcoin data

### Test 2: Purge Legacy Cache (Admin Endpoint)

```powershell
# PowerShell (Windows)
$adminToken = "YOUR_ADMIN_TOKEN_HERE"
$body = @{ token = $adminToken } | ConvertTo-Json
Invoke-RestMethod -Uri "https://crypto-mood-dashboard-production.smah0085.workers.dev/admin/purge-legacy-cache" `
  -Method POST `
  -ContentType "application/json" `
  -Body $body
```

**Expected Response:**
```json
{
  "status": "completed",
  "deleted": 48,
  "keys": [
    "price_bitcoin",
    "price_ethereum",
    "price_litecoin",
    "history_bitcoin_7",
    "history_ethereum_7",
    ...
  ],
  "timestamp": "2025-11-09T..."
}
```

**Note**: If `deleted: 0`, that's good - it means there were no legacy cache entries.

### Test 3: Price Endpoint (Force Fresh)

```powershell
# Force fresh fetch for multiple coins
$coins = @('bitcoin', 'ethereum', 'litecoin', 'dogecoin', 'cardano')

foreach ($coin in $coins) {
  $timestamp = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
  Write-Host "Testing $coin..." -ForegroundColor Cyan
  $result = Invoke-RestMethod -Uri "https://crypto-mood-dashboard-production.smah0085.workers.dev/price?coin=$coin&_=$timestamp"
  Write-Host "  Price: `$$($result.price), Source: $($result.source), Symbol: $($result.symbol)" -ForegroundColor Green
}
```

**Expected Output:**
```
Testing bitcoin...
  Price: $101957.42, Source: coincap, Symbol: BTC
Testing ethereum...
  Price: $3421.56, Source: coincap, Symbol: ETH
...
```

**Key Checks:**
- ✅ `source: "coincap"` (NOT "coingecko")
- ✅ Price is current (within last minute)
- ✅ No errors or "exhausted-retries"

### Test 4: History Endpoint

```powershell
$timestamp = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
$result = Invoke-RestMethod -Uri "https://crypto-mood-dashboard-production.smah0085.workers.dev/history?coin=bitcoin&days=7&_=$timestamp"
Write-Host "History: $($result.prices.Count) points, Source: $($result.source)"
```

**Expected:**
- `source: "coincap"`
- 7-168 data points (depending on interval)
- Latest timestamp is recent

### Test 5: Monitor Worker Logs

```bash
npx wrangler tail --format=pretty
```

Then trigger requests from another terminal:

```powershell
# Trigger a price request
$ts = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
Invoke-RestMethod -Uri "https://crypto-mood-dashboard-production.smah0085.workers.dev/price?coin=tezos&_=$ts"
```

**Look for in logs:**
- `[rateLimitedFetch] Attempt 1/5 for https://api.coincap.io/v2/assets?ids=tezos`
- `[rateLimitedFetch] ✅ Success on attempt 1, latency=XXXms`
- `[fetchAssetsBatch] Got 1 assets from CoinCap`
- `✅ [Fresh] Cached fresh price for tezos: $X.XX`

**Should NOT see:**
- ❌ `source: "coingecko"` in responses
- ❌ `exhausted-retries` (unless CoinCap is actually down)
- ❌ `🧹 [Migration] Found legacy CoinGecko cache` (after first purge)

### Test 6: Coalescing (Multiple Concurrent Requests)

Test that the worker properly coalesces multiple identical requests:

```powershell
# Start 6 simultaneous requests
$jobs = 1..6 | ForEach-Object {
  Start-Job -ScriptBlock {
    param($coin, $ts)
    Invoke-RestMethod -Uri "https://crypto-mood-dashboard-production.smah0085.workers.dev/price?coin=$coin&_=$ts"
  } -ArgumentList 'cardano', ([DateTimeOffset]::Now.ToUnixTimeMilliseconds())
}

# Wait for all to complete
$jobs | Wait-Job | Receive-Job
```

**Expected in logs** (with `wrangler tail` running):
- `[rateLimitedFetch] Coalescing request for https://api.coincap.io/v2/assets?ids=cardano` (5 times)
- Only ONE actual fetch to CoinCap
- All 6 requests return same result

## 🐛 Troubleshooting

### Issue: Still seeing `source: "coingecko"`

**Cause**: Old cache hasn't been accessed yet (auto-purge happens on read)

**Fix**: 
1. Use admin endpoint to purge all at once
2. OR force refresh individual coins: `?coin=bitcoin&_=[timestamp]`

### Issue: `exhausted-retries` or DNS errors

**Logs show**: `⚠️ Network/DNS error... TypeError: Failed to fetch`

**Possible Causes**:
1. CoinCap API is unreachable from Cloudflare Workers network
2. DNS resolution issue for api.coincap.io
3. Temporary network glitch

**Debugging**:
```bash
# 1. Test CoinCap from your machine
curl -i "https://api.coincap.io/v2/assets?ids=bitcoin"

# 2. Check Worker logs for exact error
npx wrangler tail

# 3. Try different coin
curl "https://crypto-mood-dashboard-production.smah0085.workers.dev/price?coin=ethereum&_=$(date +%s)000"
```

**If CoinCap is down**: Worker will serve stale-if-error cache (if available) or return 502 with detailed error

### Issue: 403 Forbidden on Admin Endpoint

**Cause**: ADMIN_PURGE_TOKEN not set or token mismatch

**Fix**:
```bash
# Verify secret is set
npx wrangler secret list

# If missing, set it
npx wrangler secret put ADMIN_PURGE_TOKEN
```

## ✅ Success Criteria

After deployment, all of the following should be true:

1. ✅ Price endpoint returns `source: "coincap"` for all coins
2. ✅ History endpoint returns `source: "coincap"` 
3. ✅ Response latency < 2000ms for cache hits
4. ✅ Response latency < 5000ms for cache misses
5. ✅ No `exhausted-retries` errors (unless CoinCap is genuinely down)
6. ✅ Worker logs show successful CoinCap API calls: `✅ Success on attempt 1`
7. ✅ Admin purge endpoint accessible with token
8. ✅ No legacy CoinGecko cache entries after purge

## 📊 Sample Test Session

```powershell
# 1. Generate admin token
$adminToken = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | % {[char]$_})
Write-Host "Admin Token: $adminToken" -ForegroundColor Yellow

# 2. Set the secret
# npx wrangler secret put ADMIN_PURGE_TOKEN
# (paste $adminToken when prompted)

# 3. Deploy
npx wrangler deploy

# 4. Start log monitoring in separate terminal
# npx wrangler tail --format=pretty

# 5. Purge legacy cache
$body = @{ token = $adminToken } | ConvertTo-Json
$purgeResult = Invoke-RestMethod -Uri "https://crypto-mood-dashboard-production.smah0085.workers.dev/admin/purge-legacy-cache" `
  -Method POST `
  -ContentType "application/json" `
  -Body $body
Write-Host "Purged $($purgeResult.deleted) keys" -ForegroundColor Green

# 6. Test price endpoints
$coins = @('bitcoin', 'ethereum', 'litecoin', 'cardano', 'dogecoin')
foreach ($coin in $coins) {
  $ts = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
  $result = Invoke-RestMethod -Uri "https://crypto-mood-dashboard-production.smah0085.workers.dev/price?coin=$coin&_=$ts"
  Write-Host "$coin : `$$($result.price) [source: $($result.source)]" -ForegroundColor Cyan
}

# 7. Test history endpoint
$ts = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
$history = Invoke-RestMethod -Uri "https://crypto-mood-dashboard-production.smah0085.workers.dev/history?coin=bitcoin&days=7&_=$ts"
Write-Host "Bitcoin 7-day history: $($history.prices.Count) points [source: $($history.source)]" -ForegroundColor Cyan

# 8. Check logs output (should show successful CoinCap API calls)
```

## 🎉 Expected Results

After running the test session above:

1. **Purge Result**: Shows number of deleted keys (or 0 if none existed)
2. **Price Results**: All show `source: "coincap"` with current prices
3. **History Result**: Shows `source: "coincap"` with array of price points
4. **Logs**: Show successful API calls with ✅ emoji and latency < 1000ms
5. **No Errors**: No `exhausted-retries`, DNS errors, or 500/502 responses

## 📞 Next Steps If Issues Persist

If you still see problems after these fixes:

1. **Capture full error response**:
   ```powershell
   try {
     $result = Invoke-RestMethod -Uri "..." -ErrorAction Stop
   } catch {
     $_.Exception.Response | ConvertTo-Json
   }
   ```

2. **Check logs with timestamp**:
   ```bash
   npx wrangler tail
   # Note exact timestamp of error and copy full error message
   ```

3. **Test alternative coins**: Try all 16 supported coins - does issue affect all or just some?

4. **Check Cloudflare status**: https://www.cloudflarestatus.com/

5. **Report findings**: Share log excerpts showing:
   - Exact error message from `rateLimitedFetch`
   - HTTP status code and response body
   - Which coin(s) are affected
   - Whether CoinCap direct curl works from your machine

