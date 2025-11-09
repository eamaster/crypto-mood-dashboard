# Script to check worker logs and test the endpoint
Write-Host "Testing worker and checking logs..." -ForegroundColor Cyan

Write-Host "`n1. Making a test request to trigger logs..." -ForegroundColor Yellow
$ts = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
try {
    $response = Invoke-WebRequest -Uri "https://crypto-mood-dashboard-production.smah0085.workers.dev/price?coin=bitcoin&_=$ts" -TimeoutSec 15 -ErrorAction Stop
    Write-Host "✅ Worker responded" -ForegroundColor Green
    Write-Host "Status: $($response.StatusCode)" -ForegroundColor Cyan
    $json = $response.Content | ConvertFrom-Json
    Write-Host "Price: `$$($json.price)" -ForegroundColor Green
    Write-Host "Source: $($json.source)" -ForegroundColor $(if ($json.source -eq 'coincap') {'Green'} else {'Red'})
} catch {
    Write-Host "❌ Worker error" -ForegroundColor Red
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $status = $_.Exception.Response.StatusCode.value__
        Write-Host "Status: $status" -ForegroundColor Yellow
        try {
            $stream = $_.Exception.Response.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($stream)
            $body = $reader.ReadToEnd()
            Write-Host "Response: $body" -ForegroundColor Gray
        } catch {}
    }
}

Write-Host "`n2. To check worker logs, run:" -ForegroundColor Yellow
Write-Host "   npx wrangler tail --format=pretty" -ForegroundColor Cyan
Write-Host "`nLook for:" -ForegroundColor Yellow
Write-Host "   - [fetchAssetsBatch] 🔍 Calling CoinCap API" -ForegroundColor Gray
Write-Host "   - [fetchAssetsBatch] Headers: ..." -ForegroundColor Gray
Write-Host "   - [rateLimitedFetch] Attempt 1/2" -ForegroundColor Gray
Write-Host "   - ✅ Success or ❌ Error messages" -ForegroundColor Gray

