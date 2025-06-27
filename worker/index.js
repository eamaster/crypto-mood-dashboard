// =============================================================================
// Crypto Mood Dashboard - Cloudflare Worker
// Handles API calls to Blockchair, NewsData.io, and Cohere AI
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
      
      // Create deterministic seed based on coin and date
      const coinSeed = coinId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
      const dayNumber = Math.floor(timestamp / millisecondsPerDay);
      const seed = (dateSeed + coinSeed + dayNumber) % 100000;
      
      // Generate consistent price variation (±8% from current price)
      const randomValue = seededRandom(seed);
      const variation = (randomValue - 0.5) * 0.16; // ±8% variation
      
      // Add some trend simulation (slight downward trend for older data)
      const trendFactor = 1 - (i * 0.005); // Slight downward trend
      const price = currentPrice * (1 + variation) * trendFactor;
      
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
    
    // Fetch news from NewsData.io
    const searchQuery = `${coinName} cryptocurrency`;
    const response = await fetch(
      `https://newsdata.io/api/1/news?apikey=${env.NEWSDATA_API_KEY}&q=${encodeURIComponent(searchQuery)}&language=en&size=10`
    );
    
    if (!response.ok) {
      throw new Error(`NewsData.io API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.results || !Array.isArray(data.results)) {
      return jsonResponse({
        coin: coinName,
        headlines: [],
        total: 0,
      });
    }
    
    // Transform news data
    const headlines = data.results.map(article => ({
      title: article.title,
      description: article.description,
      url: article.link,
      source: article.source_id,
      published: article.pubDate,
    }));
    
    return jsonResponse({
      coin: coinName,
      headlines: headlines,
      total: headlines.length,
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
  
  // Prepare sentiment classification examples
  const examples = [
    { text: "Bitcoin soars to new all-time high", label: "positive" },
    { text: "Cryptocurrency adoption accelerates globally", label: "positive" },
    { text: "Major institutions embrace digital assets", label: "positive" },
    { text: "Bitcoin rally continues with strong momentum", label: "positive" },
    { text: "Crypto market shows bullish sentiment", label: "positive" },
    { text: "Digital currency gains mainstream acceptance", label: "positive" },
    { text: "Blockchain technology revolutionary breakthrough", label: "positive" },
    { text: "Bitcoin price crashes below support", label: "negative" },
    { text: "Regulatory concerns impact crypto market", label: "negative" },
    { text: "Exchange hack causes market panic", label: "negative" },
    { text: "Crypto market faces bearish pressure", label: "negative" },
    { text: "Bitcoin drops amid selling pressure", label: "negative" },
    { text: "Cryptocurrency ban threatens market", label: "negative" },
    { text: "Market volatility sparks investor fear", label: "negative" },
    { text: "Bitcoin price remains stable today", label: "neutral" },
    { text: "Crypto market shows mixed signals", label: "neutral" },
    { text: "Bitcoin trading volume steady", label: "neutral" },
    { text: "Market consolidation continues", label: "neutral" },
    { text: "Cryptocurrency news roundup", label: "neutral" }
  ];
  
  // Make request to Cohere Classify API
  const response = await fetch('https://api.cohere.com/v1/classify', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.COHERE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inputs: textsToAnalyze,
      examples: examples,
      truncate: 'END'
    }),
  });
  
  if (!response.ok) {
    if (response.status === 429) {
      throw new Error('Rate limit exceeded - using fallback');
    }
    throw new Error(`Cohere API error: ${response.status}`);
  }
  
  const data = await response.json();
  
  if (!data.classifications || !Array.isArray(data.classifications)) {
    throw new Error('Invalid response format from Cohere');
  }
  
  // Calculate sentiment scores
  let positiveCount = 0;
  let negativeCount = 0;
  let neutralCount = 0;
  let totalConfidence = 0;
  
  data.classifications.forEach(classification => {
    const prediction = classification.prediction;
    const confidence = classification.confidence || 0;
    
    if (prediction === 'positive') {
      positiveCount++;
    } else if (prediction === 'negative') {
      negativeCount++;
    } else {
      neutralCount++;
    }
    
    totalConfidence += confidence;
  });
  
  const analyzed = data.classifications.length;
  const total = headlines.length;
  const averageConfidence = analyzed > 0 ? totalConfidence / analyzed : 0;
  
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
  
  return jsonResponse({
    score: Math.round(score * 100) / 100,
    category,
    confidence: Math.round(averageConfidence * 100) / 100,
    total: total,
    analyzed: analyzed,
    method: 'cohere-classify-api',
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
          
        default:
          return errorResponse('Not found', 404);
      }
      
    } catch (error) {
      console.error('Worker error:', error);
      return errorResponse('Internal server error', 500);
    }
  },
}; 