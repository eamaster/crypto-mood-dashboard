# CoinGecko vs CoinCap - Code Clarification

## ❓ Confusion About "coingecko" References in Code

If you see strings like `'coingecko'` in the worker code, **DO NOT PANIC**! The worker is **NOT using CoinGecko API** - these are detection checks to find and DELETE old cache entries.

## ✅ What the Worker Actually Uses

### The Worker ONLY Uses CoinCap API:

```javascript
// Line 114-115: CoinCap API base URL
const COINCAP_API_BASE = 'https://api.coincap.io/v2';
const COINCAP_BATCH_ENDPOINT = `${COINCAP_API_BASE}/assets`;

// Line 118-124: CoinCap authentication (Bearer token)
function coinCapAuthHeaders(env) {
  const headers = { 'Accept': 'application/json' };
  if (env && env.COINCAP_API_KEY) {
    headers['Authorization'] = `Bearer ${env.COINCAP_API_KEY}`;  // ← CoinCap auth!
  }
  return headers;
}

// Line 287: Fetch prices from CoinCap
const url = `${COINCAP_BATCH_ENDPOINT}?ids=${encodeURIComponent(idsCsv)}`;
// Result: https://api.coincap.io/v2/assets?ids=bitcoin,ethereum

// Line 340: Fetch history from CoinCap
const url = `${COINCAP_API_BASE}/assets/${coinId}/history?interval=${interval}&start=${start}&end=${end}`;
// Result: https://api.coincap.io/v2/assets/bitcoin/history?interval=d1&start=...&end=...
```

### Every Response Sets `source: 'coincap'`:

```javascript
// Line 322 (fetchAssetsBatch result):
resultMap[it.id.toLowerCase()] = {
  coin: it.id.toLowerCase(),
  price: Math.round(price * 100) / 100,
  // ...
  source: 'coincap'  // ← NEW data is tagged as 'coincap'!
};

// Line 374 (fetchAssetHistory result):
return {
  coin: coinId,
  prices: points,
  // ...
  source: 'coincap',  // ← NEW data is tagged as 'coincap'!
  note: 'Real market data from CoinCap'
};
```

## 🔍 Why You See `'coingecko'` in Code

These are **DETECTION CHECKS** to find OLD cached data and DELETE it:

### Example 1: Price Cache Detection (Lines 399-407)

```javascript
// 🔥 MIGRATION: Detect and purge legacy CoinGecko cache entries
// This checks if cached data was from OLD CoinGecko API and deletes it
// Then fetches FRESH data from NEW CoinCap API
const source = data?.source;
if (source === 'coingecko') {  // ← Checking if OLD cache has 'coingecko'
  console.log(`🧹 [Migration] Found legacy CoinGecko cache for ${cacheKey}, deleting and forcing CoinCap refresh`);
  await env.RATE_LIMIT_KV.delete(cacheKey);  // ← DELETE the old entry
  return await fetchFreshPriceData(coinId, env); // ← Fetch NEW data from CoinCap!
}
```

**Translation**: "If I find cache with `source: 'coingecko'`, throw it away and get fresh data from CoinCap instead."

### Example 2: Admin Purge Endpoint (Lines 2313-2318)

```javascript
const source = parsed?.data?.source || parsed?.source;
// Check if this is OLD CoinGecko data → DELETE it
if (source === 'coingecko') {  // ← Checking for OLD data
  await env.RATE_LIMIT_KV.delete(priceKey);  // ← DELETE it!
  deleted.push(priceKey);
  console.log(`[Admin] ❌ Deleted legacy CoinGecko price cache: ${priceKey}`);
}
```

**Translation**: "Scan all cache keys. If any have `source: 'coingecko'`, delete them so fresh CoinCap data will be fetched."

## 📊 API Integration Verification

### CoinCap Batch Price Endpoint

**Code Implementation** (Line 287):
```javascript
const url = `${COINCAP_BATCH_ENDPOINT}?ids=${encodeURIComponent(idsCsv)}`;
// Example: https://api.coincap.io/v2/assets?ids=bitcoin,ethereum,litecoin
```

