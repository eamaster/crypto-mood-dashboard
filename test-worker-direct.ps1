# Direct worker test
$ts = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
$url = "https://crypto-mood-dashboard-production.smah0085.workers.dev/price?coin=bitcoin&_=$ts"

Write-Host "Testing worker: $url" -ForegroundColor Cyan
$start = Get-Date

try {
    $response = Invoke-WebRequest -Uri $url -TimeoutSec 35 -ErrorAction Stop
    $elapsed = ((Get-Date) - $start).TotalSeconds
    
    Write-Host "✅ SUCCESS in $([math]::Round($elapsed, 2))s" -ForegroundColor Green
    Write-Host "Status: $($response.StatusCode)" -ForegroundColor Cyan
    
    $json = $response.Content | ConvertFrom-Json
    Write-Host "Price: `$$($json.price)" -ForegroundColor Green
    Write-Host "Source: $($json.source)" -ForegroundColor $(if ($json.source -eq 'coincap') {'Green'} else {'Red'})
    Write-Host "Symbol: $($json.symbol)" -ForegroundColor Cyan
} catch {
    $elapsed = ((Get-Date) - $start).TotalSeconds
    Write-Host "❌ FAILED after $([math]::Round($elapsed, 2))s" -ForegroundColor Red
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    
    if ($_.Exception.Response) {
        $statusCode = $_.Exception.Response.StatusCode.value__
        Write-Host "Status Code: $statusCode" -ForegroundColor Yellow
        
        try {
            $stream = $_.Exception.Response.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($stream)
            $responseBody = $reader.ReadToEnd()
            
            Write-Host "Response Body:" -ForegroundColor Yellow
            Write-Host $responseBody -ForegroundColor Gray
            
            try {
                $errorJson = $responseBody | ConvertFrom-Json
                Write-Host "`nError Details:" -ForegroundColor Yellow
                Write-Host "  Error: $($errorJson.error)" -ForegroundColor Gray
                Write-Host "  Code: $($errorJson.code)" -ForegroundColor Gray
                Write-Host "  Details: $($errorJson.details)" -ForegroundColor Gray
                if ($errorJson.diagnostic) {
                    Write-Host "  Diagnostic Type: $($errorJson.diagnostic.type)" -ForegroundColor Gray
                    Write-Host "  Diagnostic Message: $($errorJson.diagnostic.message)" -ForegroundColor Gray
                    Write-Host "  Diagnostic Status: $($errorJson.diagnostic.status)" -ForegroundColor Gray
                }
            } catch {
                Write-Host "Could not parse error JSON" -ForegroundColor Gray
            }
        } catch {
            Write-Host "Could not read response body" -ForegroundColor Gray
        }
    }
}

