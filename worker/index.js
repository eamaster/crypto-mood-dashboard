// =============================================================================
// Crypto Mood Dashboard - Cloudflare Worker
// Handles API calls to Blockchair, @https://newsapi.org/, and Cohere AI
// =============================================================================

// CORS headers for frontend requests
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Response helper
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}

// Error response helper
function errorResponse(message, status = 400) {
  return jsonResponse({ error: message }, status);
}

// Supported cryptocurrencies mapping (Blockchair supported coins)
const SUPPORTED_COINS = {
  'bitcoin': { id: 'bitcoin', name: 'Bitcoin', symbol: 'BTC' },
  'ethereum': { id: 'ethereum', name: 'Ethereum', symbol: 'ETH' },
  'litecoin': { id: 'litecoin', name: 'Litecoin', symbol: 'LTC' },
  'bitcoin-cash': { id: 'bitcoin-cash', name: 'Bitcoin Cash', symbol: 'BCH' },
  'cardano': { id: 'cardano', name: 'Cardano', symbol: 'ADA' },
  'ripple': { id: 'ripple', name: 'Ripple', symbol: 'XRP' },
  'dogecoin': { id: 'dogecoin', name: 'Dogecoin', symbol: 'DOGE' },
  'polkadot': { id: 'polkadot', name: 'Polkadot', symbol: 'DOT' },
  'chainlink': { id: 'chainlink', name: 'Chainlink', symbol: 'LINK' },
  'stellar': { id: 'stellar', name: 'Stellar', symbol: 'XLM' },
  'monero': { id: 'monero', name: 'Monero', symbol: 'XMR' },
  'tezos': { id: 'tezos', name: 'Tezos', symbol: 'XTZ' },
  'eos': { id: 'eos', name: 'EOS', symbol: 'EOS' },
  'zcash': { id: 'zcash', name: 'Zcash', symbol: 'ZEC' },
  'dash': { id: 'dash', name: 'Dash', symbol: 'DASH' },
};

// =============================================================================
// API HANDLERS
// =============================================================================

async function handleCoins() {
  try {
    // Return our supported coins list
    const coinsList = Object.values(SUPPORTED_COINS);
    return jsonResponse(coinsList);
  } catch (error) {
    console.error('Error fetching coins:', error);
    return errorResponse('Failed to fetch supported coins');
  }
}

async function handlePrice(request, env) {
  try {
    const url = new URL(request.url);
    const coinId = url.searchParams.get('coin') || 'bitcoin';
    
    if (!SUPPORTED_COINS[coinId]) {
      return errorResponse(`Unsupported coin: ${coinId}`);
    }
    
    // Fetch current price from Blockchair
    const response = await fetch(`https://api.blockchair.com/${coinId}/stats`, {
      headers: {
        'X-API-Key': env.BLOCKCHAIR_API_KEY,
      },
    });
    
    if (!response.ok) {
      throw new Error(`Blockchair API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.data || !data.data.market_price_usd) {
      throw new Error('Invalid price data from Blockchair');
    }
    
    // Calculate 24h change (simplified - using current price vs yesterday estimation)
    // Note: Blockchair doesn't provide direct 24h change, so we'll estimate
    const currentPrice = data.data.market_price_usd;
    const change24h = Math.random() * 10 - 5; // Placeholder - in real app would fetch historical data
    
    return jsonResponse({
      coin: coinId,
      price: currentPrice,
      change24h: change24h,
      symbol: SUPPORTED_COINS[coinId].symbol,
      timestamp: new Date().toISOString(),
    });
    
  } catch (error) {
    console.error('Error fetching price:', error);
    return errorResponse(`Failed to fetch price: ${error.message}`);
  }
}

async function handleHistory(request, env) {
  try {
    const url = new URL(request.url);
    const coinId = url.searchParams.get('coin') || 'bitcoin';
    const days = parseInt(url.searchParams.get('days')) || 7;
    
    if (!SUPPORTED_COINS[coinId]) {
      return errorResponse(`Unsupported coin: ${coinId}`);
    }
    
    // Since Blockchair doesn't have a simple historical price endpoint,
    // we'll generate consistent historical data based on current price
    const statsResponse = await fetch(`https://api.blockchair.com/${coinId}/stats`, {
      headers: {
        'X-API-Key': env.BLOCKCHAIR_API_KEY,
      },
    });
    
    if (!statsResponse.ok) {
      throw new Error(`Blockchair API error: ${statsResponse.status}`);
    }
    
    const statsData = await statsResponse.json();
    
    if (!statsData.data || !statsData.data.market_price_usd) {
      throw new Error('Invalid price data from Blockchair');
    }
    
    const currentPrice = statsData.data.market_price_usd;
    
    // Generate deterministic historical price data (consistent for same coin/day)
    const prices = [];
    const now = Date.now();
    const millisecondsPerDay = 24 * 60 * 60 * 1000;
    
    // Create a seed based on current date (not time) for consistency within the day
    const today = new Date();
    const dateSeed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
    
    // Simple pseudo-random function with seed for consistent results
    function seededRandom(seed) {
      const x = Math.sin(seed) * 10000;
      return x - Math.floor(x);
    }
    
    for (let i = days - 1; i >= 0; i--) {
      const timestamp = now - (i * millisecondsPerDay);
      const date = new Date(timestamp);
      
      let price;
      
      // For today (i = 0), use the exact current price to match /price endpoint
      if (i === 0) {
        price = currentPrice;
      } else {
        // For historical days, generate simulated data
        const coinSeed = coinId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        const dayNumber = Math.floor(timestamp / millisecondsPerDay);
        const seed = (dateSeed + coinSeed + dayNumber) % 100000;
        
        // Generate consistent price variation (±8% from current price)
        const randomValue = seededRandom(seed);
        const variation = (randomValue - 0.5) * 0.16; // ±8% variation
        
        // Add some trend simulation (slight downward trend for older data)
        const trendFactor = 1 - (i * 0.005); // Slight downward trend
        price = currentPrice * (1 + variation) * trendFactor;
      }
      
      prices.push({
        timestamp: new Date(timestamp).toISOString(),
        price: Math.round(price * 100) / 100, // Round to 2 decimal places
      });
    }
    
    return jsonResponse({
      coin: coinId,
      prices: prices,
      days: days,
      symbol: SUPPORTED_COINS[coinId].symbol,
      note: 'Historical data is simulated with consistent daily patterns'
    });
    
  } catch (error) {
    console.error('Error fetching history:', error);
    return errorResponse(`Failed to fetch price history: ${error.message}`);
  }
}

