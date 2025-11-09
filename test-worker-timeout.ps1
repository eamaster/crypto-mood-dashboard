# Test worker response time
Write-Host "Testing worker response time..." -ForegroundColor Cyan

$ts = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
$url = "https://crypto-mood-dashboard-production.smah0085.workers.dev/price?coin=bitcoin&_=$ts"

Write-Host "`nTesting Price Endpoint..." -ForegroundColor Yellow
$start = Get-Date
try {
    $response = Invoke-RestMethod -Uri $url -TimeoutSec 30 -ErrorAction Stop
    $elapsed = ((Get-Date) - $start).TotalSeconds
    Write-Host "✅ SUCCESS in $([math]::Round($elapsed, 2)) seconds" -ForegroundColor Green
    Write-Host "   Price: `$$($response.price)" -ForegroundColor Cyan
    Write-Host "   Source: $($response.source)" -ForegroundColor $(if ($response.source -eq 'coincap') {'Green'} else {'Red'})
    Write-Host "   Symbol: $($response.symbol)" -ForegroundColor Cyan
} catch {
    $elapsed = ((Get-Date) - $start).TotalSeconds
    Write-Host "❌ FAILED after $([math]::Round($elapsed, 2)) seconds" -ForegroundColor Red
    Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        Write-Host "   Status: $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Yellow
    }
}

Write-Host "`nTesting History Endpoint..." -ForegroundColor Yellow
$ts2 = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
$url2 = "https://crypto-mood-dashboard-production.smah0085.workers.dev/history?coin=bitcoin&days=7&_=$ts2"
$start2 = Get-Date
try {
    $response2 = Invoke-RestMethod -Uri $url2 -TimeoutSec 30 -ErrorAction Stop
    $elapsed2 = ((Get-Date) - $start2).TotalSeconds
    Write-Host "✅ SUCCESS in $([math]::Round($elapsed2, 2)) seconds" -ForegroundColor Green
    Write-Host "   Points: $($response2.prices.Count)" -ForegroundColor Cyan
    Write-Host "   Source: $($response2.source)" -ForegroundColor $(if ($response2.source -eq 'coincap') {'Green'} else {'Red'})
} catch {
    $elapsed2 = ((Get-Date) - $start2).TotalSeconds
    Write-Host "❌ FAILED after $([math]::Round($elapsed2, 2)) seconds" -ForegroundColor Red
    Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        Write-Host "   Status: $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Yellow
    }
}

Write-Host "`nFrontend timeout settings:" -ForegroundColor Yellow
Write-Host "   Price timeout: 8000ms (8 seconds)" -ForegroundColor Gray
Write-Host "   History timeout: 10000ms (10 seconds)" -ForegroundColor Gray
Write-Host "`nIf worker takes longer than these, frontend will timeout." -ForegroundColor Yellow

