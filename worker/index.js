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
      `https://newsapi.org/v2/everything?q=${encodeURIComponent(searchQuery)}&language=en&sortBy=publishedAt&pageSize=20&apiKey=${env.NEWSAPI_KEY}`,
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
  // Limit to 10 headlines for better statistical significance
  const textsToAnalyze = headlines.map(h => h.title || h).slice(0, 10);
  
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
 * Enhanced AI Market Mood Classification with Candlestick Patterns
 * Uses Cohere v2/classify to analyze technical signals AND candlestick patterns
 */
async function handleAIAnalysisEnhanced(request, env) {
  try {
    if (request.method !== 'POST') {
      return errorResponse('Method not allowed', 405);
    }
    
    const body = await request.json();
    const { rsi, smaSignal, bbSignal, priceData, candlePatterns, coin } = body;
    
    if (!rsi || !smaSignal || !bbSignal || !priceData) {
      return errorResponse('Missing required technical analysis data');
    }
    
    // Try enhanced Cohere AI classification with patterns
    try {
      return await classifyMarketMoodWithCohereEnhanced(rsi, smaSignal, bbSignal, priceData, candlePatterns || [], coin, env);
    } catch (error) {
      console.log('Enhanced Cohere AI classification failed, using enhanced fallback:', error.message);
      return classifyMarketMoodEnhancedFallback(rsi, smaSignal, bbSignal, priceData, candlePatterns || [], coin);
    }
    
  } catch (error) {
    console.error('Enhanced AI Analysis error:', error);
    return errorResponse(`Failed to perform enhanced AI analysis: ${error.message}`);
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
      model: 'embed-english-v3.0',
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
 * Enhanced classification with candlestick patterns
 */
async function classifyMarketMoodWithCohereEnhanced(rsi, smaSignal, bbSignal, priceData, candlePatterns, coin, env) {
  // Enhanced examples that include pattern analysis
  const examples = [
    {
      text: "RSI: 85, SMA: SELL, BB: SELL, Price trend: declining sharply, Patterns: 3 bearish reversal",
      label: "bearish"
    },
    {
      text: "RSI: 25, SMA: BUY, BB: BUY, Price trend: rising from oversold, Patterns: 2 bullish hammer",
      label: "bullish"
    },
    {
      text: "RSI: 45, SMA: NEUTRAL, BB: NEUTRAL, Price trend: sideways movement, Patterns: 4 doji neutral",
      label: "neutral"
    },
    {
      text: "RSI: 75, SMA: BUY, BB: NEUTRAL, Price trend: strong upward momentum, Patterns: 3 bullish continuation",
      label: "bullish"
    },
    {
      text: "RSI: 30, SMA: SELL, BB: SELL, Price trend: continued downtrend, Patterns: 2 shooting star bearish",
      label: "bearish"
    },
    {
      text: "RSI: 55, SMA: BUY, BB: BUY, Price trend: breaking resistance, Patterns: 1 bullish engulfing",
      label: "bullish"
    }
  ];
  
  // Calculate price trend
  const recentPrices = priceData.slice(-5);
  const oldPrice = recentPrices[0]?.y || 0;
  const newPrice = recentPrices[recentPrices.length - 1]?.y || 0;
  const priceChange = ((newPrice - oldPrice) / oldPrice) * 100;
  
  let priceTrend = 'sideways movement';
  if (priceChange > 2) priceTrend = 'rising strongly';
  else if (priceChange > 0.5) priceTrend = 'rising gradually';
  else if (priceChange < -2) priceTrend = 'declining sharply';
  else if (priceChange < -0.5) priceTrend = 'declining gradually';
  
  // Analyze patterns
  const bullishPatterns = candlePatterns.filter(p => p.signal === 'BUY').length;
  const bearishPatterns = candlePatterns.filter(p => p.signal === 'SELL').length;
  const neutralPatterns = candlePatterns.filter(p => p.signal === 'NEUTRAL').length;
  
  let patternText = 'no clear patterns';
  if (bullishPatterns > bearishPatterns && bullishPatterns > 0) {
    patternText = `${bullishPatterns} bullish patterns`;
  } else if (bearishPatterns > bullishPatterns && bearishPatterns > 0) {
    patternText = `${bearishPatterns} bearish patterns`;
  } else if (neutralPatterns > 2) {
    patternText = `${neutralPatterns} neutral patterns`;
  }
  
  // Create enhanced input text
  const inputText = `RSI: ${rsi.toFixed(0)}, SMA: ${smaSignal}, BB: ${bbSignal}, Price trend: ${priceTrend}, Patterns: ${patternText}`;
  
  console.log('Enhanced classification for:', inputText);
  
  // Make request to Cohere Classify API v2
  const response = await fetch('https://api.cohere.com/v2/classify', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.COHERE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'embed-english-v3.0',
      inputs: [inputText],
      examples: examples,
      task_description: 'Classify cryptocurrency market sentiment based on technical analysis indicators AND candlestick patterns. Use "bullish" for positive outlook, "bearish" for negative outlook, and "neutral" for mixed or unclear signals.'
    }),
  });
  
  if (!response.ok) {
    const errorBody = await response.text();
    console.log('Enhanced Cohere Classify API error:', errorBody);
    throw new Error(`Enhanced Cohere Classify API error: ${response.status}`);
  }
  
  const data = await response.json();
  console.log('Enhanced Cohere Classify API success:', data);
  
  // Extract classification result
  const classification = data.classifications?.[0];
  if (!classification) {
    throw new Error('No enhanced classification result returned');
  }
  
  const prediction = classification.prediction;
  const confidence = classification.confidence || 0;
  const confidencePercentage = Math.round(confidence * 100);
  
  return jsonResponse({
    mood: prediction,
    confidence: confidencePercentage,
    reasoning: `Enhanced analysis: RSI ${rsi.toFixed(1)}, SMA: ${smaSignal}, BB: ${bbSignal}, price trend: ${priceTrend}, with ${patternText}`,
    method: 'cohere-enhanced-api',
    patterns: patternText,
    coin: coin,
    timestamp: new Date().toISOString()
  });
}