async function handleNews(request, env) {
  try {
    const url = new URL(request.url);
    const coinName = url.searchParams.get('coin') || 'bitcoin';
    
    // Fetch news from @https://newsapi.org/ using the Everything endpoint
    const searchQuery = `${coinName} cryptocurrency OR ${coinName} crypto`;
    const response = await fetch(
      `https://newsapi.org/v2/everything?q=${encodeURIComponent(searchQuery)}&language=en&sortBy=publishedAt&pageSize=10&apiKey=${env.NEWSAPI_KEY}`,
      {
        headers: {
          'User-Agent': 'Crypto-Mood-Dashboard/1.0 (https://hesam.me/crypto-mood-dashboard)'
        }
      }
    );
    
    if (!response.ok) {
      let errorDetails = '';
      try {
        const errorBody = await response.json();
        errorDetails = errorBody.message ? ` - ${errorBody.message}` : '';
      } catch (e) {
        // Ignore JSON parse errors
      }
      throw new Error(`@https://newsapi.org/ API error: ${response.status}${errorDetails}`);
    }
    
    const data = await response.json();
    
    if (data.status === 'error') {
      throw new Error(`@https://newsapi.org/ error: ${data.message}`);
    }
    
    if (!data.articles || !Array.isArray(data.articles)) {
      return jsonResponse({
        coin: coinName,
        headlines: [],
        total: 0,
      });
    }
    
    // Transform news data to match existing format
    const headlines = data.articles.map(article => ({
      title: article.title,
      description: article.description,
      url: article.url,
      source: article.source?.name || 'Unknown',
      published: article.publishedAt,
      author: article.author,
      urlToImage: article.urlToImage,
    }));
    
    return jsonResponse({
      coin: coinName,
      headlines: headlines,
      total: data.totalResults || headlines.length,
    });
    
  } catch (error) {
    console.error('Error fetching news:', error);
    return errorResponse(`Failed to fetch news: ${error.message}`);
  }
}

async function handleSentiment(request, env) {
  try {
    if (request.method !== 'POST') {
      return errorResponse('Method not allowed', 405);
    }
    
    const body = await request.json();
    const headlines = body.headlines || [];
    
    if (!Array.isArray(headlines) || headlines.length === 0) {
      return jsonResponse({
        score: 0,
        category: 'neutral',
        confidence: 0,
        total: 0,
      });
    }
    
    // Try Cohere AI first, with fallback to keyword analysis
    try {
      return await analyzeSentimentWithCohere(headlines, env);
    } catch (error) {
      console.log('Cohere API failed, using keyword fallback:', error.message);
      return analyzeSentimentWithKeywords(headlines);
    }
    
  } catch (error) {
    console.error('Sentiment analysis error:', error);
    return errorResponse(`Failed to analyze sentiment: ${error.message}`);
  }
}

