# CoinCap Migration Status

## ✅ Completed

1. **Worker Code Updated**
   - Replaced CoinGecko API with CoinCap Pro API
   - Added `coinCapAuthHeaders()` helper with Bearer token auth
   - Created `fetchAssetsBatch()` for price data
   - Created `fetchAssetHistory()` for historical data
   - Updated all handlers to use CoinCap endpoints
   - Kept robust features: coalescing, backoff, POP caching

2. **API Key Configured**
   - `COINCAP_API_KEY` set in Wrangler secrets ✅
   - Key: e3a3be2e1d8a7df455f80fd5449c735d288e894c5f76ad02d50aff93dbc82228

3. **Worker Deployed**
   - Version ID: 07265bd9-2f65-477f-b4f4-273a55aa4aed
   - URL: https://crypto-mood-dashboard-production.smah0085.workers.dev

4. **Documentation Updated**
   - SECRETS_SETUP.md: Added COINCAP_API_KEY instructions
   - wrangler.toml: Updated secrets documentation
   - README.md: Changed data source from CoinGecko to CoinCap Pro

## 🐛 Current Issue

**Symptom**: Worker still returning `source: "coingecko"` with very old timestamps

**Root Cause**: Worker is likely hitting errors when calling CoinCap API and falling back to stale KV cache (stale-if-error behavior)

**Evidence**:
- Responses show `X-Cache-Status: stale-if-error`
- Timestamps are 2-3 hours old
- High latency (18-20 seconds) suggests timeout/retry cycles

**Possible Causes**:
1. DNS resolution issue for api.coincap.io
2. Authentication header format incorrect
3. CoinCap API endpoint structure different than expected
4. Network connectivity from Cloudflare Workers to CoinCap

## 🔍 Debugging Steps

### Test CoinCap API Directly

From a machine with working DNS:

```bash
# Test without auth
curl "https://api.coincap.io/v2/assets?ids=bitcoin"

# Test with auth (Pro key)
curl "https://api.coincap.io/v2/assets?ids=bitcoin" \
  -H "Authorization: Bearer e3a3be2e1d8a7df455f80fd5449c735d288e894c5f76ad02d50aff93dbc82228"

# Test history endpoint
curl "https://api.coincap.io/v2/assets/bitcoin/history?interval=d1&start=1730851200000&end=1731456000000"
```

### Check Worker Logs

```bash
npx wrangler tail --format=pretty
```

Look for:
- `[fetchAssetsBatch] CoinCap API error...` (shows upstream errors)
- `[rateLimitedFetch] Attempt 1/5 for https://api.coincap.io...`
- Any DNS or connection errors

### Test Specific Endpoints

```powershell
# Force fresh fetch
$ts = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
Invoke-RestMethod -Uri "https://crypto-mood-dashboard-production.smah0085.workers.dev/price?coin=dash&_=$ts"
```

## 🔧 Potential Fixes

### If DNS Issue

CoinCap might use a different domain for Pro users. Check:
- Is it `api.coincap.io` or `pro-api.coincap.io`?
- Does Pro version require different base URL?

### If Auth Issue

Verify Bearer token format:
```javascript
headers['Authorization'] = `Bearer ${env.COINCAP_API_KEY}`;
```

### If Endpoint Structure Issue

CoinCap's batch endpoint might be:
- `/assets?ids=bitcoin,ethereum` (current)
- `/assets` with `?search=bitcoin` (alternative)
- Individual `/assets/bitcoin` (fallback)

## 📋 Next Steps

1. **Verify CoinCap API Accessibility**
   - Test from different network
   - Check if Cloudflare Workers can reach api.coincap.io
   - Verify API key is valid

2. **Clear KV Cache** (if needed)
   ```bash
   # Force delete old cache keys
   npx wrangler kv:key delete price_bitcoin --namespace-id=dbbe66243f7a4ecaa97f1e14a3ea2a19
   npx wrangler kv:key delete history_bitcoin_7 --namespace-id=dbbe66243f7a4ecaa97f1e14a3ea2a19
   ```

3. **Monitor Fresh Requests**
   ```bash
   npx wrangler tail
   # Then trigger: curl with new timestamp
   ```

4. **Fallback Plan**
   - If CoinCap inaccessible, revert to CoinGecko temporarily
   - Or use CoinCap's free tier endpoint structure

## 📊 Expected Behavior (When Fixed)

### Successful Response

```json
{
  "coin": "bitcoin",
  "price": 101957,
  "change24h": 1.58,
  "market_cap": 2033013793995.41,
  "volume_24h": 76304398540.13,
  "symbol": "BTC",
  "source": "coincap",
  "timestamp": "2025-11-08T13:40:00.000Z"
}
```

### Headers

```
Cache-Control: s-maxage=60, max-age=0, must-revalidate
X-Cache-Status: miss | fresh
X-Cache-Source: api
X-Latency-ms: < 1000
```

## 🔧 Fixes Applied (November 9, 2025)

### 1. Legacy Cache Auto-Purge
- Added automatic detection and purging of CoinGecko cache entries in `getCachedPriceData()` and `getCachedHistoryData()`
- When a cache entry with `source: "coingecko"` is found, it's automatically deleted and fresh CoinCap data is fetched
- Prevents serving stale CoinGecko data after migration

### 2. Improved Diagnostics
- Enhanced `rateLimitedFetch()` to track and report detailed error information
- DNS/Network errors are now explicitly detected and logged with ⚠️ warnings
- `exhausted-retries` errors now include `lastError` details showing error type and message
- Error responses include `code`, `details`, and `diagnostic` fields for troubleshooting

### 3. Admin Endpoint for Cache Purge
- Added `/admin/purge-legacy-cache` endpoint (protected with `ADMIN_PURGE_TOKEN`)
- Scans all SUPPORTED_COINS and deletes price/history cache entries with `source: "coingecko"`
- Returns detailed report of deleted keys and any errors encountered

### 4. Better Error Responses
- Price/History endpoints now return 502 (Bad Gateway) for upstream failures instead of 500
- Error responses include structured details: error code, diagnostic info, timestamp
- Clients can now distinguish between DNS issues, rate limiting, and server errors

## 🚀 Status

- Code: ✅ Updated with migration fixes
- API Key: ✅ CoinCap configured
- Legacy Cache Purge: ✅ Auto-purge on read + admin endpoint
- Diagnostics: ✅ Enhanced error logging and reporting
- Functionality: 🔄 Ready for deployment and verification

**Last Updated**: November 9, 2025  
**Changes**: Added legacy cache auto-purge, improved diagnostics, admin endpoint

