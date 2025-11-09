# Test all endpoints
Write-Host "Testing all endpoints..." -ForegroundColor Cyan

# Test Price
Write-Host "`n1. Testing Price Endpoint..." -ForegroundColor Yellow
$ts = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
try {
    $result = Invoke-RestMethod -Uri "https://crypto-mood-dashboard-production.smah0085.workers.dev/price?coin=bitcoin&_=$ts" -TimeoutSec 15
    Write-Host "✅ Price: `$$($result.price), Source: $($result.source), Symbol: $($result.symbol)" -ForegroundColor Green
} catch {
    Write-Host "❌ Failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test History
Write-Host "`n2. Testing History Endpoint..." -ForegroundColor Yellow
$ts = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
try {
    $result = Invoke-RestMethod -Uri "https://crypto-mood-dashboard-production.smah0085.workers.dev/history?coin=bitcoin&days=7&_=$ts" -TimeoutSec 15
    Write-Host "✅ History: $($result.prices.Count) points, Source: $($result.source)" -ForegroundColor Green
} catch {
    Write-Host "❌ Failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test multiple coins
Write-Host "`n3. Testing Multiple Coins..." -ForegroundColor Yellow
$coins = @('ethereum', 'litecoin', 'cardano', 'dogecoin')
foreach ($coin in $coins) {
    $ts = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
    try {
        $result = Invoke-RestMethod -Uri "https://crypto-mood-dashboard-production.smah0085.workers.dev/price?coin=$coin&_=$ts" -TimeoutSec 15
        Write-Host "✅ $coin : `$$($result.price) [$($result.source)]" -ForegroundColor Green
    } catch {
        Write-Host "❌ $coin : Failed" -ForegroundColor Red
    }
    Start-Sleep -Milliseconds 200
}

Write-Host "`n✅ All tests completed!" -ForegroundColor Green
Write-Host "Check your CoinCap dashboard - credits should now be used!" -ForegroundColor Cyan

