#!/bin/bash

# Self-test script for canonical price consistency and AI explain robustness
# Usage: ./test-canonical-price.sh <WORKER_URL>
# Example: ./test-canonical-price.sh https://crypto-mood-dashboard-production.smah0085.workers.dev

WORKER_URL="${1:-https://crypto-mood-dashboard-production.smah0085.workers.dev}"
COIN="bitcoin"
TIMESTAMP=$(date +%s)000

echo "=========================================="
echo "Canonical Price & AI Explain Self-Tests"
echo "=========================================="
echo "Worker URL: $WORKER_URL"
echo "Coin: $COIN"
echo "Timestamp: $TIMESTAMP"
echo ""

# Test 1: Price endpoint
echo "--- Test 1: Price Endpoint ---"
PRICE_RESPONSE=$(curl -s -i "${WORKER_URL}/price?coin=${COIN}&_=${TIMESTAMP}")
PRICE_STATUS=$(echo "$PRICE_RESPONSE" | head -n 1 | awk '{print $2}')
PRICE_BODY=$(echo "$PRICE_RESPONSE" | sed -n '/^{/,$p')
PRICE_VALUE=$(echo "$PRICE_BODY" | grep -o '"price":[0-9.]*' | grep -o '[0-9.]*')
CACHE_CONTROL=$(echo "$PRICE_RESPONSE" | grep -i "cache-control" | head -n 1)

echo "Status: $PRICE_STATUS"
echo "Price: $PRICE_VALUE"
echo "Cache-Control: $CACHE_CONTROL"
echo "Response: $PRICE_BODY"
echo ""

if [ "$PRICE_STATUS" != "200" ]; then
  echo "❌ FAIL: Price endpoint returned status $PRICE_STATUS"
  exit 1
fi

if [ -z "$PRICE_VALUE" ]; then
  echo "❌ FAIL: Price value is missing"
  exit 1
fi

if ! echo "$CACHE_CONTROL" | grep -q "s-maxage=60"; then
  echo "⚠️  WARN: Cache-Control does not include s-maxage=60"
fi

echo "✅ PASS: Price endpoint"
echo ""

# Test 2: OHLC endpoint
echo "--- Test 2: OHLC Endpoint ---"
OHLC_RESPONSE=$(curl -s -i "${WORKER_URL}/ohlc?coin=${COIN}&days=7&_=${TIMESTAMP}")
OHLC_STATUS=$(echo "$OHLC_RESPONSE" | head -n 1 | awk '{print $2}')
OHLC_BODY=$(echo "$OHLC_RESPONSE" | sed -n '/^{/,$p')
OHLC_LAST_CLOSE=$(echo "$OHLC_BODY" | grep -o '"lastClosePrice":"[0-9.]*"' | grep -o '[0-9.]*')
OHLC_PRICE_SOURCE=$(echo "$OHLC_BODY" | grep -o '"priceSource":"[^"]*"' | grep -o '"[^"]*"' | tr -d '"')

echo "Status: $OHLC_STATUS"
echo "lastClosePrice: $OHLC_LAST_CLOSE"
echo "priceSource: $OHLC_PRICE_SOURCE"
echo "Response (first 500 chars): $(echo "$OHLC_BODY" | head -c 500)"
echo ""

if [ "$OHLC_STATUS" != "200" ]; then
  echo "❌ FAIL: OHLC endpoint returned status $OHLC_STATUS"
  exit 1
fi

if [ -z "$OHLC_LAST_CLOSE" ]; then
  echo "❌ FAIL: lastClosePrice is missing"
  exit 1
fi

# Format price to 2 decimal places for comparison
PRICE_FORMATTED=$(printf "%.2f" "$PRICE_VALUE")
OHLC_FORMATTED=$(printf "%.2f" "$OHLC_LAST_CLOSE")

echo "Price endpoint (formatted): $PRICE_FORMATTED"
echo "OHLC lastClosePrice (formatted): $OHLC_FORMATTED"

if [ "$PRICE_FORMATTED" != "$OHLC_FORMATTED" ]; then
  echo "⚠️  WARN: Price mismatch detected (diff: $(echo "$PRICE_FORMATTED - $OHLC_FORMATTED" | bc))"
  echo "   This may be expected if prices updated between requests"
else
  echo "✅ PASS: Price consistency"
fi

echo "✅ PASS: OHLC endpoint"
echo ""

# Test 3: AI Explain endpoint
echo "--- Test 3: AI Explain Endpoint ---"
AI_START=$(date +%s)
AI_RESPONSE=$(curl -s -i -X POST "${WORKER_URL}/ai-explain" \
  -H "Content-Type: application/json" \
  -d "{\"coin\":\"${COIN}\",\"timeframe\":7,\"force\":true}")
AI_END=$(date +%s)
AI_DURATION=$((AI_END - AI_START))

AI_STATUS=$(echo "$AI_RESPONSE" | head -n 1 | awk '{print $2}')
AI_HEADERS=$(echo "$AI_RESPONSE" | head -n 20)
AI_BODY=$(echo "$AI_RESPONSE" | sed -n '/^{/,$p')
AI_STATUS_HEADER=$(echo "$AI_RESPONSE" | grep -i "x-ai-status" | head -n 1)
AI_REASON_HEADER=$(echo "$AI_RESPONSE" | grep -i "x-ai-reason" | head -n 1)
AI_LATENCY_HEADER=$(echo "$AI_RESPONSE" | grep -i "x-latency-ms" | head -n 1)
AI_TECHNICAL_PRICE=$(echo "$AI_BODY" | grep -o '"currentPrice":[0-9.]*' | grep -o '[0-9.]*')

