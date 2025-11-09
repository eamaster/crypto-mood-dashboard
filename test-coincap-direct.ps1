# Test CoinCap API directly
Write-Host "Testing CoinCap API..." -ForegroundColor Cyan

# Test 1: Without authentication (free tier)
Write-Host "`n1. Testing WITHOUT authentication..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "https://api.coincap.io/v2/assets?ids=bitcoin" -TimeoutSec 10 -ErrorAction Stop
    Write-Host "✅ SUCCESS without auth" -ForegroundColor Green
    Write-Host "Status: $($response.StatusCode)" -ForegroundColor Cyan
    $json = $response.Content | ConvertFrom-Json
    Write-Host "Bitcoin Price: `$$($json.data[0].priceUsd)" -ForegroundColor Green
} catch {
    Write-Host "❌ FAILED without auth" -ForegroundColor Red
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        Write-Host "Status: $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Yellow
    }
}

# Test 2: Check if API key is needed
Write-Host "`n2. Testing with Bearer token format..." -ForegroundColor Yellow
Write-Host "Note: Free tier may not require authentication" -ForegroundColor Gray
Write-Host "If test 1 works, the worker should work without API key" -ForegroundColor Gray

# Test 3: Check worker endpoint
Write-Host "`n3. Testing worker endpoint..." -ForegroundColor Yellow
$ts = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
try {
    $workerResponse = Invoke-WebRequest -Uri "https://crypto-mood-dashboard-production.smah0085.workers.dev/price?coin=bitcoin&_=$ts" -TimeoutSec 15 -ErrorAction Stop
    Write-Host "✅ Worker responded" -ForegroundColor Green
    Write-Host "Status: $($workerResponse.StatusCode)" -ForegroundColor Cyan
    $workerJson = $workerResponse.Content | ConvertFrom-Json
    Write-Host "Price: `$$($workerJson.price)" -ForegroundColor Green
    Write-Host "Source: $($workerJson.source)" -ForegroundColor $(if ($workerJson.source -eq 'coincap') {'Green'} else {'Red'})
} catch {
    Write-Host "❌ Worker failed" -ForegroundColor Red
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

