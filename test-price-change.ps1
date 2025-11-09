# Test script for price change validation
# Tests that worker returns change24h and changeFmt, and client can compute fallback if needed
# Usage: .\test-price-change.ps1 [WORKER_URL]

param(
    [string]$WORKER_URL = "https://crypto-mood-dashboard-production.smah0085.workers.dev"
)

$COIN = "bitcoin"
$TIMESTAMP = [int64](([datetime]::UtcNow)-(get-date "1/1/1970")).TotalMilliseconds

Write-Host "=========================================="
Write-Host "Price Change Validation Tests"
Write-Host "=========================================="
Write-Host "Worker URL: $WORKER_URL"
Write-Host "Coin: $COIN"
Write-Host ""

$allTestsPassed = $true

# Test 1: Price endpoint - verify change24h and changeFmt
Write-Host "--- Test 1: Price Endpoint (change24h + changeFmt) ---"
try {
    $priceResponse = Invoke-WebRequest -Uri "${WORKER_URL}/price?coin=${COIN}&_=${TIMESTAMP}" -Method GET -UseBasicParsing
    $priceStatus = $priceResponse.StatusCode
    $priceBody = $priceResponse.Content | ConvertFrom-Json
    
    $priceNumeric = [double]$priceBody.price
    $priceFmt = $priceBody.priceFmt
    $change24h = $priceBody.change24h
    $changeFmt = $priceBody.changeFmt
    $source = $priceBody.source
    
    Write-Host "Status: $priceStatus"
    Write-Host "price: $priceNumeric"
    Write-Host "priceFmt: $priceFmt"
    Write-Host "change24h: $change24h"
    Write-Host "changeFmt: $changeFmt"
    Write-Host "source: $source"
    Write-Host ""
    
    if ($priceStatus -ne 200) {
        Write-Host "❌ FAIL: Price endpoint returned status $priceStatus" -ForegroundColor Red
        $allTestsPassed = $false
    } else {
        # Verify change24h is numeric or null (PowerShell JSON conversion may use decimal, double, int, etc.)
        if ($change24h -ne $null) {
            try {
                $change24hNum = [double]$change24h
                if ([double]::IsNaN($change24hNum) -or [double]::IsInfinity($change24hNum)) {
                    Write-Host "❌ FAIL: change24h is not a valid number" -ForegroundColor Red
                    $allTestsPassed = $false
                } else {
                    Write-Host "✅ PASS: change24h is numeric ($change24hNum)" -ForegroundColor Green
                }
            } catch {
                Write-Host "❌ FAIL: change24h is not numeric (type: $($change24h.GetType().Name))" -ForegroundColor Red
                $allTestsPassed = $false
            }
        } else {
            Write-Host "⚠️  WARN: change24h is null (client will compute)" -ForegroundColor Yellow
        }
        
        # Verify changeFmt matches change24h when both are present
        if ($change24h -ne $null -and $changeFmt -ne $null) {
            $expectedChangeFmt = [math]::Round($change24h, 2).ToString("F2")
            if ($changeFmt -ne $expectedChangeFmt) {
                Write-Host "❌ FAIL: changeFmt mismatch! changeFmt=$changeFmt, expected=$expectedChangeFmt" -ForegroundColor Red
                $allTestsPassed = $false
            } else {
                Write-Host "✅ PASS: changeFmt matches change24h.toFixed(2)" -ForegroundColor Green
            }
        } elseif ($change24h -eq $null -and $changeFmt -eq $null) {
            Write-Host "⚠️  WARN: change24h and changeFmt are both null (client will compute)" -ForegroundColor Yellow
        } else {
            Write-Host "⚠️  WARN: change24h and changeFmt mismatch (one null, one not)" -ForegroundColor Yellow
        }
        
        Write-Host "✅ PASS: Price endpoint" -ForegroundColor Green
    }
} catch {
    Write-Host "❌ FAIL: Price endpoint error: $_" -ForegroundColor Red
    $allTestsPassed = $false
}

Write-Host ""