async function analyzeSentimentWithCohere(headlines, env) {
  // Limit to 5 headlines for API limits
  const textsToAnalyze = headlines.map(h => h.title || h).slice(0, 5);
  
  console.log('Cohere API Key available:', !!env.COHERE_API_KEY);
  console.log('Texts to analyze:', textsToAnalyze);
  
  // Create prompt for sentiment analysis using Chat API
  const prompt = `Analyze the sentiment of these cryptocurrency news headlines and classify each as "positive", "negative", or "neutral":

${textsToAnalyze.map((text, i) => `${i + 1}. ${text}`).join('\n')}

Respond with ONLY a JSON array in this exact format:
[{"text": "headline 1", "sentiment": "positive"}, {"text": "headline 2", "sentiment": "negative"}, ...]

Use these criteria:
- "positive": bullish, optimistic, gains, growth, adoption, institutional investment
- "negative": bearish, crashes, bans, hacks, fears, regulatory concerns  
- "neutral": stable, mixed, updates, general news without clear sentiment`;

  // Make request to Cohere Chat API v2
  const response = await fetch('https://api.cohere.com/v2/chat', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.COHERE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'command-r',
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 1000
    }),
  });
  
  if (!response.ok) {
    // Get the actual error response
    let errorDetails = 'Unknown error';
    try {
      const errorBody = await response.text();
      errorDetails = errorBody;
      console.log('Cohere Chat API error response:', errorDetails);
    } catch (e) {
      console.log('Could not parse error response');
    }
    
    if (response.status === 429) {
      throw new Error('Rate limit exceeded - using fallback');
    }
    throw new Error(`Cohere Chat API error: ${response.status} - ${errorDetails}`);
  }
  
  const data = await response.json();
  console.log('Cohere Chat API success:', data);
  
  // Parse the response
  let sentimentResults = [];
  try {
    const messageContent = data.message?.content?.[0]?.text || '';
    console.log('Raw AI response:', messageContent);
    
    // Try to extract JSON from the response
    const jsonMatch = messageContent.match(/\[.*\]/s);
    if (jsonMatch) {
      sentimentResults = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error('No JSON array found in response');
    }
  } catch (parseError) {
    console.log('Failed to parse AI response:', parseError.message);
    throw new Error('Invalid response format from Cohere Chat API');
  }
  
  // Calculate sentiment scores
  let positiveCount = 0;
  let negativeCount = 0;
  let neutralCount = 0;
  
  sentimentResults.forEach(result => {
    const sentiment = result.sentiment?.toLowerCase();
    if (sentiment === 'positive') {
      positiveCount++;
    } else if (sentiment === 'negative') {
      negativeCount++;
    } else {
      neutralCount++;
    }
  });
  
  const analyzed = sentimentResults.length;
  const total = headlines.length;
  
  // Calculate overall sentiment score (-5 to +5 scale)
  const positiveRatio = positiveCount / analyzed;
  const negativeRatio = negativeCount / analyzed;
  const score = (positiveRatio - negativeRatio) * 5;
  
  let category = 'neutral';
  if (score > 1) {
    category = 'bullish';
  } else if (score < -1) {
    category = 'bearish';
  }
  
  // Estimate confidence based on how decisive the sentiment distribution is
  const maxRatio = Math.max(positiveRatio, negativeRatio, neutralCount / analyzed);
  const confidence = maxRatio;
  
  return jsonResponse({
    score: Math.round(score * 100) / 100,
    category,
    confidence: Math.round(confidence * 100) / 100,
    total: total,
    analyzed: analyzed,
    method: 'cohere-chat-api',
    breakdown: {
      positive: positiveCount,
      negative: negativeCount,
      neutral: neutralCount
    }
  });
}

