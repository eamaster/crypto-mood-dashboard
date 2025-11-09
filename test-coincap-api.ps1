# Test CoinCap API connectivity
Write-Host "Testing CoinCap API connectivity..." -ForegroundColor Cyan

# Test 1: Direct CoinCap API call
Write-Host "`n1. Testing CoinCap API directly..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "https://api.coincap.io/v2/assets?ids=bitcoin" -TimeoutSec 10 -ErrorAction Stop
    Write-Host "✅ CoinCap API is accessible" -ForegroundColor Green
    Write-Host "   Status: $($response.StatusCode)" -ForegroundColor Cyan
    Write-Host "   Response Length: $($response.Content.Length) bytes" -ForegroundColor Cyan
    
    $json = $response.Content | ConvertFrom-Json
    if ($json.data) {
        Write-Host "   Bitcoin Price: `$$($json.data[0].priceUsd)" -ForegroundColor Green
    }
} catch {
    Write-Host "❌ CoinCap API Error" -ForegroundColor Red
    Write-Host "   Message: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        Write-Host "   Status: $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Yellow
        Write-Host "   Status Description: $($_.Exception.Response.StatusDescription)" -ForegroundColor Yellow
    }
}

# Test 2: Worker endpoint
Write-Host "`n2. Testing Worker endpoint..." -ForegroundColor Yellow
$ts = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
$workerUrl = "https://crypto-mood-dashboard-production.smah0085.workers.dev/price?coin=bitcoin&_=$ts"
try {
    $start = Get-Date
    $response = Invoke-WebRequest -Uri $workerUrl -TimeoutSec 30 -ErrorAction Stop
    $elapsed = ((Get-Date) - $start).TotalSeconds
    Write-Host "✅ Worker responded successfully" -ForegroundColor Green
    Write-Host "   Status: $($response.StatusCode)" -ForegroundColor Cyan
    Write-Host "   Time: $([math]::Round($elapsed, 2))s" -ForegroundColor Cyan
    
    $json = $response.Content | ConvertFrom-Json
    Write-Host "   Price: `$$($json.price)" -ForegroundColor Green
    Write-Host "   Source: $($json.source)" -ForegroundColor $(if ($json.source -eq 'coincap') {'Green'} else {'Red'})
} catch {
    Write-Host "❌ Worker Error" -ForegroundColor Red
    Write-Host "   Message: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $statusCode = $_.Exception.Response.StatusCode.value__
        Write-Host "   Status: $statusCode" -ForegroundColor Yellow
        
        try {
            $stream = $_.Exception.Response.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($stream)
            $responseBody = $reader.ReadToEnd()
            $errorJson = $responseBody | ConvertFrom-Json
            Write-Host "   Error: $($errorJson.error)" -ForegroundColor Yellow
            Write-Host "   Code: $($errorJson.code)" -ForegroundColor Yellow
            Write-Host "   Details: $($errorJson.details)" -ForegroundColor Yellow
            if ($errorJson.diagnostic) {
                Write-Host "   Diagnostic Type: $($errorJson.diagnostic.type)" -ForegroundColor Yellow
                Write-Host "   Diagnostic Message: $($errorJson.diagnostic.message)" -ForegroundColor Yellow
            }
        } catch {
            Write-Host "   Could not parse error response" -ForegroundColor Gray
        }
    }
}

Write-Host "`n3. Checking Worker Logs..." -ForegroundColor Yellow
Write-Host "   Run: npx wrangler tail --format=pretty" -ForegroundColor Gray
Write-Host "   Look for: [rateLimitedFetch] errors, 530 status codes, CoinCap API calls" -ForegroundColor Gray

