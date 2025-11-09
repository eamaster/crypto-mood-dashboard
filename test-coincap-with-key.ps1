# Test CoinCap API with the actual API key
$apiKey = "e3a3be2e1d8a7df455f80fd5449c735d288e894c5f76ad02d50aff93dbc82228"

Write-Host "Testing CoinCap API with API key..." -ForegroundColor Cyan
Write-Host "API Key: $($apiKey.Substring(0, 20))..." -ForegroundColor Gray

# Test 1: Assets endpoint with auth
Write-Host "`n1. Testing /v2/assets?ids=bitcoin with Bearer token..." -ForegroundColor Yellow
try {
    $headers = @{
        "Authorization" = "Bearer $apiKey"
        "Accept" = "application/json"
    }
    
    $response = Invoke-WebRequest -Uri "https://api.coincap.io/v2/assets?ids=bitcoin" -Headers $headers -TimeoutSec 10 -ErrorAction Stop
    Write-Host "✅ SUCCESS!" -ForegroundColor Green
    Write-Host "Status: $($response.StatusCode)" -ForegroundColor Cyan
    Write-Host "Content Length: $($response.Content.Length) bytes" -ForegroundColor Cyan
    
    $json = $response.Content | ConvertFrom-Json
    if ($json.data -and $json.data.Count -gt 0) {
        Write-Host "Bitcoin Price: `$$($json.data[0].priceUsd)" -ForegroundColor Green
        Write-Host "Symbol: $($json.data[0].symbol)" -ForegroundColor Cyan
        Write-Host "Change 24h: $($json.data[0].changePercent24Hr)%" -ForegroundColor Cyan
    }
} catch {
    Write-Host "❌ FAILED" -ForegroundColor Red
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $statusCode = $_.Exception.Response.StatusCode.value__
        Write-Host "Status Code: $statusCode" -ForegroundColor Yellow
        try {
            $stream = $_.Exception.Response.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($stream)
            $body = $reader.ReadToEnd()
            Write-Host "Response Body: $body" -ForegroundColor Gray
        } catch {
            Write-Host "Could not read response body" -ForegroundColor Gray
        }
    }
}

# Test 2: Assets endpoint without auth (free tier might work)
Write-Host "`n2. Testing /v2/assets?ids=bitcoin WITHOUT auth (free tier)..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "https://api.coincap.io/v2/assets?ids=bitcoin" -TimeoutSec 10 -ErrorAction Stop
    Write-Host "✅ SUCCESS without auth!" -ForegroundColor Green
    Write-Host "Status: $($response.StatusCode)" -ForegroundColor Cyan
    $json = $response.Content | ConvertFrom-Json
    Write-Host "Bitcoin Price: `$$($json.data[0].priceUsd)" -ForegroundColor Green
} catch {
    Write-Host "❌ FAILED without auth" -ForegroundColor Red
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 3: Check if endpoint structure is correct
Write-Host "`n3. Testing different endpoint formats..." -ForegroundColor Yellow
$testUrls = @(
    "https://api.coincap.io/v2/assets?ids=bitcoin",
    "https://api.coincap.io/v2/assets/bitcoin",
    "https://api.coincap.io/v2/asset/bitcoin"
)

foreach ($url in $testUrls) {
    Write-Host "`n  Testing: $url" -ForegroundColor Gray
    try {
        $headers = @{
            "Authorization" = "Bearer $apiKey"
            "Accept" = "application/json"
        }
        $response = Invoke-WebRequest -Uri $url -Headers $headers -TimeoutSec 5 -ErrorAction Stop
        Write-Host "  ✅ Works: $($response.StatusCode)" -ForegroundColor Green
    } catch {
        Write-Host "  ❌ Failed: $($_.Exception.Message)" -ForegroundColor Red
    }
}

