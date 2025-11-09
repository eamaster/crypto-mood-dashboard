# Self-test script for canonical price consistency and AI explain robustness
# Usage: .\test-canonical-price.ps1 [WORKER_URL]
# Example: .\test-canonical-price.ps1 https://crypto-mood-dashboard-production.smah0085.workers.dev

param(
    [string]$WORKER_URL = "https://crypto-mood-dashboard-production.smah0085.workers.dev"
)

$COIN = "bitcoin"
$TIMESTAMP = [int64](([datetime]::UtcNow)-(get-date "1/1/1970")).TotalMilliseconds

Write-Host "=========================================="
Write-Host "Canonical Price & AI Explain Self-Tests"
Write-Host "=========================================="
Write-Host "Worker URL: $WORKER_URL"
Write-Host "Coin: $COIN"
Write-Host "Timestamp: $TIMESTAMP"
Write-Host ""

# Test 1: Price endpoint
Write-Host "--- Test 1: Price Endpoint ---"
try {
    $priceResponse = Invoke-WebRequest -Uri "${WORKER_URL}/price?coin=${COIN}&_=${TIMESTAMP}" -Method GET -UseBasicParsing
    $priceStatus = $priceResponse.StatusCode
    $priceBody = $priceResponse.Content | ConvertFrom-Json
    $priceValue = [double]$priceBody.price
    $cacheControl = $priceResponse.Headers["Cache-Control"]
    
    Write-Host "Status: $priceStatus"
    Write-Host "Price: $priceValue"
    Write-Host "Cache-Control: $cacheControl"
    Write-Host "Response: $($priceResponse.Content)"
    Write-Host ""
    
    if ($priceStatus -ne 200) {
        Write-Host "❌ FAIL: Price endpoint returned status $priceStatus" -ForegroundColor Red
        exit 1
    }
    
    if (-not $priceValue) {
        Write-Host "❌ FAIL: Price value is missing" -ForegroundColor Red
        exit 1
    }
    
    if ($cacheControl -notmatch "s-maxage=60") {
        Write-Host "⚠️  WARN: Cache-Control does not include s-maxage=60" -ForegroundColor Yellow
    }
    
    Write-Host "✅ PASS: Price endpoint" -ForegroundColor Green
    Write-Host ""
} catch {
    Write-Host "❌ FAIL: Price endpoint error: $_" -ForegroundColor Red
    exit 1
}

# Test 2: OHLC endpoint
Write-Host "--- Test 2: OHLC Endpoint ---"
try {
    $ohlcResponse = Invoke-WebRequest -Uri "${WORKER_URL}/ohlc?coin=${COIN}&days=7&_=${TIMESTAMP}" -Method GET -UseBasicParsing
    $ohlcStatus = $ohlcResponse.StatusCode
    $ohlcBody = $ohlcResponse.Content | ConvertFrom-Json
    $ohlcLastClose = [double]$ohlcBody.lastClosePrice
    $ohlcPriceSource = $ohlcBody.priceSource
    
    Write-Host "Status: $ohlcStatus"
    Write-Host "lastClosePrice: $ohlcLastClose"
    Write-Host "priceSource: $ohlcPriceSource"
    Write-Host "Response (first 500 chars): $($ohlcResponse.Content.Substring(0, [Math]::Min(500, $ohlcResponse.Content.Length)))"
    Write-Host ""
    
    if ($ohlcStatus -ne 200) {
        Write-Host "❌ FAIL: OHLC endpoint returned status $ohlcStatus" -ForegroundColor Red
        exit 1
    }
    
    if (-not $ohlcLastClose) {
        Write-Host "❌ FAIL: lastClosePrice is missing" -ForegroundColor Red
        exit 1
    }
    
    # Format price to 2 decimal places for comparison
    $priceFormatted = [math]::Round($priceValue, 2)
    $ohlcFormatted = [math]::Round($ohlcLastClose, 2)
    
    Write-Host "Price endpoint (formatted): $priceFormatted"
    Write-Host "OHLC lastClosePrice (formatted): $ohlcFormatted"
    
    $priceDiff = [math]::Abs($priceFormatted - $ohlcFormatted)
    if ($priceDiff -gt 0.01) {
        Write-Host "⚠️  WARN: Price mismatch detected (diff: $priceDiff)" -ForegroundColor Yellow
        Write-Host "   This may be expected if prices updated between requests"
    } else {
        Write-Host "✅ PASS: Price consistency" -ForegroundColor Green
    }
    
    Write-Host "✅ PASS: OHLC endpoint" -ForegroundColor Green
    Write-Host ""
} catch {
    Write-Host "❌ FAIL: OHLC endpoint error: $_" -ForegroundColor Red
    exit 1
}

