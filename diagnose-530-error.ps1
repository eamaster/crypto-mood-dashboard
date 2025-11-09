# Comprehensive Diagnostic Script for HTTP 530 Errors
Write-Host "🔍 HTTP 530 Error Diagnostic Tool`n" -ForegroundColor Cyan
Write-Host "=" * 60 -ForegroundColor Cyan

# Step 1: Check API Key
Write-Host "`n1. Checking COINCAP_API_KEY..." -ForegroundColor Yellow
$secrets = npx wrangler secret list 2>&1 | Out-String
if ($secrets -match "COINCAP_API_KEY") {
    Write-Host "   ✅ COINCAP_API_KEY is set" -ForegroundColor Green
} else {
    Write-Host "   ❌ COINCAP_API_KEY is NOT set!" -ForegroundColor Red
    Write-Host "   Action: Run 'npx wrangler secret put COINCAP_API_KEY'" -ForegroundColor Yellow
    $missingKey = $true
}

# Step 2: Test CoinCap API directly (may fail due to network)
Write-Host "`n2. Testing CoinCap API directly..." -ForegroundColor Yellow
try {
    $coinCapTest = Invoke-WebRequest -Uri "https://api.coincap.io/v2/assets?ids=bitcoin" -TimeoutSec 10 -ErrorAction Stop
    Write-Host "   ✅ CoinCap API is accessible from your network" -ForegroundColor Green
    Write-Host "   Status: $($coinCapTest.StatusCode)" -ForegroundColor Cyan
    $coinCapWorking = $true
} catch {
    Write-Host "   ⚠️  Cannot reach CoinCap API from your network" -ForegroundColor Yellow
    Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Gray
    Write-Host "   Note: This might be a local network issue, not a CoinCap issue" -ForegroundColor Gray
    $coinCapWorking = $false
}

# Step 3: Test Worker endpoint
Write-Host "`n3. Testing Worker endpoint..." -ForegroundColor Yellow
$ts = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
$workerUrl = "https://crypto-mood-dashboard-production.smah0085.workers.dev/price?coin=bitcoin&_=$ts"
$start = Get-Date
try {
    $workerResponse = Invoke-RestMethod -Uri $workerUrl -TimeoutSec 30 -ErrorAction Stop
    $elapsed = ((Get-Date) - $start).TotalSeconds
    Write-Host "   ✅ Worker responded successfully" -ForegroundColor Green
    Write-Host "   Time: $([math]::Round($elapsed, 2))s" -ForegroundColor Cyan
    Write-Host "   Price: `$$($workerResponse.price)" -ForegroundColor Green
    Write-Host "   Source: $($workerResponse.source)" -ForegroundColor $(if ($workerResponse.source -eq 'coincap') {'Green'} else {'Red'})
    $workerWorking = $true
} catch {
    $elapsed = ((Get-Date) - $start).TotalSeconds
    $statusCode = if ($_.Exception.Response) { $_.Exception.Response.StatusCode.value__ } else { "N/A" }
    Write-Host "   ❌ Worker returned error" -ForegroundColor Red
    Write-Host "   Status: $statusCode" -ForegroundColor Yellow
    Write-Host "   Time: $([math]::Round($elapsed, 2))s" -ForegroundColor Yellow
    Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Red
    
    # Try to parse error response
    if ($_.Exception.Response) {
        try {
            $stream = $_.Exception.Response.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($stream)
            $responseBody = $reader.ReadToEnd()
            $errorJson = $responseBody | ConvertFrom-Json
            
            Write-Host "   Error Details:" -ForegroundColor Yellow
            Write-Host "     - Error: $($errorJson.error)" -ForegroundColor Gray
            Write-Host "     - Code: $($errorJson.code)" -ForegroundColor Gray
            Write-Host "     - Details: $($errorJson.details)" -ForegroundColor Gray
            
            if ($errorJson.diagnostic) {
                Write-Host "     - Diagnostic Type: $($errorJson.diagnostic.type)" -ForegroundColor Gray
                Write-Host "     - Diagnostic Message: $($errorJson.diagnostic.message)" -ForegroundColor Gray
                Write-Host "     - Diagnostic Status: $($errorJson.diagnostic.status)" -ForegroundColor Gray
            }
            
            if ($errorJson.diagnostic.status -eq 530) {
                Write-Host "`n   🔍 HTTP 530 Detected!" -ForegroundColor Red
                Write-Host "   This means CoinCap API is returning Cloudflare error 530." -ForegroundColor Yellow
                Write-Host "   Possible causes:" -ForegroundColor Yellow
                Write-Host "     1. CoinCap API is temporarily down" -ForegroundColor Gray
                Write-Host "     2. Network connectivity issues between Cloudflare and CoinCap" -ForegroundColor Gray
                Write-Host "     3. CoinCap API is rate-limiting/throttling" -ForegroundColor Gray
                Write-Host "     4. DNS resolution issues" -ForegroundColor Gray
            }
        } catch {
            Write-Host "   Could not parse error response" -ForegroundColor Gray
        }
    }
    $workerWorking = $false
}

# Step 4: Check Worker Logs
Write-Host "`n4. Worker Logs Check..." -ForegroundColor Yellow
Write-Host "   To check worker logs, run:" -ForegroundColor Gray
Write-Host "   npx wrangler tail --format=pretty" -ForegroundColor Cyan
Write-Host "`n   Look for:" -ForegroundColor Gray
Write-Host "     - 🔑 Environment check: COINCAP_API_KEY: SET/NOT SET" -ForegroundColor Gray
Write-Host "     - [rateLimitedFetch] ⚠️ Cloudflare error (530)" -ForegroundColor Gray
Write-Host "     - [coinCapAuthHeaders] COINCAP_API_KEY not set (if missing)" -ForegroundColor Gray
Write-Host "     - ✅ Success on attempt X (if working)" -ForegroundColor Gray

# Step 5: Recommendations
Write-Host "`n5. Recommendations" -ForegroundColor Yellow
Write-Host "=" * 60 -ForegroundColor Cyan

if ($missingKey) {
    Write-Host "`n❌ CRITICAL: COINCAP_API_KEY is not set!" -ForegroundColor Red
    Write-Host "   Action: Set it with 'npx wrangler secret put COINCAP_API_KEY'" -ForegroundColor Yellow
    Write-Host "   Get your API key from: https://pro.coincap.io/" -ForegroundColor Cyan
}

if (-not $workerWorking) {
    Write-Host "`n⚠️  Worker is not working correctly" -ForegroundColor Yellow
    Write-Host "   Next steps:" -ForegroundColor Yellow
    Write-Host "   1. Check worker logs: npx wrangler tail" -ForegroundColor Gray
    Write-Host "   2. Verify API key is set correctly" -ForegroundColor Gray
    Write-Host "   3. Wait 5-10 minutes and retry (530 errors are often temporary)" -ForegroundColor Gray
    Write-Host "   4. Check CoinCap API status" -ForegroundColor Gray
    Write-Host "   5. Contact CoinCap support if issue persists" -ForegroundColor Gray
} else {
    Write-Host "`n✅ Worker is working correctly!" -ForegroundColor Green
    Write-Host "   If frontend still shows errors:" -ForegroundColor Yellow
    Write-Host "   1. Clear browser cache" -ForegroundColor Gray
    Write-Host "   2. Rebuild frontend: npm run build" -ForegroundColor Gray
    Write-Host "   3. Redeploy frontend to GitHub Pages" -ForegroundColor Gray
}

Write-Host "`n" + ("=" * 60) -ForegroundColor Cyan
Write-Host "Diagnostic complete!" -ForegroundColor Green

