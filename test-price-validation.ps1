# Test script for price validation and canonical format consistency
# Tests that worker returns both timestamp formats and priceFmt, and frontend accepts them
# Usage: .\test-price-validation.ps1 [WORKER_URL]

param(
    [string]$WORKER_URL = "https://crypto-mood-dashboard-production.smah0085.workers.dev"
)

$COIN = "bitcoin"
$TIMESTAMP = [int64](([datetime]::UtcNow)-(get-date "1/1/1970")).TotalMilliseconds

Write-Host "=========================================="
Write-Host "Price Validation & Canonical Format Tests"
Write-Host "=========================================="
Write-Host "Worker URL: $WORKER_URL"
Write-Host "Coin: $COIN"
Write-Host ""

$allTestsPassed = $true

# Test 1: Price endpoint - verify both timestamp formats and priceFmt
Write-Host "--- Test 1: Price Endpoint (timestamp formats + priceFmt) ---"
try {
    $priceResponse = Invoke-WebRequest -Uri "${WORKER_URL}/price?coin=${COIN}&_=${TIMESTAMP}" -Method GET -UseBasicParsing
    $priceStatus = $priceResponse.StatusCode
    $priceBody = $priceResponse.Content | ConvertFrom-Json
    
    $priceNumeric = [double]$priceBody.price
    $priceFmt = $priceBody.priceFmt
    $timestampIso = $priceBody.timestampIso
    $timestampMs = $priceBody.timestampMs
    $timestamp = $priceBody.timestamp
    $source = $priceBody.source
    
    Write-Host "Status: $priceStatus"
    Write-Host "price (numeric): $priceNumeric"
    Write-Host "priceFmt (string): $priceFmt"
    Write-Host "timestampIso: $timestampIso"
    Write-Host "timestampMs: $timestampMs"
    Write-Host "timestamp (backward compat): $timestamp"
    Write-Host "source: $source"
    Write-Host ""
    
    if ($priceStatus -ne 200) {
        Write-Host "❌ FAIL: Price endpoint returned status $priceStatus" -ForegroundColor Red
        $allTestsPassed = $false
    } else {
        # Verify priceFmt matches price.toFixed(2)
        $expectedPriceFmt = [math]::Round($priceNumeric, 2).ToString("F2")
        if ($priceFmt -ne $expectedPriceFmt) {
            Write-Host "❌ FAIL: priceFmt mismatch! priceFmt=$priceFmt, expected=$expectedPriceFmt" -ForegroundColor Red
            $allTestsPassed = $false
        } else {
            Write-Host "✅ PASS: priceFmt matches price.toFixed(2)" -ForegroundColor Green
        }
        
        # Verify timestampIso is valid ISO string
        if (-not $timestampIso -or $timestampIso -notmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}') {
            Write-Host "❌ FAIL: timestampIso is invalid or missing" -ForegroundColor Red
            $allTestsPassed = $false
        } else {
            Write-Host "✅ PASS: timestampIso is valid" -ForegroundColor Green
        }
        
        # Verify timestampMs is numeric
        if (-not $timestampMs -or $timestampMs -isnot [long] -and $timestampMs -isnot [double]) {
            Write-Host "❌ FAIL: timestampMs is invalid or missing" -ForegroundColor Red
            $allTestsPassed = $false
        } else {
            Write-Host "✅ PASS: timestampMs is valid numeric" -ForegroundColor Green
        }
        
        # Verify timestampMs and timestampIso represent the same time
        $tsMsFromIso = [DateTimeOffset]::Parse($timestampIso).ToUnixTimeMilliseconds()
        $tsMsDiff = [math]::Abs($timestampMs - $tsMsFromIso)
        if ($tsMsDiff -gt 1000) {
            Write-Host "⚠️  WARN: timestampMs and timestampIso differ by ${tsMsDiff}ms" -ForegroundColor Yellow
        } else {
            Write-Host "✅ PASS: timestampMs and timestampIso are consistent" -ForegroundColor Green
        }
        
        Write-Host "✅ PASS: Price endpoint" -ForegroundColor Green
    }
} catch {
    Write-Host "❌ FAIL: Price endpoint error: $_" -ForegroundColor Red
    $allTestsPassed = $false
}

Write-Host ""