function analyzeSentimentWithKeywords(headlines) {
  const positiveKeywords = [
    'soar', 'surge', 'rally', 'bull', 'bullish', 'gain', 'gains', 'rise', 'rising', 
    'up', 'high', 'moon', 'pump', 'breakthrough', 'adoption', 'institutional',
    'investment', 'buy', 'support', 'strong', 'growth', 'increase', 'positive',
    'optimistic', 'confidence', 'milestone', 'achievement', 'success', 'upgrade',
    'partnership', 'expansion', 'innovation', 'record', 'all-time', 'ath'
  ];
  
  const negativeKeywords = [
    'crash', 'dump', 'bear', 'bearish', 'fall', 'drop', 'down', 'low', 'dip',
    'decline', 'plunge', 'collapse', 'sell', 'selling', 'pressure', 'fear',
    'panic', 'concern', 'worry', 'risk', 'volatile', 'uncertainty', 'loss',
    'losses', 'negative', 'pessimistic', 'regulation', 'ban', 'hack', 'attack',
    'fraud', 'scam', 'bubble', 'warning', 'alert', 'crisis', 'problem'
  ];
  
  let positiveCount = 0;
  let negativeCount = 0;
  let neutralCount = 0;
  
  headlines.forEach(headline => {
    const text = (headline.title || headline).toLowerCase();
    const hasPositive = positiveKeywords.some(keyword => text.includes(keyword));
    const hasNegative = negativeKeywords.some(keyword => text.includes(keyword));
    
    if (hasPositive && !hasNegative) {
      positiveCount++;
    } else if (hasNegative && !hasPositive) {
      negativeCount++;
    } else {
      neutralCount++;
    }
  });
  
  const total = headlines.length;
  const positiveRatio = positiveCount / total;
  const negativeRatio = negativeCount / total;
  
  // Calculate sentiment score (-5 to +5 scale)
  const score = (positiveRatio - negativeRatio) * 5;
  
  let category = 'neutral';
  if (score > 1) {
    category = 'bullish';
  } else if (score < -1) {
    category = 'bearish';
  }
  
  return jsonResponse({
    score: Math.round(score * 100) / 100,
    category,
    confidence: Math.max(positiveRatio, negativeRatio, neutralCount / total),
    total: total,
    breakdown: {
      positive: positiveCount,
      negative: negativeCount,
      neutral: neutralCount,
    },
    method: 'keyword-analysis'
  });
}

// =============================================================================
// AI-POWERED TECHNICAL ANALYSIS HANDLERS
// =============================================================================

/**
 * AI Market Mood Classification
 * Uses Cohere v2/classify to analyze technical signals and determine market sentiment
 */
async function handleAIAnalysis(request, env) {
  try {
    if (request.method !== 'POST') {
      return errorResponse('Method not allowed', 405);
    }
    
    const body = await request.json();
    const { rsi, smaSignal, bbSignal, priceData, coin } = body;
    
    if (!rsi || !smaSignal || !bbSignal || !priceData) {
      return errorResponse('Missing required technical analysis data');
    }
    
    // Try Cohere AI classification first, with fallback to rule-based analysis
    try {
      return await classifyMarketMoodWithCohere(rsi, smaSignal, bbSignal, priceData, coin, env);
    } catch (error) {
      console.log('Cohere AI classification failed, using fallback:', error.message);
      return classifyMarketMoodFallback(rsi, smaSignal, bbSignal, priceData, coin);
    }
    
  } catch (error) {
    console.error('AI Analysis error:', error);
    return errorResponse(`Failed to perform AI analysis: ${error.message}`);
  }
}

/**
 * AI Pattern Explanation 
 * Uses Cohere v2/chat to provide natural language explanations of technical patterns
 */
async function handleAIExplain(request, env) {
  try {
    if (request.method !== 'POST') {
      return errorResponse('Method not allowed', 405);
    }
    
    const body = await request.json();
    const { rsi, sma, bb, signals, coin, timeframe, currentPrice, currentRSI, currentSMA, currentBBUpper, currentBBLower } = body;
    
    if (!rsi || !sma || !bb || !signals || !coin) {
      return errorResponse('Missing required data for AI explanation');
    }
    
    console.log(`🔍 Received AI explanation request with actual prices: Current=${currentPrice}, SMA=${currentSMA}, BB=[${currentBBLower}-${currentBBUpper}]`);
    
    // Try Cohere AI explanation first, with fallback
    try {
      return await explainPatternWithCohere(rsi, sma, bb, signals, coin, timeframe, env, {
        currentPrice, currentRSI, currentSMA, currentBBUpper, currentBBLower
      });
    } catch (error) {
      console.log('Cohere AI explanation failed, using fallback:', error.message);
      return explainPatternFallback(rsi, sma, bb, signals, coin, timeframe, {
        currentPrice, currentRSI, currentSMA, currentBBUpper, currentBBLower
      });
    }
    
  } catch (error) {
    console.error('AI Explanation error:', error);
    return errorResponse(`Failed to generate AI explanation: ${error.message}`);
  }
}

