# UI Price Consistency Test Script
# Tests that /price, /ohlc.lastClosePrice, and UI all show the same canonical price
# Usage: .\test-ui-price-consistency.ps1 [WORKER_URL]

param(
    [string]$WORKER_URL = "https://crypto-mood-dashboard-production.smah0085.workers.dev"
)

$COIN = "bitcoin"
$TIMESTAMP = [int64](([datetime]::UtcNow)-(get-date "1/1/1970")).TotalMilliseconds

Write-Host "=========================================="
Write-Host "UI Price Consistency Tests"
Write-Host "=========================================="
Write-Host "Worker URL: $WORKER_URL"
Write-Host "Coin: $COIN"
Write-Host ""

$allTestsPassed = $true

# Test 1: Price endpoint
Write-Host "--- Test 1: Price Endpoint ---"
try {
    $priceResponse = Invoke-WebRequest -Uri "${WORKER_URL}/price?coin=${COIN}&_=${TIMESTAMP}" -Method GET -UseBasicParsing
    $priceStatus = $priceResponse.StatusCode
    $priceBody = $priceResponse.Content | ConvertFrom-Json
    $priceValue = [double]$priceBody.price
    $priceFormatted = [math]::Round($priceValue, 2)
    $priceSource = $priceBody.source
    
    Write-Host "Status: $priceStatus"
    Write-Host "Price: $priceValue"
    Write-Host "Price (formatted): $priceFormatted"
    Write-Host "Source: $priceSource"
    Write-Host ""
    
    if ($priceStatus -ne 200) {
        Write-Host "❌ FAIL: Price endpoint returned status $priceStatus" -ForegroundColor Red
        $allTestsPassed = $false
    } else {
        Write-Host "✅ PASS: Price endpoint" -ForegroundColor Green
    }
} catch {
    Write-Host "❌ FAIL: Price endpoint error: $_" -ForegroundColor Red
    $allTestsPassed = $false
}

# Test 2: OHLC endpoint - verify lastClosePrice matches price
Write-Host "--- Test 2: OHLC Endpoint (lastClosePrice consistency) ---"
try {
    $ohlcResponse = Invoke-WebRequest -Uri "${WORKER_URL}/ohlc?coin=${COIN}&days=7&_=${TIMESTAMP}" -Method GET -UseBasicParsing
    $ohlcStatus = $ohlcResponse.StatusCode
    $ohlcBody = $ohlcResponse.Content | ConvertFrom-Json
    $ohlcLastClose = [double]$ohlcBody.lastClosePrice
    $ohlcFormatted = [math]::Round($ohlcLastClose, 2)
    $ohlcPriceSource = $ohlcBody.priceSource
    
    Write-Host "Status: $ohlcStatus"
    Write-Host "lastClosePrice: $ohlcLastClose"
    Write-Host "lastClosePrice (formatted): $ohlcFormatted"
    Write-Host "priceSource: $ohlcPriceSource"
    Write-Host ""
    
    if ($ohlcStatus -ne 200) {
        Write-Host "❌ FAIL: OHLC endpoint returned status $ohlcStatus" -ForegroundColor Red
        $allTestsPassed = $false
    } elseif ($priceFormatted -ne $ohlcFormatted) {
        $diff = [math]::Abs($priceFormatted - $ohlcFormatted)
        Write-Host "❌ FAIL: Price mismatch detected!" -ForegroundColor Red
        Write-Host "   Price endpoint: $priceFormatted" -ForegroundColor Red
        Write-Host "   OHLC lastClosePrice: $ohlcFormatted" -ForegroundColor Red
        Write-Host "   Difference: $diff" -ForegroundColor Red
        $allTestsPassed = $false
    } else {
        Write-Host "✅ PASS: OHLC lastClosePrice matches price endpoint" -ForegroundColor Green
    }
} catch {
    Write-Host "❌ FAIL: OHLC endpoint error: $_" -ForegroundColor Red
    $allTestsPassed = $false
}

# Test 3: AI Explain endpoint - verify technicalContext.currentPrice matches
Write-Host "--- Test 3: AI Explain Endpoint (technicalContext.currentPrice consistency) ---"
try {
    $aiStart = Get-Date
    $aiBody = @{
        coin = $COIN
        timeframe = 7
        force = $true
    } | ConvertTo-Json
    
    $aiResponse = Invoke-WebRequest -Uri "${WORKER_URL}/ai-explain" -Method POST -Body $aiBody -ContentType "application/json" -UseBasicParsing
    $aiEnd = Get-Date
    $aiDuration = ($aiEnd - $aiStart).TotalSeconds
    
    $aiStatus = $aiResponse.StatusCode
    $aiResponseBody = $aiResponse.Content | ConvertFrom-Json
    $aiTechnicalPrice = $aiResponseBody.technicalContext.currentPrice
    $aiTechnicalFormatted = [math]::Round($aiTechnicalPrice, 2)
    
    Write-Host "Status: $aiStatus"
    Write-Host "Duration: $([math]::Round($aiDuration, 2))s"
    Write-Host "technicalContext.currentPrice: $aiTechnicalPrice"
    Write-Host "technicalContext.currentPrice (formatted): $aiTechnicalFormatted"
    Write-Host ""
    
    if ($aiStatus -ne 200) {
        Write-Host "❌ FAIL: AI Explain endpoint returned status $aiStatus" -ForegroundColor Red
        $allTestsPassed = $false
    } elseif ($priceFormatted -ne $aiTechnicalFormatted) {
        $diff = [math]::Abs($priceFormatted - $aiTechnicalFormatted)
        Write-Host "❌ FAIL: AI price mismatch detected!" -ForegroundColor Red
        Write-Host "   Price endpoint: $priceFormatted" -ForegroundColor Red
        Write-Host "   AI technicalContext.currentPrice: $aiTechnicalFormatted" -ForegroundColor Red
        Write-Host "   Difference: $diff" -ForegroundColor Red
        $allTestsPassed = $false
    } else {
        Write-Host "✅ PASS: AI technicalContext.currentPrice matches price endpoint" -ForegroundColor Green
    }
} catch {
    Write-Host "❌ FAIL: AI Explain endpoint error: $_" -ForegroundColor Red
    $allTestsPassed = $false
}

# Summary
Write-Host ""
Write-Host "=========================================="
if ($allTestsPassed) {
    Write-Host "All Tests Passed! ✅" -ForegroundColor Green
    Write-Host "=========================================="
    Write-Host ""
    Write-Host "Price Consistency Summary:"
    Write-Host "  - Price endpoint: $priceFormatted ($priceSource)"
    Write-Host "  - OHLC lastClosePrice: $ohlcFormatted ($ohlcPriceSource)"
    Write-Host "  - AI technicalContext.currentPrice: $aiTechnicalFormatted"
    Write-Host ""
    Write-Host "✅ All endpoints return the same canonical price!" -ForegroundColor Green
    exit 0
} else {
    Write-Host "Some Tests Failed! ❌" -ForegroundColor Red
    Write-Host "=========================================="
    Write-Host ""
    Write-Host "⚠️  Price inconsistency detected. Check logs above for details." -ForegroundColor Yellow
    exit 1
}

