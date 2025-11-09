# HTTP 530 Error Troubleshooting Guide

## 🔍 What is HTTP 530?

**HTTP 530** is a Cloudflare-specific error code that means:
- **Origin timeout**: The origin server (CoinCap API) is taking too long to respond
- **DNS resolution failure**: Cannot resolve the domain name
- **Connection timeout**: Cannot establish connection to the origin
- **SSL/TLS handshake failure**: SSL connection cannot be established

## 📊 Current Error

```
Error: HTTP 502: {
  "error": "Failed to fetch price data",
  "code": "retries_exhausted",
  "details": "Last error: HTTP - Server error 530",
  "diagnostic": {
    "type": "unknown",
    "message": "Server error 530"
  }
}
```

**Translation**: The Worker tried to call CoinCap API 5 times, but CoinCap returned HTTP 530 each time.

## 🔍 Possible Causes

### 1. CoinCap API Temporarily Down
- CoinCap's infrastructure might be experiencing issues
- Check: https://status.coincap.io/ (if available) or https://downforeveryoneorjustme.com/api.coincap.io

### 2. Network Connectivity Issues
- Problems between Cloudflare Workers network and CoinCap API
- DNS resolution issues
- Firewall/security blocking

### 3. Rate Limiting/Throttling
- CoinCap might be rate-limiting Cloudflare Workers IPs
- Too many requests from the same IP range

### 4. CoinCap API Key Issues
- Invalid or expired API key
- API key not being sent correctly
- Authentication problems

## ✅ Fixes Applied

### 1. Enhanced 530 Error Handling
- **Longer backoff**: 530 errors now use 2s-16s backoff (vs 0.5s-8s for other 5xx)
- **Better logging**: Specific messages for 530 errors
- **Retry strategy**: 5 attempts with exponential backoff

### 2. Improved Error Messages
- Frontend now receives clear error messages
- Suggests retry after 60 seconds
- Includes diagnostic information

### 3. User-Agent Header
- Added `User-Agent: Crypto-Mood-Dashboard/1.0 (Cloudflare Worker)`
- Helps identify legitimate requests

## 🧪 Diagnostic Steps

### Step 1: Check CoinCap API Status

```powershell
# Test CoinCap API directly (from your machine)
Invoke-WebRequest -Uri "https://api.coincap.io/v2/assets?ids=bitcoin" -TimeoutSec 10
```

**Expected**: HTTP 200 with JSON response  
**If fails**: CoinCap API might be down or your network has issues

### Step 2: Check Worker Logs

```bash
npx wrangler tail --format=pretty
```

**Look for**:
- `[rateLimitedFetch] ⚠️ Cloudflare error (530)`
- `[rateLimitedFetch] ❌ Exhausted 5 retries`
- `CoinCap API returned 530 (Cloudflare origin error)`

### Step 3: Verify API Key

```bash
# Check if API key is set
npx wrangler secret list

# Should show: COINCAP_API_KEY
```

### Step 4: Test Worker Directly

```powershell
# Test worker endpoint
$ts = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
Invoke-RestMethod -Uri "https://crypto-mood-dashboard-production.smah0085.workers.dev/price?coin=bitcoin&_=$ts" -TimeoutSec 30
```

## 🔧 Solutions

### Solution 1: Wait and Retry (If Temporary)

HTTP 530 errors are often temporary. The worker will automatically retry, but if it persists:

1. **Wait 5-10 minutes** and try again
2. **Check CoinCap status** (if status page exists)
3. **Monitor worker logs** for improvements

### Solution 2: Verify API Key

```bash
# Verify API key is set correctly
npx wrangler secret list | grep COINCAP_API_KEY

# If not set, set it:
npx wrangler secret put COINCAP_API_KEY
# Paste your CoinCap Pro API key when prompted
```

### Solution 3: Check CoinCap API Documentation

- Verify the API endpoint is correct: `https://api.coincap.io/v2/assets`
- Check if CoinCap requires specific headers
- Verify API key format: `Authorization: Bearer <token>`

### Solution 4: Use Fallback Data (Temporary)

If CoinCap is consistently down, you could:
1. Serve cached data (but we're blocking CoinGecko cache)
2. Show a "Service temporarily unavailable" message
3. Implement a fallback data source (not recommended for production)

### Solution 5: Contact CoinCap Support

If the issue persists:
1. Check CoinCap API status page
2. Contact CoinCap support with:
   - Error: HTTP 530
   - Your API key (masked)
   - Timestamp of errors
   - Worker logs showing 530 errors

## 📋 Worker Improvements Made

### 1. Better 530 Handling
```javascript
// Longer backoff for 530 errors (2s-16s vs 0.5s-8s)
const is530 = resp.status === 530;
const baseBackoff = is530 ? 2000 : 500;
const maxBackoff = is530 ? 16000 : 8000;
```

### 2. Improved Error Messages
```javascript
if (error.lastError.status === 530) {
  errorDetails.message = 'CoinCap API is experiencing connectivity issues (Cloudflare error 530). This is usually temporary. Please try again in a few moments.';
  errorDetails.retry_after = 60;
}
```

### 3. User-Agent Header
```javascript
headers['User-Agent'] = 'Crypto-Mood-Dashboard/1.0 (Cloudflare Worker)';
```

## 🧪 Test After Fixes

```powershell
# Run the test script
.\test-coincap-api.ps1

# Or test manually
$ts = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
$result = Invoke-RestMethod -Uri "https://crypto-mood-dashboard-production.smah0085.workers.dev/price?coin=bitcoin&_=$ts" -TimeoutSec 30
Write-Host "Price: `$$($result.price), Source: $($result.source)"
```

## 🎯 Expected Behavior

### If CoinCap is Working:
```
✅ Worker responds in <5 seconds
✅ Returns: { price: 101957, source: "coincap", ... }
✅ No errors in console
```

### If CoinCap Returns 530:
```
❌ Worker tries 5 times with backoff
❌ Returns: 502 Bad Gateway
✅ Error message: "CoinCap API is experiencing connectivity issues (Cloudflare error 530)..."
✅ Suggests retry after 60 seconds
```

## 📞 Next Steps

1. **Monitor worker logs**: `npx wrangler tail`
2. **Check CoinCap API status** (if status page exists)
3. **Verify API key** is set correctly
4. **Wait a few minutes** and retry (530 errors are often temporary)
5. **Contact CoinCap support** if issue persists for >1 hour

## 🔗 Useful Links

- [CoinCap API Documentation](https://coincapapi.mintlify.app/api-reference/available-Endpoints)
- [CoinCap Pro Dashboard](https://pro.coincap.io/) (to check API key status)
- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [HTTP 530 Error Explanation](https://developers.cloudflare.com/fundamentals/get-started/http-status-codes/)

## 📝 Summary

**Current Status**: Worker is getting HTTP 530 from CoinCap API

**Fixes Applied**:
- ✅ Enhanced 530 error handling (longer backoff)
- ✅ Better error messages for users
- ✅ User-Agent header added
- ✅ Improved logging

**Action Required**:
1. Check CoinCap API status
2. Verify API key is set
3. Monitor worker logs
4. Wait and retry (530 errors are often temporary)

If the issue persists, it's likely a CoinCap API infrastructure problem, not a worker code issue.