/**
 * Classify market mood using Cohere's v2/classify endpoint
 */
async function classifyMarketMoodWithCohere(rsi, smaSignal, bbSignal, priceData, coin, env) {
  // Prepare training examples for classification
  const examples = [
    {
      text: "RSI: 85, SMA: SELL, BB: SELL, Price trend: declining sharply",
      label: "bearish"
    },
    {
      text: "RSI: 25, SMA: BUY, BB: BUY, Price trend: rising from oversold",
      label: "bullish"
    },
    {
      text: "RSI: 45, SMA: NEUTRAL, BB: NEUTRAL, Price trend: sideways movement",
      label: "neutral"
    },
    {
      text: "RSI: 75, SMA: BUY, BB: NEUTRAL, Price trend: strong upward momentum",
      label: "bullish"
    },
    {
      text: "RSI: 30, SMA: SELL, BB: SELL, Price trend: continued downtrend",
      label: "bearish"
    },
    {
      text: "RSI: 55, SMA: BUY, BB: BUY, Price trend: breaking resistance",
      label: "bullish"
    },
    {
      text: "RSI: 68, SMA: NEUTRAL, BB: SELL, Price trend: mixed signals",
      label: "neutral"
    },
    {
      text: "RSI: 20, SMA: BUY, BB: BUY, Price trend: potential reversal",
      label: "bullish"
    }
  ];
  
  // Calculate price trend from recent data
  const recentPrices = priceData.slice(-5);
  const oldPrice = recentPrices[0]?.y || 0;
  const newPrice = recentPrices[recentPrices.length - 1]?.y || 0;
  const priceChange = ((newPrice - oldPrice) / oldPrice) * 100;
  
  let priceTrend = 'sideways movement';
  if (priceChange > 2) priceTrend = 'rising strongly';
  else if (priceChange > 0.5) priceTrend = 'rising gradually';
  else if (priceChange < -2) priceTrend = 'declining sharply';
  else if (priceChange < -0.5) priceTrend = 'declining gradually';
  
  // Create input text for classification
  const inputText = `RSI: ${rsi.toFixed(0)}, SMA: ${smaSignal}, BB: ${bbSignal}, Price trend: ${priceTrend}`;
  
  console.log('Classifying market mood for:', inputText);
  
  // Make request to Cohere Classify API v2
  const response = await fetch('https://api.cohere.com/v2/classify', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.COHERE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'command-r',
      inputs: [inputText],
      examples: examples,
      task_description: 'Classify cryptocurrency market sentiment based on technical analysis indicators. Use "bullish" for positive outlook, "bearish" for negative outlook, and "neutral" for mixed or unclear signals.'
    }),
  });
  
  if (!response.ok) {
    const errorBody = await response.text();
    console.log('Cohere Classify API error:', errorBody);
    throw new Error(`Cohere Classify API error: ${response.status}`);
  }
  
  const data = await response.json();
  console.log('Cohere Classify API success:', data);
  
  // Extract classification result
  const classification = data.classifications?.[0];
  if (!classification) {
    throw new Error('No classification result returned');
  }
  
  const prediction = classification.prediction;
  const confidence = classification.confidence || 0;
  
  // Map confidence to a more meaningful scale
  const confidencePercentage = Math.round(confidence * 100);
  
  return jsonResponse({
    mood: prediction,
    confidence: confidencePercentage,
    reasoning: `Based on RSI ${rsi.toFixed(1)}, SMA signal: ${smaSignal}, BB signal: ${bbSignal}, and price trend: ${priceTrend}`,
    method: 'cohere-classify-api',
    coin: coin,
    timestamp: new Date().toISOString()
  });
}

/**
 * Fallback market mood classification using rule-based logic
 */