**CoinCap API Docs**: [GET /assets](https://coincapapi.mintlify.app/api-reference/endpoint/asset/all-crypto)
```
GET /assets?ids=bitcoin,ethereum,monero
Authorization: Bearer <token>
```

✅ **Match!**

### CoinCap History Endpoint

**Code Implementation** (Line 340):
```javascript
const interval = days >= 7 ? 'd1' : 'h1';
const url = `${COINCAP_API_BASE}/assets/${coinId}/history?interval=${interval}&start=${start}&end=${end}`;
// Example: https://api.coincap.io/v2/assets/bitcoin/history?interval=d1&start=1730851200000&end=1731456000000
```

**CoinCap API Docs**: [GET /assets/{id}/history](https://coincapapi.mintlify.app/api-reference/endpoint/asset/history)
```
GET /assets/{id}/history?interval=d1&start=<unix_ms>&end=<unix_ms>
Authorization: Bearer <token>
```

✅ **Match!**

### Response Data Mapping

**Code Implementation** (Lines 309-323):
```javascript
const price = Number(it.priceUsd || 0);           // ← CoinCap field
const change24h = Number(it.changePercent24Hr || 0);  // ← CoinCap field
const market_cap = Number(it.marketCapUsd || 0);      // ← CoinCap field
const volume_24h = Number(it.volumeUsd24Hr || 0);     // ← CoinCap field

resultMap[it.id.toLowerCase()] = {
  coin: it.id.toLowerCase(),
  price: Math.round(price * 100) / 100,
  change24h: Math.round(change24h * 100) / 100,
  market_cap,
  volume_24h,
  symbol: it.symbol || it.id.toUpperCase(),
  timestamp: new Date().toISOString(),
  source: 'coincap'  // ← Tags NEW data as 'coincap'
};
```

**CoinCap API Response Format**:
```json
{
  "id": "bitcoin",
  "symbol": "BTC",
  "priceUsd": "96243.89",
  "changePercent24Hr": "0.976",
  "marketCapUsd": "1904557171625.09",
  "volumeUsd24Hr": "12724040223.14"
}
```

✅ **Match!**

## 🎯 Summary

| Component | Status | Details |
|-----------|--------|---------|
| **API Endpoint** | ✅ CoinCap | `https://api.coincap.io/v2/assets` |
| **Authentication** | ✅ CoinCap | `Authorization: Bearer ${COINCAP_API_KEY}` |
| **Response Parsing** | ✅ CoinCap | Uses `priceUsd`, `changePercent24Hr`, etc. |
| **Source Tag** | ✅ CoinCap | All new data tagged as `source: 'coincap'` |
| **"coingecko" strings** | ℹ️ Detection Only | Used to FIND and DELETE old cache |

## 🔄 What Happens on Request

1. Client requests: `GET /price?coin=bitcoin`
2. Worker checks cache for `price_bitcoin`
3. **If cache has `source: 'coingecko'`** → **DELETE it** → Fetch from CoinCap
4. **If cache has `source: 'coincap'`** → Use it (if fresh) or refresh from CoinCap
5. **If no cache** → Fetch from CoinCap
6. Worker calls: `https://api.coincap.io/v2/assets?ids=bitcoin` with Bearer token
7. Worker receives CoinCap data and tags it: `source: 'coincap'`
8. Worker caches the result with `source: 'coincap'`
9. Client receives: `{ price: 101957, source: "coincap", ... }`

## 🚫 The Worker Does NOT:

- ❌ Call any CoinGecko API endpoints
- ❌ Use CoinGecko authentication
- ❌ Parse CoinGecko response format
- ❌ Return `source: 'coingecko'` for NEW requests

## ✅ The Worker DOES:

- ✅ Call CoinCap API: `api.coincap.io/v2/assets`
- ✅ Use CoinCap Bearer auth: `Authorization: Bearer ${COINCAP_API_KEY}`
- ✅ Parse CoinCap fields: `priceUsd`, `changePercent24Hr`, `marketCapUsd`
- ✅ Return `source: 'coincap'` for ALL new data
- ✅ Detect and DELETE any old `source: 'coingecko'` cache entries

## 📝 Remaining "coingecko" References Explained

| Location | Code | Purpose |
|----------|------|---------|
| Lines 399-407 | `if (source === 'coingecko')` | **DETECTION** - checks if cached data is OLD |
| Lines 533-541 | `if (source === 'coingecko')` | **DETECTION** - checks if cached data is OLD |
| Lines 2313-2318 | `if (source === 'coingecko')` | **DETECTION** - checks if cached data is OLD |
| Lines 2341-2346 | `if (source === 'coingecko')` | **DETECTION** - checks if cached data is OLD |

**These are NOT API calls!** They're cache validation checks that say:
> "If this cache entry was from the old CoinGecko system, throw it away and get new data from CoinCap."

## 🧪 How to Verify

Test the worker and check the `source` field:

```powershell
# Fetch Bitcoin price
$result = Invoke-RestMethod -Uri "https://crypto-mood-dashboard-production.smah0085.workers.dev/price?coin=bitcoin&_=$(Get-Date -UFormat %s)000"
Write-Host "Source: $($result.source)"  # Should print "coincap"
```

**Expected**: `Source: coincap` (NOT "coingecko")

If you see `source: coingecko`, it means:
1. You haven't deployed the updated worker yet, OR
2. The old cache hasn't been accessed/purged yet (run admin purge endpoint)

## 🎯 Conclusion

**The worker IS using CoinCap API correctly!** The `'coingecko'` strings you see are for **detecting and deleting old cache entries**, not for calling the CoinGecko API.

After deployment and cache purge, you will ONLY see `source: "coincap"` in all responses.