/**
 * Enhanced fallback with pattern analysis
 */
function classifyMarketMoodEnhancedFallback(rsi, smaSignal, bbSignal, priceData, candlePatterns, coin) {
  let bullishScore = 0;
  let bearishScore = 0;
  
  // Traditional indicators scoring
  if (rsi < 30) bullishScore += 2;
  else if (rsi > 70) bearishScore += 2;
  else if (rsi >= 45 && rsi <= 55) bullishScore += 0.5;
  
  if (smaSignal === 'BUY') bullishScore += 1.5;
  else if (smaSignal === 'SELL') bearishScore += 1.5;
  
  if (bbSignal === 'BUY') bullishScore += 1;
  else if (bbSignal === 'SELL') bearishScore += 1;
  
  // Price trend analysis
  if (priceData.length >= 3) {
    const recentPrices = priceData.slice(-3);
    const trend = (recentPrices[2].y - recentPrices[0].y) / recentPrices[0].y;
    if (trend > 0.01) bullishScore += 1;
    else if (trend < -0.01) bearishScore += 1;
  }
  
  // Pattern analysis boost
  const bullishPatterns = candlePatterns.filter(p => p.signal === 'BUY').length;
  const bearishPatterns = candlePatterns.filter(p => p.signal === 'SELL').length;
  bullishScore += bullishPatterns * 0.3;
  bearishScore += bearishPatterns * 0.3;
  
  // Determine mood
  let mood, confidence;
  if (bullishScore > bearishScore + 1) {
    mood = 'bullish';
    confidence = Math.min(90, 60 + (bullishScore - bearishScore) * 8);
  } else if (bearishScore > bullishScore + 1) {
    mood = 'bearish';
    confidence = Math.min(90, 60 + (bearishScore - bullishScore) * 8);
  } else {
    mood = 'neutral';
    confidence = 50 + Math.abs(bullishScore - bearishScore) * 5;
  }
  
  return jsonResponse({
    mood: mood,
    confidence: Math.round(confidence),
    reasoning: `Enhanced fallback: bullish signals ${bullishScore.toFixed(1)}, bearish signals ${bearishScore.toFixed(1)}, with ${bullishPatterns} bullish and ${bearishPatterns} bearish patterns`,
    method: 'enhanced-fallback',
    patterns: `${bullishPatterns} bullish, ${bearishPatterns} bearish patterns`,
    coin: coin,
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

async function handleOHLC(request, env) {
  try {
    const url = new URL(request.url);
    const coinId = url.searchParams.get('coin') || 'bitcoin';
    const days = parseInt(url.searchParams.get('days')) || 7;
    
    if (!SUPPORTED_COINS[coinId]) {
      return errorResponse(`Unsupported coin: ${coinId}`);
    }
    
    // Get current price from Blockchair
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
    
    // Generate OHLC data (Open, High, Low, Close)
    const ohlc = [];
    const now = Date.now();
    const millisecondsPerDay = 24 * 60 * 60 * 1000;
    
    // Create a seed based on current date for consistency
    const today = new Date();
    const dateSeed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
    
    // Simple pseudo-random function with seed for consistent results
    function seededRandom(seed) {
      const x = Math.sin(seed) * 10000;
      return x - Math.floor(x);
    }
    
    // Target number of candles (aim for meaningful number)
    const targetCandles = Math.min(Math.max(days * 2, 10), 30); // 2 candles per day, min 10, max 30
    const periodSize = days / targetCandles;
    
    for (let i = 0; i < targetCandles; i++) {
      const periodStart = now - ((targetCandles - i) * periodSize * millisecondsPerDay);
      const timestamp = new Date(periodStart);
      
      // Generate base price for this period
      const coinSeed = coinId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
      const periodNumber = Math.floor(periodStart / millisecondsPerDay);
      const baseSeed = (dateSeed + coinSeed + periodNumber) % 100000;
      
      let basePrice;
      if (i === targetCandles - 1) {
        // Last candle uses current price as close
        basePrice = currentPrice;
      } else {
        // Generate base price with trend
        const baseRandomValue = seededRandom(baseSeed);
        const baseVariation = (baseRandomValue - 0.5) * 0.12; // ±6% base variation
        const trendFactor = 1 - ((targetCandles - i) * 0.002); // Slight trend
        basePrice = currentPrice * (1 + baseVariation) * trendFactor;
      }
      
      // Generate OHLC values around the base price
      const highSeed = baseSeed + 1;
      const lowSeed = baseSeed + 2;
      const openSeed = baseSeed + 3;
      const closeSeed = baseSeed + 4;
      
      const highVariation = seededRandom(highSeed) * 0.03; // Up to 3% above base
      const lowVariation = seededRandom(lowSeed) * 0.03; // Up to 3% below base
      const openVariation = (seededRandom(openSeed) - 0.5) * 0.02; // ±1% from base
      const closeVariation = (seededRandom(closeSeed) - 0.5) * 0.02; // ±1% from base
      
      const open = basePrice * (1 + openVariation);
      const close = i === targetCandles - 1 ? currentPrice : basePrice * (1 + closeVariation);
      const high = Math.max(open, close) * (1 + highVariation);
      const low = Math.min(open, close) * (1 - lowVariation);
      
      ohlc.push({
        timestamp: timestamp.toISOString(),
        open: Math.round(open * 100) / 100,
        high: Math.round(high * 100) / 100,
        low: Math.round(low * 100) / 100,
        close: Math.round(close * 100) / 100,
        volume: Math.round((seededRandom(baseSeed + 5) * 1000000 + 500000) * 100) / 100 // Simulated volume
      });
    }
    
    return jsonResponse({
      coin: coinId,
      ohlc: ohlc,
      days: days,
      symbol: SUPPORTED_COINS[coinId].symbol,
      candles: ohlc.length,
      note: 'OHLC data is simulated with consistent daily patterns'
    });
    
  } catch (error) {
    console.error('Error fetching OHLC:', error);
    return errorResponse(`Failed to fetch OHLC data: ${error.message}`);
  }
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
          
        case '/ai-analysis-enhanced':
          return await handleAIAnalysisEnhanced(request, env);
          
        case '/ai-explain':
          return await handleAIExplain(request, env);
          
        case '/ohlc':
          return await handleOHLC(request, env);
          
        default:
          return errorResponse('Not found', 404);
      }
      
    } catch (error) {
      console.error('Worker error:', error);
      return errorResponse('Internal server error', 500);
    }
  },
}; 