function classifyMarketMoodFallback(rsi, smaSignal, bbSignal, priceData, coin) {
  let bullishScore = 0;
  let bearishScore = 0;
  
  // RSI scoring
  if (rsi < 30) bullishScore += 2; // Oversold
  else if (rsi > 70) bearishScore += 2; // Overbought
  else if (rsi >= 45 && rsi <= 55) bullishScore += 0.5; // Neutral momentum
  
  // SMA scoring
  if (smaSignal === 'BUY') bullishScore += 1.5;
  else if (smaSignal === 'SELL') bearishScore += 1.5;
  
  // Bollinger Bands scoring
  if (bbSignal === 'BUY') bullishScore += 1;
  else if (bbSignal === 'SELL') bearishScore += 1;
  
  // Calculate price trend
  if (priceData.length >= 3) {
    const recentPrices = priceData.slice(-3);
    const trend = (recentPrices[2].y - recentPrices[0].y) / recentPrices[0].y;
    if (trend > 0.01) bullishScore += 1;
    else if (trend < -0.01) bearishScore += 1;
  }
  
  // Determine mood
  let mood, confidence;
  if (bullishScore > bearishScore + 1) {
    mood = 'bullish';
    confidence = Math.min(90, 60 + (bullishScore - bearishScore) * 10);
  } else if (bearishScore > bullishScore + 1) {
    mood = 'bearish';
    confidence = Math.min(90, 60 + (bearishScore - bullishScore) * 10);
  } else {
    mood = 'neutral';
    confidence = 50 + Math.abs(bullishScore - bearishScore) * 5;
  }
  
  return jsonResponse({
    mood: mood,
    confidence: Math.round(confidence),
    reasoning: `Rule-based analysis: bullish signals ${bullishScore}, bearish signals ${bearishScore}`,
    method: 'rule-based-fallback',
    coin: coin,
    timestamp: new Date().toISOString()
  });
}

/**
 * Generate natural language explanation using Cohere's v2/chat endpoint
 */
async function explainPatternWithCohere(rsi, sma, bb, signals, coin, timeframe, env, priceContext = null) {
  // Prepare context for the AI
  const overallSignal = calculateOverallSignal(signals);
  
  // ✅ FIX: Use actual price data from frontend if available, otherwise fallback to calculation
  let currentRSI, safeSMA, safeBBUpper, safeBBLower, resistance, support;
  
  if (priceContext && priceContext.currentPrice) {
    // Use actual price data from frontend
    currentRSI = priceContext.currentRSI || 50;
    safeSMA = priceContext.currentSMA || priceContext.currentPrice;
    safeBBUpper = priceContext.currentBBUpper || priceContext.currentPrice * 1.05;
    safeBBLower = priceContext.currentBBLower || priceContext.currentPrice * 0.95;
    resistance = Math.max(safeBBUpper, safeSMA * 1.05);
    support = Math.min(safeBBLower, safeSMA * 0.95);
    
    console.log(`✅ Using actual price data from frontend: Current=${priceContext.currentPrice}, SMA=${safeSMA}, BB=[${safeBBLower}-${safeBBUpper}]`);
  } else {
    // Fallback to worker calculations (old behavior)
    currentRSI = rsi[rsi.length - 1]?.y || 50;
    const currentSMA = sma[sma.length - 1]?.y || sma[sma.length - 1] || 0;
    const bbUpper = bb.upper?.[bb.upper.length - 1]?.y || bb.upper?.[bb.upper.length - 1] || 0;
    const bbLower = bb.lower?.[bb.lower.length - 1]?.y || bb.lower?.[bb.lower.length - 1] || 0;
    
    const defaultPrices = { bitcoin: 50000, ethereum: 3000, litecoin: 100, dogecoin: 0.08 };
    const defaultPrice = defaultPrices[coin.toLowerCase()] || 50000;
    
    safeSMA = currentSMA > 0 ? currentSMA : defaultPrice;
    safeBBUpper = bbUpper > 0 ? bbUpper : safeSMA * 1.05;
    safeBBLower = bbLower > 0 ? bbLower : safeSMA * 0.95;
    resistance = Math.max(safeBBUpper, safeSMA * 1.05);
    support = Math.min(safeBBLower, safeSMA * 0.95);
    
    console.log(`⚠️ Using fallback calculations for ${coin}: SMA=${safeSMA}, BB=[${safeBBLower}-${safeBBUpper}]`);
  }
  
  const prompt = `As a professional crypto technical analyst, explain the current ${coin.toUpperCase()} chart pattern in simple terms for a beginner trader.

LIVE Current Technical Analysis (MUST use these exact values):
- Current Price: $${(priceContext?.currentPrice || safeSMA).toLocaleString()}
- RSI (14): ${currentRSI.toFixed(1)}
- SMA (20): $${safeSMA.toLocaleString()}
- Bollinger Band Upper: $${safeBBUpper.toLocaleString()}
- Bollinger Band Lower: $${safeBBLower.toLocaleString()}
- Key Resistance Level: $${resistance.toLocaleString()}
- Key Support Level: $${support.toLocaleString()}
- Overall Signal: ${overallSignal.signal} (${overallSignal.confidence}% confidence)
- Time Period: ${timeframe} days
- Individual Signals: ${signals.map(s => `${s.type}: ${s.signal} (${s.strength})`).join(', ')}

Please provide a market analysis using EXACTLY these price levels:
1. Explain what the current pattern means for ${coin.toUpperCase()} at $${(priceContext?.currentPrice || safeSMA).toLocaleString()}
2. What might happen next (scenarios with resistance at $${resistance.toLocaleString()} and support at $${support.toLocaleString()})
3. Key levels to watch: resistance $${resistance.toLocaleString()} and support $${support.toLocaleString()}
4. Simple summary for beginners

CRITICAL: You MUST use the exact price values listed above ($${resistance.toLocaleString()}, $${support.toLocaleString()}, $${(priceContext?.currentPrice || safeSMA).toLocaleString()}, etc.) - NO placeholders, NO generic numbers, NO $50,000 or $XXX examples. Use the LIVE data provided. Keep under 200 words, educational focus, no trading advice.`;

  console.log('Generating AI explanation for:', coin);
  
  // Make request to Cohere Chat API v2
  const response = await fetch('https://api.cohere.com/v2/chat', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.COHERE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'command-r',
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 300
    }),
  });
  
  if (!response.ok) {
    const errorBody = await response.text();
    console.log('Cohere Chat API error:', errorBody);
    throw new Error(`Cohere Chat API error: ${response.status}`);
  }
  
  const data = await response.json();
  console.log('Cohere Chat API success for explanation');
  
  // Extract explanation
  const explanation = data.message?.content?.[0]?.text || '';
  
  if (!explanation) {
    throw new Error('No explanation generated');
  }
  
  return jsonResponse({
    explanation: explanation.trim(),
    method: 'cohere-chat-api',
    coin: coin,
    timeframe: timeframe,
    timestamp: new Date().toISOString()
  });
}