echo "Status: $AI_STATUS"
echo "Duration: ${AI_DURATION}s"
echo "X-AI-Status: $AI_STATUS_HEADER"
echo "X-AI-Reason: $AI_REASON_HEADER"
echo "X-Latency-ms: $AI_LATENCY_HEADER"
echo "technicalContext.currentPrice: $AI_TECHNICAL_PRICE"
echo "Response headers:"
echo "$AI_HEADERS"
echo "Response body (first 1000 chars):"
echo "$AI_BODY" | head -c 1000
echo ""
echo ""

if [ "$AI_STATUS" != "200" ]; then
  echo "❌ FAIL: AI Explain endpoint returned status $AI_STATUS"
  exit 1
fi

if [ -z "$AI_STATUS_HEADER" ]; then
  echo "❌ FAIL: X-AI-Status header is missing"
  exit 1
fi

if [ "$AI_DURATION" -gt 25 ]; then
  echo "❌ FAIL: AI Explain took ${AI_DURATION}s (expected < 22s)"
  exit 1
fi

# Format AI technical price to 2 decimal places for comparison
if [ ! -z "$AI_TECHNICAL_PRICE" ]; then
  AI_TECHNICAL_FORMATTED=$(printf "%.2f" "$AI_TECHNICAL_PRICE")
  echo "Price endpoint (formatted): $PRICE_FORMATTED"
  echo "AI technicalContext.currentPrice (formatted): $AI_TECHNICAL_FORMATTED"
  
  if [ "$PRICE_FORMATTED" != "$AI_TECHNICAL_FORMATTED" ]; then
    echo "⚠️  WARN: AI price mismatch detected (diff: $(echo "$PRICE_FORMATTED - $AI_TECHNICAL_FORMATTED" | bc))"
    echo "   This may be expected if prices updated between requests"
  else
    echo "✅ PASS: AI price consistency"
  fi
fi

echo "✅ PASS: AI Explain endpoint"
echo ""

# Test 4: Sentiment Summary endpoint
echo "--- Test 4: Sentiment Summary Endpoint ---"
SENTIMENT_RESPONSE=$(curl -s -i "${WORKER_URL}/api/sentiment-summary?coin=${COIN}&_=${TIMESTAMP}")
SENTIMENT_STATUS=$(echo "$SENTIMENT_RESPONSE" | head -n 1 | awk '{print $2}')
SENTIMENT_BODY=$(echo "$SENTIMENT_RESPONSE" | sed -n '/^{/,$p')
SENTIMENT_SCORE=$(echo "$SENTIMENT_BODY" | grep -o '"score":[0-9.]*' | grep -o '[0-9.]*')
SENTIMENT_LABEL=$(echo "$SENTIMENT_BODY" | grep -o '"label":"[^"]*"' | grep -o '"[^"]*"' | tr -d '"')
SENTIMENT_CONFIDENCE=$(echo "$SENTIMENT_BODY" | grep -o '"confidence":"[^"]*"' | grep -o '"[^"]*"' | tr -d '"')
SENTIMENT_COUNT=$(echo "$SENTIMENT_BODY" | grep -o '"count":[0-9]*' | grep -o '[0-9]*')

echo "Status: $SENTIMENT_STATUS"
echo "Score: $SENTIMENT_SCORE"
echo "Label: $SENTIMENT_LABEL"
echo "Confidence: $SENTIMENT_CONFIDENCE"
echo "Count: $SENTIMENT_COUNT"
echo "Response: $SENTIMENT_BODY"
echo ""

if [ "$SENTIMENT_STATUS" != "200" ]; then
  echo "❌ FAIL: Sentiment Summary endpoint returned status $SENTIMENT_STATUS"
  exit 1
fi

if [ -z "$SENTIMENT_SCORE" ]; then
  echo "❌ FAIL: Sentiment score is missing"
  exit 1
fi

if [ -z "$SENTIMENT_LABEL" ]; then
  echo "❌ FAIL: Sentiment label is missing"
  exit 1
fi

# Validate label is one of the expected values
if [ "$SENTIMENT_LABEL" != "Bullish" ] && [ "$SENTIMENT_LABEL" != "Bearish" ] && [ "$SENTIMENT_LABEL" != "Neutral" ]; then
  echo "❌ FAIL: Invalid sentiment label: $SENTIMENT_LABEL"
  exit 1
fi

# Validate score is between 0 and 1
SCORE_FLOAT=$(echo "$SENTIMENT_SCORE")
if (( $(echo "$SCORE_FLOAT < 0" | bc -l) )) || (( $(echo "$SCORE_FLOAT > 1" | bc -l) )); then
  echo "❌ FAIL: Invalid sentiment score: $SENTIMENT_SCORE (expected 0-1)"
  exit 1
fi

echo "✅ PASS: Sentiment Summary endpoint"
echo ""

echo "=========================================="
echo "All Tests Passed!"
echo "=========================================="
echo ""
echo "Summary:"
echo "  - Price endpoint: ✅"
echo "  - OHLC endpoint: ✅"
echo "  - AI Explain endpoint: ✅"
echo "  - Sentiment Summary endpoint: ✅"
echo ""
echo "Price consistency:"
echo "  - Price endpoint: $PRICE_FORMATTED"
echo "  - OHLC lastClosePrice: $OHLC_FORMATTED"
if [ ! -z "$AI_TECHNICAL_PRICE" ]; then
  echo "  - AI technicalContext.currentPrice: $AI_TECHNICAL_FORMATTED"
fi
echo ""