# Test 2: OHLC endpoint - verify lastClosePriceNumeric for change computation
Write-Host "--- Test 2: OHLC Endpoint (lastClosePriceNumeric for change computation) ---"
try {
    $ohlcResponse = Invoke-WebRequest -Uri "${WORKER_URL}/ohlc?coin=${COIN}&days=7&_=${TIMESTAMP}" -Method GET -UseBasicParsing
    $ohlcStatus = $ohlcResponse.StatusCode
    $ohlcBody = $ohlcResponse.Content | ConvertFrom-Json
    
    $lastClosePrice = $ohlcBody.lastClosePrice
    $lastClosePriceNumeric = $ohlcBody.lastClosePriceNumeric
    $priceSource = $ohlcBody.priceSource
    
    Write-Host "Status: $ohlcStatus"
    Write-Host "lastClosePrice: $lastClosePrice"
    Write-Host "lastClosePriceNumeric: $lastClosePriceNumeric"
    Write-Host "priceSource: $priceSource"
    Write-Host ""
    
    if ($ohlcStatus -ne 200) {
        Write-Host "❌ FAIL: OHLC endpoint returned status $ohlcStatus" -ForegroundColor Red
        $allTestsPassed = $false
    } else {
        # Verify lastClosePriceNumeric is numeric
        if ($lastClosePriceNumeric -eq $null) {
            Write-Host "❌ FAIL: lastClosePriceNumeric is missing" -ForegroundColor Red
            $allTestsPassed = $false
        } else {
            try {
                $lastCloseNum = [double]$lastClosePriceNumeric
                if ([double]::IsNaN($lastCloseNum) -or [double]::IsInfinity($lastCloseNum)) {
                    Write-Host "❌ FAIL: lastClosePriceNumeric is not a valid number" -ForegroundColor Red
                    $allTestsPassed = $false
                } else {
                    Write-Host "✅ PASS: lastClosePriceNumeric is present and numeric ($lastCloseNum)" -ForegroundColor Green
                }
            } catch {
                Write-Host "❌ FAIL: lastClosePriceNumeric is not numeric (type: $($lastClosePriceNumeric.GetType().Name))" -ForegroundColor Red
                $allTestsPassed = $false
            }
        }
        
        # Verify lastClosePrice matches lastClosePriceNumeric when formatted
        if ($lastClosePriceNumeric -ne $null) {
            $expectedLastClose = [math]::Round($lastClosePriceNumeric, 2).ToString("F2")
            if ($lastClosePrice -ne $expectedLastClose) {
                Write-Host "❌ FAIL: lastClosePrice mismatch! lastClosePrice=$lastClosePrice, expected=$expectedLastClose" -ForegroundColor Red
                $allTestsPassed = $false
            } else {
                Write-Host "✅ PASS: lastClosePrice matches lastClosePriceNumeric.toFixed(2)" -ForegroundColor Green
            }
        }
        
        Write-Host "✅ PASS: OHLC endpoint" -ForegroundColor Green
    }
} catch {
    Write-Host "❌ FAIL: OHLC endpoint error: $_" -ForegroundColor Red
    $allTestsPassed = $false
}

Write-Host ""

# Test 3: Compute change from price and OHLC if server didn't provide it
Write-Host "--- Test 3: Change Computation (client fallback) ---"
try {
    if ($priceNumeric -and $lastClosePriceNumeric -and $change24h -eq $null) {
        # Compute change: ((current - prev) / prev) * 100
        $computedChange = (($priceNumeric - $lastClosePriceNumeric) / $lastClosePriceNumeric) * 100
        $computedChangeFmt = [math]::Round($computedChange, 2).ToString("F2")
        
        Write-Host "Server change24h: null (missing)"
        Write-Host "Computed change24h: $computedChange"
        Write-Host "Computed changeFmt: $computedChangeFmt"
        Write-Host ""
        
        Write-Host "✅ PASS: Change can be computed from price and OHLC" -ForegroundColor Green
    } elseif ($change24h -ne $null) {
        Write-Host "Server provided change24h: $change24h"
        Write-Host "✅ PASS: Server provided change24h (no computation needed)" -ForegroundColor Green
    } else {
        Write-Host "⚠️  WARN: Cannot compute change (missing price or lastClosePriceNumeric)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "❌ FAIL: Change computation error: $_" -ForegroundColor Red
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
    Write-Host "  - Price endpoint: ✅ (change24h, changeFmt)" -ForegroundColor Green
    Write-Host "  - OHLC endpoint: ✅ (lastClosePriceNumeric)" -ForegroundColor Green
    Write-Host "  - Change computation: ✅ (fallback available)" -ForegroundColor Green
    Write-Host ""
    if ($change24h -ne $null) {
        Write-Host "Price Change: $changeFmt% (server-provided)"
    } else {
        Write-Host "Price Change: Computed from OHLC (server did not provide)"
    }
    Write-Host "✅ Price change validation passed!" -ForegroundColor Green
    exit 0
} else {
    Write-Host "Some Tests Failed! ❌" -ForegroundColor Red
    Write-Host "=========================================="
    Write-Host ""
    Write-Host "⚠️  Some validation tests failed. Check logs above for details." -ForegroundColor Yellow
    exit 1
}