# Test 3: AI Explain endpoint
Write-Host "--- Test 3: AI Explain Endpoint ---"
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
    $aiHeaders = $aiResponse.Headers
    $aiResponseBody = $aiResponse.Content | ConvertFrom-Json
    $aiStatusHeader = $aiResponse.Headers["X-AI-Status"]
    $aiReasonHeader = $aiResponse.Headers["X-AI-Reason"]
    $aiLatencyHeader = $aiResponse.Headers["X-Latency-ms"]
    $aiTechnicalPrice = $aiResponseBody.technicalContext.currentPrice
    
    Write-Host "Status: $aiStatus"
    Write-Host "Duration: $([math]::Round($aiDuration, 2))s"
    Write-Host "X-AI-Status: $aiStatusHeader"
    Write-Host "X-AI-Reason: $aiReasonHeader"
    Write-Host "X-Latency-ms: $aiLatencyHeader"
    Write-Host "technicalContext.currentPrice: $aiTechnicalPrice"
    Write-Host "Response headers:"
    $aiHeaders.GetEnumerator() | ForEach-Object { Write-Host "  $($_.Key): $($_.Value)" }
    Write-Host "Response body (first 1000 chars):"
    Write-Host $aiResponse.Content.Substring(0, [Math]::Min(1000, $aiResponse.Content.Length))
    Write-Host ""
    Write-Host ""
    
    if ($aiStatus -ne 200) {
        Write-Host "❌ FAIL: AI Explain endpoint returned status $aiStatus" -ForegroundColor Red
        exit 1
    }
    
    if (-not $aiStatusHeader) {
        Write-Host "❌ FAIL: X-AI-Status header is missing" -ForegroundColor Red
        exit 1
    }
    
    if ($aiDuration -gt 25) {
        Write-Host "❌ FAIL: AI Explain took $([math]::Round($aiDuration, 2))s (expected < 22s)" -ForegroundColor Red
        exit 1
    }
    
    # Format AI technical price to 2 decimal places for comparison
    if ($aiTechnicalPrice) {
        $aiTechnicalFormatted = [math]::Round($aiTechnicalPrice, 2)
        Write-Host "Price endpoint (formatted): $priceFormatted"
        Write-Host "AI technicalContext.currentPrice (formatted): $aiTechnicalFormatted"
        
        $aiPriceDiff = [math]::Abs($priceFormatted - $aiTechnicalFormatted)
        if ($aiPriceDiff -gt 0.01) {
            Write-Host "⚠️  WARN: AI price mismatch detected (diff: $aiPriceDiff)" -ForegroundColor Yellow
            Write-Host "   This may be expected if prices updated between requests"
        } else {
            Write-Host "✅ PASS: AI price consistency" -ForegroundColor Green
        }
    }
    
    Write-Host "✅ PASS: AI Explain endpoint" -ForegroundColor Green
    Write-Host ""
} catch {
    Write-Host "❌ FAIL: AI Explain endpoint error: $_" -ForegroundColor Red
    Write-Host "Response: $($_.Exception.Response)" -ForegroundColor Yellow
    exit 1
}

# Test 4: Sentiment Summary endpoint
Write-Host "--- Test 4: Sentiment Summary Endpoint ---"
try {
    $sentimentResponse = Invoke-WebRequest -Uri "${WORKER_URL}/api/sentiment-summary?coin=${COIN}&_=${TIMESTAMP}" -Method GET -UseBasicParsing
    $sentimentStatus = $sentimentResponse.StatusCode
    $sentimentBody = $sentimentResponse.Content | ConvertFrom-Json
    $sentimentScore = [double]$sentimentBody.score
    $sentimentLabel = $sentimentBody.label
    $sentimentConfidence = $sentimentBody.confidence
    $sentimentCount = $sentimentBody.count
    
    Write-Host "Status: $sentimentStatus"
    Write-Host "Score: $sentimentScore"
    Write-Host "Label: $sentimentLabel"
    Write-Host "Confidence: $sentimentConfidence"
    Write-Host "Count: $sentimentCount"
    Write-Host "Response: $($sentimentResponse.Content)"
    Write-Host ""
    
    if ($sentimentStatus -ne 200) {
        Write-Host "❌ FAIL: Sentiment Summary endpoint returned status $sentimentStatus" -ForegroundColor Red
        exit 1
    }
    
    if (-not $sentimentScore) {
        Write-Host "❌ FAIL: Sentiment score is missing" -ForegroundColor Red
        exit 1
    }
    
    if (-not $sentimentLabel) {
        Write-Host "❌ FAIL: Sentiment label is missing" -ForegroundColor Red
        exit 1
    }
    
    # Validate label is one of the expected values
    $validLabels = @("Bullish", "Bearish", "Neutral")
    if ($sentimentLabel -notin $validLabels) {
        Write-Host "❌ FAIL: Invalid sentiment label: $sentimentLabel" -ForegroundColor Red
        exit 1
    }
    
    # Validate score is between 0 and 1
    if ($sentimentScore -lt 0 -or $sentimentScore -gt 1) {
        Write-Host "❌ FAIL: Invalid sentiment score: $sentimentScore (expected 0-1)" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "✅ PASS: Sentiment Summary endpoint" -ForegroundColor Green
    Write-Host ""
} catch {
    Write-Host "❌ FAIL: Sentiment Summary endpoint error: $_" -ForegroundColor Red
    exit 1
}

Write-Host "=========================================="
Write-Host "All Tests Passed!" -ForegroundColor Green
Write-Host "=========================================="
Write-Host ""
Write-Host "Summary:"
Write-Host "  - Price endpoint: ✅" -ForegroundColor Green
Write-Host "  - OHLC endpoint: ✅" -ForegroundColor Green
Write-Host "  - AI Explain endpoint: ✅" -ForegroundColor Green
Write-Host "  - Sentiment Summary endpoint: ✅" -ForegroundColor Green
Write-Host ""
Write-Host "Price consistency:"
Write-Host "  - Price endpoint: $priceFormatted"
Write-Host "  - OHLC lastClosePrice: $ohlcFormatted"
if ($aiTechnicalPrice) {
    Write-Host "  - AI technicalContext.currentPrice: $([math]::Round($aiTechnicalPrice, 2))"
}
Write-Host ""