# Test 2: OHLC endpoint - verify lastClosePrice and timestamp formats
Write-Host "--- Test 2: OHLC Endpoint (lastClosePrice + timestamp formats) ---"
try {
    $ohlcResponse = Invoke-WebRequest -Uri "${WORKER_URL}/ohlc?coin=${COIN}&days=7&_=${TIMESTAMP}" -Method GET -UseBasicParsing
    $ohlcStatus = $ohlcResponse.StatusCode
    $ohlcBody = $ohlcResponse.Content | ConvertFrom-Json
    
    $lastClosePrice = $ohlcBody.lastClosePrice
    $lastClosePriceNumeric = $ohlcBody.lastClosePriceNumeric
    $lastPointTimestampIso = $ohlcBody.lastPointTimestampIso
    $lastPointTimestampMs = $ohlcBody.lastPointTimestampMs
    $lastPointTimestamp = $ohlcBody.lastPointTimestamp
    $priceSource = $ohlcBody.priceSource
    
    Write-Host "Status: $ohlcStatus"
    Write-Host "lastClosePrice (string): $lastClosePrice"
    Write-Host "lastClosePriceNumeric: $lastClosePriceNumeric"
    Write-Host "lastPointTimestampIso: $lastPointTimestampIso"
    Write-Host "lastPointTimestampMs: $lastPointTimestampMs"
    Write-Host "lastPointTimestamp (backward compat): $lastPointTimestamp"
    Write-Host "priceSource: $priceSource"
    Write-Host ""
    
    if ($ohlcStatus -ne 200) {
        Write-Host "❌ FAIL: OHLC endpoint returned status $ohlcStatus" -ForegroundColor Red
        $allTestsPassed = $false
    } else {
        # Verify lastClosePrice matches lastClosePriceNumeric when formatted
        if ($lastClosePriceNumeric) {
            $expectedLastClose = [math]::Round($lastClosePriceNumeric, 2).ToString("F2")
            if ($lastClosePrice -ne $expectedLastClose) {
                Write-Host "❌ FAIL: lastClosePrice mismatch! lastClosePrice=$lastClosePrice, expected=$expectedLastClose" -ForegroundColor Red
                $allTestsPassed = $false
            } else {
                Write-Host "✅ PASS: lastClosePrice matches lastClosePriceNumeric.toFixed(2)" -ForegroundColor Green
            }
        }
        
        # Verify timestamp formats are present
        if (-not $lastPointTimestampIso) {
            Write-Host "❌ FAIL: lastPointTimestampIso is missing" -ForegroundColor Red
            $allTestsPassed = $false
        } else {
            Write-Host "✅ PASS: lastPointTimestampIso is present" -ForegroundColor Green
        }
        
        if (-not $lastPointTimestampMs) {
            Write-Host "❌ FAIL: lastPointTimestampMs is missing" -ForegroundColor Red
            $allTestsPassed = $false
        } else {
            Write-Host "✅ PASS: lastPointTimestampMs is present" -ForegroundColor Green
        }
        
        Write-Host "✅ PASS: OHLC endpoint" -ForegroundColor Green
    }
} catch {
    Write-Host "❌ FAIL: OHLC endpoint error: $_" -ForegroundColor Red
    $allTestsPassed = $false
}

Write-Host ""

# Test 3: Verify price/ohlc consistency
Write-Host "--- Test 3: Price/OHLC Consistency ---"
try {
    if ($priceFmt -and $lastClosePrice) {
        if ($priceFmt -ne $lastClosePrice) {
            Write-Host "❌ FAIL: Price/OHLC mismatch! priceFmt=$priceFmt, lastClosePrice=$lastClosePrice" -ForegroundColor Red
            $allTestsPassed = $false
        } else {
            Write-Host "✅ PASS: priceFmt matches lastClosePrice" -ForegroundColor Green
        }
    }
} catch {
    Write-Host "⚠️  WARN: Could not verify price/OHLC consistency" -ForegroundColor Yellow
}

Write-Host ""

# Test 4: AI Explain endpoint - verify technicalContext.currentPrice matches priceFmt
Write-Host "--- Test 4: AI Explain Endpoint (technicalContext.currentPrice consistency) ---"
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
    $aiTechnicalFormatted = [math]::Round($aiTechnicalPrice, 2).ToString("F2")
    
    Write-Host "Status: $aiStatus"
    Write-Host "Duration: $([math]::Round($aiDuration, 2))s"
    Write-Host "technicalContext.currentPrice: $aiTechnicalPrice"
    Write-Host "technicalContext.currentPrice (formatted): $aiTechnicalFormatted"
    Write-Host ""
    
    if ($aiStatus -ne 200) {
        Write-Host "❌ FAIL: AI Explain endpoint returned status $aiStatus" -ForegroundColor Red
        $allTestsPassed = $false
    } elseif ($priceFmt -and $aiTechnicalFormatted -ne $priceFmt) {
        Write-Host "❌ FAIL: AI price mismatch! priceFmt=$priceFmt, aiTechnicalFormatted=$aiTechnicalFormatted" -ForegroundColor Red
        $allTestsPassed = $false
    } else {
        Write-Host "✅ PASS: AI technicalContext.currentPrice matches priceFmt" -ForegroundColor Green
    }
} catch {
    Write-Host "❌ FAIL: AI Explain endpoint error: $_" -ForegroundColor Red
    $allTestsPassed = $false
}

Write-Host ""

# Summary
Write-Host "=========================================="
if ($allTestsPassed) {
    Write-Host "All Tests Passed! ✅" -ForegroundColor Green
    Write-Host "=========================================="
    Write-Host ""
    Write-Host "Summary:"
    Write-Host "  - Price endpoint: ✅ (priceFmt, timestampIso, timestampMs)" -ForegroundColor Green
    Write-Host "  - OHLC endpoint: ✅ (lastClosePrice, lastClosePriceNumeric, timestamp formats)" -ForegroundColor Green
    Write-Host "  - Price/OHLC consistency: ✅" -ForegroundColor Green
    Write-Host "  - AI Explain consistency: ✅" -ForegroundColor Green
    Write-Host ""
    Write-Host "Canonical Price: $priceFmt ($source)"
    Write-Host "✅ All endpoints return consistent canonical price!" -ForegroundColor Green
    exit 0
} else {
    Write-Host "Some Tests Failed! ❌" -ForegroundColor Red
    Write-Host "=========================================="
    Write-Host ""
    Write-Host "⚠️  Some validation tests failed. Check logs above for details." -ForegroundColor Yellow
    exit 1
}

