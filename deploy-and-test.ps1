# CoinCap Migration - Deploy and Test Script
# This script deploys the updated worker and runs verification tests

Write-Host "`n🚀 CoinCap Migration Deployment & Verification`n" -ForegroundColor Cyan

# Step 1: Check if admin token is set
Write-Host "Step 1: Checking ADMIN_PURGE_TOKEN..." -ForegroundColor Yellow
$secrets = npx wrangler secret list 2>&1 | Out-String
if ($secrets -match "ADMIN_PURGE_TOKEN") {
    Write-Host "✅ ADMIN_PURGE_TOKEN is set" -ForegroundColor Green
} else {
    Write-Host "⚠️  ADMIN_PURGE_TOKEN not found. Generating one..." -ForegroundColor Yellow
    $adminToken = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | ForEach-Object {[char]$_})
    Write-Host "Generated token: $adminToken" -ForegroundColor Cyan
    Write-Host "IMPORTANT: Save this token securely!" -ForegroundColor Red
    Write-Host "`nSetting secret (press Ctrl+V to paste the token)..." -ForegroundColor Yellow
    $adminToken | clip
    npx wrangler secret put ADMIN_PURGE_TOKEN
}

# Step 2: Deploy worker
Write-Host "`nStep 2: Deploying worker..." -ForegroundColor Yellow
npx wrangler deploy
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Deployment successful!" -ForegroundColor Green
} else {
    Write-Host "❌ Deployment failed!" -ForegroundColor Red
    exit 1
}

# Step 3: Test CoinCap API directly
Write-Host "`nStep 3: Testing CoinCap API connectivity..." -ForegroundColor Yellow
try {
    $directTest = Invoke-RestMethod -Uri "https://api.coincap.io/v2/assets?ids=bitcoin" -ErrorAction Stop
    Write-Host "✅ CoinCap API is reachable" -ForegroundColor Green
    Write-Host "   Bitcoin price: `$$($directTest.data[0].priceUsd)" -ForegroundColor Cyan
} catch {
    Write-Host "❌ Cannot reach CoinCap API directly" -ForegroundColor Red
    Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Red
}

# Step 4: Purge legacy cache (if token available)
Write-Host "`nStep 4: Purging legacy CoinGecko cache..." -ForegroundColor Yellow
if ($adminToken) {
    $token = $adminToken
} else {
    $token = Read-Host "Enter your ADMIN_PURGE_TOKEN"
}

try {
    $purgeBody = @{ token = $token } | ConvertTo-Json
    $purgeResult = Invoke-RestMethod -Uri "https://crypto-mood-dashboard-production.smah0085.workers.dev/admin/purge-legacy-cache" `
        -Method POST `
        -ContentType "application/json" `
        -Body $purgeBody `
        -ErrorAction Stop
    
    Write-Host "✅ Cache purge completed" -ForegroundColor Green
    Write-Host "   Deleted keys: $($purgeResult.deleted)" -ForegroundColor Cyan
    if ($purgeResult.deleted -gt 0) {
        Write-Host "   Sample keys:" -ForegroundColor Cyan
        $purgeResult.keys | Select-Object -First 5 | ForEach-Object {
            Write-Host "     - $_" -ForegroundColor Gray
        }
    } else {
        Write-Host "   No legacy cache found (already clean)" -ForegroundColor Green
    }
} catch {
    Write-Host "⚠️  Could not purge cache" -ForegroundColor Yellow
    Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "   This is OK if cache is already clean" -ForegroundColor Gray
}

# Step 5: Test price endpoints
Write-Host "`nStep 5: Testing price endpoints..." -ForegroundColor Yellow
$testCoins = @('bitcoin', 'ethereum', 'litecoin', 'cardano', 'dogecoin')
$allCorrect = $true

foreach ($coin in $testCoins) {
    try {
        $ts = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
        $result = Invoke-RestMethod -Uri "https://crypto-mood-dashboard-production.smah0085.workers.dev/price?coin=$coin&_=$ts" -ErrorAction Stop
        
        $sourceColor = if ($result.source -eq 'coincap') { 'Green' } else { 'Red' }
        $sourceIcon = if ($result.source -eq 'coincap') { '✅' } else { '❌' }
        
        Write-Host "  $sourceIcon $coin : `$$($result.price) [source: $($result.source)]" -ForegroundColor $sourceColor
        
        if ($result.source -ne 'coincap') {
            $allCorrect = $false
            Write-Host "     ⚠️  Expected source='coincap', got '$($result.source)'" -ForegroundColor Red
        }
    } catch {
        Write-Host "  ❌ $coin : FAILED - $($_.Exception.Message)" -ForegroundColor Red
        $allCorrect = $false
    }
    Start-Sleep -Milliseconds 200
}

# Step 6: Test history endpoint
Write-Host "`nStep 6: Testing history endpoint..." -ForegroundColor Yellow
try {
    $ts = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
    $history = Invoke-RestMethod -Uri "https://crypto-mood-dashboard-production.smah0085.workers.dev/history?coin=bitcoin&days=7&_=$ts" -ErrorAction Stop
    
    $sourceColor = if ($history.source -eq 'coincap') { 'Green' } else { 'Red' }
    $sourceIcon = if ($history.source -eq 'coincap') { '✅' } else { '❌' }
    
    Write-Host "  $sourceIcon Bitcoin 7-day history: $($history.prices.Count) points [source: $($history.source)]" -ForegroundColor $sourceColor
    
    if ($history.source -ne 'coincap') {
        $allCorrect = $false
        Write-Host "     ⚠️  Expected source='coincap', got '$($history.source)'" -ForegroundColor Red
    }
} catch {
    Write-Host "  ❌ History test FAILED - $($_.Exception.Message)" -ForegroundColor Red
    $allCorrect = $false
}

# Final summary
Write-Host "`n" + ("=" * 60) -ForegroundColor Cyan
if ($allCorrect) {
    Write-Host "✅ ALL TESTS PASSED!" -ForegroundColor Green
    Write-Host "`nThe worker is successfully using CoinCap API!" -ForegroundColor Green
    Write-Host "All responses show source='coincap'" -ForegroundColor Green
} else {
    Write-Host "⚠️  SOME TESTS FAILED" -ForegroundColor Yellow
    Write-Host "`nTroubleshooting steps:" -ForegroundColor Yellow
    Write-Host "1. Check worker logs: npx wrangler tail --format=pretty" -ForegroundColor Gray
    Write-Host "2. Verify COINCAP_API_KEY is set: npx wrangler secret list" -ForegroundColor Gray
    Write-Host "3. Run purge again if still seeing 'coingecko'" -ForegroundColor Gray
    Write-Host "4. Check if CoinCap API is accessible from Cloudflare network" -ForegroundColor Gray
}
Write-Host ("=" * 60) -ForegroundColor Cyan

Write-Host "`n📊 Next Steps:" -ForegroundColor Cyan
Write-Host "1. Run 'npx wrangler tail' in a separate terminal to monitor logs" -ForegroundColor Gray
Write-Host "2. Check logs for: '[rateLimitedFetch] Attempt 1/5 for https://api.coincap.io...'" -ForegroundColor Gray
Write-Host "3. Look for: '✅ [fetchAssetsBatch] Got X assets from CoinCap'" -ForegroundColor Gray
Write-Host "4. If you see errors, paste the log output for analysis`n" -ForegroundColor Gray

