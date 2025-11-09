# Test CoinCap API v3 with your API key
$apiKey = "e3a3be2e1d8a7df455f80fd5449c735d288e894c5f76ad02d50aff93dbc82228"

Write-Host "Testing CoinCap API v3..." -ForegroundColor Cyan

# Test 1: v3 assets endpoint
Write-Host "`n1. Testing v3 /assets endpoint..." -ForegroundColor Yellow
try {
    $headers = @{
        "Authorization" = "Bearer $apiKey"
        "Accept" = "application/json"
    }
    
    $response = Invoke-WebRequest -Uri "https://rest.coincap.io/v3/assets?ids=bitcoin" -Headers $headers -TimeoutSec 10 -ErrorAction Stop
    Write-Host "✅ SUCCESS!" -ForegroundColor Green
    Write-Host "Status: $($response.StatusCode)" -ForegroundColor Cyan
    
    $json = $response.Content | ConvertFrom-Json
    Write-Host "Response structure:" -ForegroundColor Cyan
    Write-Host ($json | ConvertTo-Json -Depth 3) -ForegroundColor Gray
    
    if ($json.data -and $json.data.Count -gt 0) {
        Write-Host "`nBitcoin Data:" -ForegroundColor Green
        Write-Host "Price: `$$($json.data[0].priceUsd)" -ForegroundColor Green
        Write-Host "Symbol: $($json.data[0].symbol)" -ForegroundColor Cyan
        Write-Host "Change 24h: $($json.data[0].changePercent24Hr)%" -ForegroundColor Cyan
    }
} catch {
    Write-Host "❌ FAILED" -ForegroundColor Red
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        Write-Host "Status: $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Yellow
    }
}

# Test 2: v3 single asset endpoint
Write-Host "`n2. Testing v3 /assets/bitcoin endpoint..." -ForegroundColor Yellow
try {
    $headers = @{
        "Authorization" = "Bearer $apiKey"
        "Accept" = "application/json"
    }
    
    $response = Invoke-WebRequest -Uri "https://rest.coincap.io/v3/assets/bitcoin" -Headers $headers -TimeoutSec 10 -ErrorAction Stop
    Write-Host "✅ SUCCESS!" -ForegroundColor Green
    Write-Host "Status: $($response.StatusCode)" -ForegroundColor Cyan
    
    $json = $response.Content | ConvertFrom-Json
    if ($json.data) {
        Write-Host "Bitcoin Price: `$$($json.data.priceUsd)" -ForegroundColor Green
    }
} catch {
    Write-Host "❌ FAILED" -ForegroundColor Red
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 3: v3 history endpoint
Write-Host "`n3. Testing v3 /assets/bitcoin/history endpoint..." -ForegroundColor Yellow
try {
    $headers = @{
        "Authorization" = "Bearer $apiKey"
        "Accept" = "application/json"
    }
    
    $end = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
    $start = $end - (7 * 24 * 60 * 60 * 1000)
    $url = "https://rest.coincap.io/v3/assets/bitcoin/history?interval=d1&start=$start&end=$end"
    
    $response = Invoke-WebRequest -Uri $url -Headers $headers -TimeoutSec 10 -ErrorAction Stop
    Write-Host "✅ SUCCESS!" -ForegroundColor Green
    Write-Host "Status: $($response.StatusCode)" -ForegroundColor Cyan
    
    $json = $response.Content | ConvertFrom-Json
    if ($json.data) {
        Write-Host "History points: $($json.data.Count)" -ForegroundColor Green
    }
} catch {
    Write-Host "❌ FAILED" -ForegroundColor Red
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
}