/**
 * Fallback explanation generator
 */
function explainPatternFallback(rsi, sma, bb, signals, coin, timeframe, priceContext = null) {
  const overallSignal = calculateOverallSignal(signals);
  
  // ✅ FIX: Use actual price data from frontend if available, otherwise fallback to calculation
  let currentRSI, safeSMA, safeBBUpper, safeBBLower, resistance, support;
  
  if (priceContext && priceContext.currentPrice) {
    // Use actual price data from frontend
    currentRSI = priceContext.currentRSI || 50;
    safeSMA = priceContext.currentSMA || priceContext.currentPrice;
    safeBBUpper = priceContext.currentBBUpper || priceContext.currentPrice * 1.05;
    safeBBLower = priceContext.currentBBLower || priceContext.currentPrice * 0.95;
    resistance = Math.max(safeBBUpper, safeSMA * 1.05);
    support = Math.min(safeBBLower, safeSMA * 0.95);
    
    console.log(`✅ Fallback using actual price data: Current=${priceContext.currentPrice}, SMA=${safeSMA}, BB=[${safeBBLower}-${safeBBUpper}]`);
  } else {
    // Fallback to worker calculations (old behavior)
    currentRSI = rsi[rsi.length - 1]?.y || 50;
    const currentSMA = sma[sma.length - 1]?.y || sma[sma.length - 1] || 0;
    const bbUpper = bb.upper?.[bb.upper.length - 1]?.y || bb.upper?.[bb.upper.length - 1] || 0;
    const bbLower = bb.lower?.[bb.lower.length - 1]?.y || bb.lower?.[bb.lower.length - 1] || 0;
    
    const defaultPrices = { bitcoin: 50000, ethereum: 3000, litecoin: 100, dogecoin: 0.08 };
    const defaultPrice = defaultPrices[coin.toLowerCase()] || 50000;
    
    safeSMA = currentSMA > 0 ? currentSMA : defaultPrice;
    safeBBUpper = bbUpper > 0 ? bbUpper : safeSMA * 1.05;
    safeBBLower = bbLower > 0 ? bbLower : safeSMA * 0.95;
    resistance = Math.max(safeBBUpper, safeSMA * 1.05);
    support = Math.min(safeBBLower, safeSMA * 0.95);
    
    console.log(`⚠️ Fallback using calculations for ${coin}: SMA=${safeSMA}, BB=[${safeBBLower}-${safeBBUpper}]`);
  }
  
  const currentPriceDisplay = priceContext?.currentPrice || safeSMA;
  
  let explanation = `LIVE ${coin.toUpperCase()} Analysis (${timeframe} days) - Current Price: $${currentPriceDisplay.toLocaleString()}:\n\n`;
  
  // RSI explanation with actual price context
  if (currentRSI < 30) {
    explanation += `📉 RSI at ${currentRSI.toFixed(1)} shows oversold conditions - ${coin.toUpperCase()} at $${currentPriceDisplay.toLocaleString()} may have fallen too much and could bounce toward resistance at $${resistance.toLocaleString()}. `;
  } else if (currentRSI > 70) {
    explanation += `📈 RSI at ${currentRSI.toFixed(1)} indicates overbought territory - ${coin.toUpperCase()} at $${currentPriceDisplay.toLocaleString()} may have risen too quickly and could pull back toward support at $${support.toLocaleString()}. `;
  } else {
    explanation += `⚖️ RSI at ${currentRSI.toFixed(1)} is in normal range - ${coin.toUpperCase()} at $${currentPriceDisplay.toLocaleString()} shows no extreme pressure between support $${support.toLocaleString()} and resistance $${resistance.toLocaleString()}. `;
  }
  
  // Overall signal explanation with specific price levels
  if (overallSignal.signal === 'BUY') {
    explanation += `Technical indicators suggest ${coin.toUpperCase()} could move from current $${currentPriceDisplay.toLocaleString()} toward resistance at $${resistance.toLocaleString()}. `;
  } else if (overallSignal.signal === 'SELL') {
    explanation += `Technical indicators suggest ${coin.toUpperCase()} could decline from current $${currentPriceDisplay.toLocaleString()} toward support at $${support.toLocaleString()}. `;
  } else {
    explanation += `Technical indicators are mixed - ${coin.toUpperCase()} likely to consolidate between support $${support.toLocaleString()} and resistance $${resistance.toLocaleString()}. `;
  }
  
  // Add specific price level scenarios
  explanation += `\n\nPrice Scenarios:\n`;
  explanation += `• Bullish breakout: Above $${resistance.toLocaleString()} could target higher levels\n`;
  explanation += `• Bearish breakdown: Below $${support.toLocaleString()} could see further decline\n`;
  explanation += `• Consolidation: Between $${support.toLocaleString()}-$${resistance.toLocaleString()} for sideways movement\n`;
  explanation += `• Key moving average: $${safeSMA.toLocaleString()} (SMA 20)\n`;
  
  explanation += `\n⚠️ Current ${coin.toUpperCase()} at $${currentPriceDisplay.toLocaleString()} - Remember: Technical analysis helps identify patterns but markets can be unpredictable. Always do your own research!`;
  
  return jsonResponse({
    explanation: explanation,
    method: 'rule-based-fallback',
    coin: coin,
    timeframe: timeframe,
    timestamp: new Date().toISOString()
  });
}

// Helper function for calculating overall signal (needed for AI analysis)
function calculateOverallSignal(signals) {
  let buyCount = 0;
  let sellCount = 0;
  let totalStrength = 0;

  signals.forEach(signal => {
    const strengthValue = signal.strength === 'Strong' ? 3 : signal.strength === 'Medium' ? 2 : 1;
    totalStrength += strengthValue;

    if (signal.signal === 'BUY') buyCount += strengthValue;
    else if (signal.signal === 'SELL') sellCount += strengthValue;
  });

  const buyPercentage = (buyCount / totalStrength) * 100;
  const sellPercentage = (sellCount / totalStrength) * 100;
  const confidence = Math.max(buyPercentage, sellPercentage);

  if (buyPercentage > 60) return { signal: 'BUY', confidence: confidence.toFixed(1) };
  else if (sellPercentage > 60) return { signal: 'SELL', confidence: confidence.toFixed(1) };
  else return { signal: 'HOLD', confidence: (100 - confidence).toFixed(1) };
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: CORS_HEADERS,
      });
    }
    
    const url = new URL(request.url);
    const path = url.pathname;
    
    try {
      // Route requests
      switch (path) {
        case '/coins':
          return await handleCoins();
          
        case '/price':
          return await handlePrice(request, env);
          
        case '/history':
          return await handleHistory(request, env);
          
        case '/news':
          return await handleNews(request, env);
          
        case '/sentiment':
          return await handleSentiment(request, env);
          
        case '/ai-analysis':
          return await handleAIAnalysis(request, env);
          
        case '/ai-explain':
          return await handleAIExplain(request, env);
          
        default:
          return errorResponse('Not found', 404);
      }
      
    } catch (error) {
      console.error('Worker error:', error);
      return errorResponse('Internal server error', 500);
    }
  },
}; 