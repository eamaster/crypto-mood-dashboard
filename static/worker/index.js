// =============================================================================
// Crypto Mood Dashboard - Cloudflare Worker
// Handles API calls to CoinGecko, NewsAPI.org, and Cohere AI
// =============================================================================

// CORS headers for frontend requests
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Cache-Control, Pragma',
  'Access-Control-Expose-Headers': 'X-Cache-Status, X-Cache-Source, X-DO-Age, X-Latency-ms, X-Client-Cache',
};

// Response helper
function jsonResponse(data, status = 200, extraHeaders = {}) {
  // Default cache headers (can be overridden by extraHeaders)
  const defaultCacheHeaders = {
    'Cache-Control': 'no-store, max-age=0, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  };
  
  // Only add Surrogate-Control if not using s-maxage in extraHeaders
  if (!extraHeaders['Cache-Control'] || !extraHeaders['Cache-Control'].includes('s-maxage')) {
    defaultCacheHeaders['Surrogate-Control'] = 'no-store';
  }
  
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
      ...defaultCacheHeaders,
      ...extraHeaders // extraHeaders override defaults
    },
  });
}

// Error response helper
function errorResponse(message, status = 400) {
  return jsonResponse({ error: message }, status);
}

// CoinGecko API configuration
const COINGECKO_API_BASE = 'https://api.coingecko.com/api/v3';

// Coalesce inflight upstream calls per URL (avoid duplicate fetches)
const INFLIGHT_UPSTREAM = {}; // key: url -> Promise<{ ok, status, text, json? }>

// Convert seconds-or-date Retry-After to ms
function parseRetryAfterHeader(h) {
  if (!h) return undefined;
  const n = Number(h);
  if (!Number.isNaN(n)) return n * 1000;
  const when = Date.parse(h);
  if (!Number.isNaN(when)) return Math.max(0, when - Date.now());
  return undefined;
}

function jitter(ms) {
  return Math.floor(ms + Math.random() * (ms / 2));
}

// Write a per-coingecko backoff timestamp into KV
async function setBackoff(kv, coingeckoId, untilMs) {
  try {
    await kv.put(`backoff_${coingeckoId}`, String(untilMs));
  } catch (e) {
    console.warn('Failed to set backoff KV:', e.message);
  }
}

async function getBackoff(kv, coingeckoId) {
  try {
    const raw = await kv.get(`backoff_${coingeckoId}`);
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isNaN(n) ? 0 : n;
  } catch (e) {
    console.warn('Failed to get backoff KV:', e.message);
    return 0;
  }
}

// Supported cryptocurrencies mapping (CoinGecko IDs)
const SUPPORTED_COINS = {
  'bitcoin': { id: 'bitcoin', name: 'Bitcoin', symbol: 'BTC', coingecko_id: 'bitcoin' },
  'ethereum': { id: 'ethereum', name: 'Ethereum', symbol: 'ETH', coingecko_id: 'ethereum' },
  'litecoin': { id: 'litecoin', name: 'Litecoin', symbol: 'LTC', coingecko_id: 'litecoin' },
  'bitcoin-cash': { id: 'bitcoin-cash', name: 'Bitcoin Cash', symbol: 'BCH', coingecko_id: 'bitcoin-cash' },
  'cardano': { id: 'cardano', name: 'Cardano', symbol: 'ADA', coingecko_id: 'cardano' },
  'ripple': { id: 'ripple', name: 'Ripple', symbol: 'XRP', coingecko_id: 'ripple' },
  'dogecoin': { id: 'dogecoin', name: 'Dogecoin', symbol: 'DOGE', coingecko_id: 'dogecoin' },
  'polkadot': { id: 'polkadot', name: 'Polkadot', symbol: 'DOT', coingecko_id: 'polkadot' },
  'chainlink': { id: 'chainlink', name: 'Chainlink', symbol: 'LINK', coingecko_id: 'chainlink' },
  'stellar': { id: 'stellar', name: 'Stellar', symbol: 'XLM', coingecko_id: 'stellar' },
  'monero': { id: 'monero', name: 'Monero', symbol: 'XMR', coingecko_id: 'monero' },
  'tezos': { id: 'tezos', name: 'Tezos', symbol: 'XTZ', coingecko_id: 'tezos' },
  'eos': { id: 'eos', name: 'EOS', symbol: 'EOS', coingecko_id: 'eos' },
  'zcash': { id: 'zcash', name: 'Zcash', symbol: 'ZEC', coingecko_id: 'zcash' },
  'dash': { id: 'dash', name: 'Dash', symbol: 'DASH', coingecko_id: 'dash' },
  'solana': { id: 'solana', name: 'Solana', symbol: 'SOL', coingecko_id: 'solana' },
};

// rateLimitedFetch: coalescing + retries + per-coingecko backoff
async function rateLimitedFetch(url, options = {}, env, coingeckoId) {
  // Coalesce: if there is already an inflight fetch for this url, await it
  if (INFLIGHT_UPSTREAM[url]) {
    try {
      console.log(`[rateLimitedFetch] Coalescing request for ${url}`);
      return await INFLIGHT_UPSTREAM[url];
    } catch (e) {
      // if the shared fetch failed, fall through to attempt a new one
      console.warn(`[rateLimitedFetch] Coalesced request failed, attempting new fetch`);
    }
  }

  // Create the promise and store it
  const p = (async () => {
    const maxAttempts = 5;
    let attempt = 0;

    // If K/V says we must backoff, do not call upstream
    const now = Date.now();
    const backoffUntil = coingeckoId ? await getBackoff(env.RATE_LIMIT_KV, coingeckoId) : 0;
    if (backoffUntil && backoffUntil > now) {
      const waitMs = backoffUntil - now;
      console.warn(`[rateLimitedFetch] Backoff in effect for ${coingeckoId}, ${Math.ceil(waitMs/1000)}s left`);
      const err = new Error('backoff-in-effect');
      err.code = 'backoff';
      err.until = backoffUntil;
      throw err;
    }

    while (attempt < maxAttempts) {
      attempt++;
      const attemptStart = Date.now();
      try {
        console.log(`[rateLimitedFetch] Attempt ${attempt}/${maxAttempts} for ${url}`);
        // Add POP cache hints for Cloudflare edge to cache 2xx responses for 60s
        const fetchOptions = {
          method: 'GET',
          headers: { 'Accept': 'application/json', ...(options.headers || {}) },
          cf: { cacheTtlByStatus: { "200-299": 60 }, cacheEverything: true },
          ...options
        };
        const resp = await fetch(url, fetchOptions);

        // If success, return parsed Response-like object
        if (resp.status >= 200 && resp.status < 300) {
          const text = await resp.text();
          let json = null;
          try { json = JSON.parse(text); } catch (e) { /* not json */ }
          console.log(`[rateLimitedFetch] Success on attempt ${attempt}, latency=${Date.now() - attemptStart}ms`);
          return { ok: true, status: resp.status, text, json, latency: Date.now() - attemptStart };
        }

        // Handle Retry/429/5xx
        if (resp.status === 429) {
          const ra = parseRetryAfterHeader(resp.headers.get('retry-after'));
          const baseMs = 1000 * Math.pow(2, attempt);
          const backoffMs = ra ?? jitter(Math.min(16000, baseMs));
          const until = Date.now() + backoffMs;
          if (coingeckoId && env.RATE_LIMIT_KV) {
            await setBackoff(env.RATE_LIMIT_KV, coingeckoId, until);
            console.warn(`[rateLimitedFetch] 429 received. Setting KV backoff for ${coingeckoId} until ${new Date(until).toISOString()} (${Math.ceil(backoffMs/1000)}s)`);
          }
          if (attempt < maxAttempts) {
            console.log(`[rateLimitedFetch] Waiting ${Math.ceil(backoffMs/1000)}s before retry...`);
            await new Promise(r => setTimeout(r, backoffMs));
          }
          continue;
        }

        if (resp.status >= 500 && resp.status < 600) {
          const backoffMs = jitter(Math.min(8000, 500 * Math.pow(2, attempt)));
          console.warn(`[rateLimitedFetch] 5xx error (${resp.status}), backing off ${Math.ceil(backoffMs/1000)}s`);
          if (attempt < maxAttempts) {
            await new Promise(r => setTimeout(r, backoffMs));
          }
          continue;
        }

        // Non-retryable 4xx other than 429 -> return as-is
        const text = await resp.text();
        let json = null;
        try { json = JSON.parse(text); } catch (e) {}
        console.warn(`[rateLimitedFetch] Non-retryable error ${resp.status}`);
        return { ok: false, status: resp.status, text, json, latency: Date.now() - attemptStart };
      } catch (err) {
        // network or abort — backoff and retry
        console.warn(`[rateLimitedFetch] Network error on attempt ${attempt}: ${err.message}`);
        if (attempt < maxAttempts) {
          const backoffMs = jitter(Math.min(4000, 500 * Math.pow(2, attempt)));
          await new Promise(r => setTimeout(r, backoffMs));
        }
        continue;
      }
    }

    // exhausted retries
    console.error(`[rateLimitedFetch] Exhausted ${maxAttempts} retries for ${url}`);
    const err = new Error('exhausted-retries');
    err.code = 'retries_exhausted';
    throw err;
  })();

  INFLIGHT_UPSTREAM[url] = p;
  try {
    const res = await p;
    return res;
  } finally {
    delete INFLIGHT_UPSTREAM[url];
  }
}

// Data validation helpers
function validatePriceData(data) {
  if (!data || typeof data !== 'object') return false;
  if (typeof data.usd !== 'number' || data.usd <= 0) return false;
  // usd_24h_change can be null or undefined, we allow that
  if (data.usd_24h_change !== null && data.usd_24h_change !== undefined && typeof data.usd_24h_change !== 'number') return false;
  // Relaxed validation: allow any positive price
  return true;
}

function validateHistoryData(data) {
  if (!data || !data.prices || !Array.isArray(data.prices)) return false;
  if (data.prices.length === 0) return false;
  
  // Check if all price points are valid
  return data.prices.every(point => 
    Array.isArray(point) && 
    point.length === 2 && 
    typeof point[0] === 'number' && 
    typeof point[1] === 'number' && 
    point[1] > 0
  );
}

function validateNewsData(data) {
  if (!data || !data.articles || !Array.isArray(data.articles)) return false;
  return data.articles.every(article => 
    article && 
    typeof article === 'object' && 
    typeof article.title === 'string' && 
    article.title.length > 0
  );
}

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
  const start = Date.now();
  try {
    const url = new URL(request.url);
    const coinId = url.searchParams.get('coin') || 'bitcoin';
    
    if (!SUPPORTED_COINS[coinId]) {
      return errorResponse(`Unsupported coin: ${coinId}`);
    }
    
    const coingeckoId = SUPPORTED_COINS[coinId].coingecko_id;
    const apiUrl = `${COINGECKO_API_BASE}/simple/price?ids=${coingeckoId}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`;
    
    console.log(`[Price] Fetching ${coinId} from CoinGecko...`);
    
    try {
      // Fetch current price from CoinGecko using rateLimitedFetch
      const raw = await rateLimitedFetch(apiUrl, {}, env, coingeckoId);
      
      if (!raw || !raw.ok) {
        if (!raw) throw new Error('Empty upstream result');
        const respText = raw.text || JSON.stringify(raw.json || {});
        console.error(`[Price] CoinGecko HTTP error ${raw.status}:`, respText);
        throw new Error(`CoinGecko API error: ${raw.status} - ${respText}`);
      }
      
      const data = raw.json ?? (raw.text ? JSON.parse(raw.text) : null);
      
      if (!data[coingeckoId]) {
        console.error(`[Price] CoinGecko missing coin data for ${coingeckoId}. Full response:`, raw.text || JSON.stringify(data));
        throw new Error(`Invalid CoinGecko response: missing ${coingeckoId} in ${raw.text || JSON.stringify(data)}`);
      }
      
      const coinData = data[coingeckoId];
      
      // Validate price data
      if (!validatePriceData(coinData)) {
        console.error(`[Price] Invalid price data for ${coingeckoId}:`, JSON.stringify(coinData));
        throw new Error(`Invalid price data: ${JSON.stringify(coinData)}`);
      }
      
      const headers = {
        'Cache-Control': 's-maxage=60, max-age=0, must-revalidate',
        'X-Cache-Status': 'miss',
        'X-Cache-Source': 'api',
        'X-Latency-ms': String(Date.now() - start)
      };
      
      console.log(`✅ [Price] Got ${coinId} price: $${coinData.usd}, latency=${Date.now()-start}ms`);
      
      return jsonResponse({
        coin: coinId,
        price: coinData.usd,
        change24h: coinData.usd_24h_change || 0,
        market_cap: coinData.usd_market_cap || null,
        volume_24h: coinData.usd_24h_vol || null,
        symbol: SUPPORTED_COINS[coinId].symbol,
        timestamp: new Date().toISOString(),
        source: 'coingecko'
      }, 200, headers);
    } catch (fetchError) {
      // If upstream fails, this is where we would serve stale-if-error
      // For now, return the error
      throw fetchError;
    }
    
  } catch (error) {
    console.error('❌ [Price] Error:', error);
    const status = (error.message && error.message.includes('CoinGecko')) ? 502 : 500;
    return jsonResponse({ 
      error: 'Failed to fetch price data', 
      details: error.message || 'unknown' 
    }, status, { 'X-Client-Cache': 'no-store', 'X-Latency-ms': String(Date.now() - start) });
  }
}

async function handleHistory(request, env) {
  const start = Date.now();
  try {
    const url = new URL(request.url);
    const coinId = url.searchParams.get('coin') || 'bitcoin';
    const days = Math.min(parseInt(url.searchParams.get('days')) || 7, 30); // Max 30 days
    
    if (!SUPPORTED_COINS[coinId]) {
      return errorResponse(`Unsupported coin: ${coinId}`);
    }
    
    const coingeckoId = SUPPORTED_COINS[coinId].coingecko_id;
    const apiUrl = `${COINGECKO_API_BASE}/coins/${coingeckoId}/market_chart?vs_currency=usd&days=${days}&interval=daily`;
    
    console.log(`[History] Fetching ${coinId} history (${days} days) from CoinGecko...`);
    
    try {
      // Fetch historical price data from CoinGecko using rateLimitedFetch
      const raw = await rateLimitedFetch(apiUrl, {}, env, coingeckoId);
      
      if (!raw || !raw.ok) {
        if (!raw) throw new Error('Empty upstream result');
        const respText = raw.text || JSON.stringify(raw.json || {});
        console.error(`[History] CoinGecko HTTP error ${raw.status}:`, respText);
        throw new Error(`CoinGecko API error: ${raw.status} - ${respText}`);
      }
      
      const data = raw.json ?? (raw.text ? JSON.parse(raw.text) : null);
      
      // Validate historical data
      if (!validateHistoryData(data)) {
        console.error(`[History] Invalid history data for ${coingeckoId}:`, raw.text ? raw.text.substring(0, 500) : JSON.stringify(data).substring(0, 500));
        throw new Error(`Invalid history data: ${(raw.text || JSON.stringify(data)).substring(0, 200)}`);
      }
      
      // Transform data to expected format
      const prices = data.prices.map(([timestamp, price]) => ({
          timestamp: new Date(timestamp).toISOString(),
          price: Math.round(price * 100) / 100, // Round to 2 decimal places
      }));
      
      const lastPrice = prices.length > 0 ? prices[prices.length - 1] : null;
      const dataTs = lastPrice?.timestamp ? new Date(lastPrice.timestamp).getTime() : null;
      const xdoage = dataTs ? String(Math.floor((Date.now() - dataTs) / 1000)) : '';
      
      const headers = {
        'Cache-Control': 's-maxage=60, max-age=0, must-revalidate',
        'X-Cache-Status': 'miss',
        'X-Cache-Source': 'api',
        'X-DO-Age': xdoage,
        'X-Latency-ms': String(Date.now() - start)
      };
      
      console.log(`✅ [History] Got ${coinId} history (${prices.length} points), latency=${Date.now()-start}ms`);
      
      return jsonResponse({
        coin: coinId,
        prices: prices,
        days: days,
        symbol: SUPPORTED_COINS[coinId].symbol,
        source: 'coingecko',
        note: 'Real market data from CoinGecko'
      }, 200, headers);
    } catch (fetchError) {
      // If upstream fails, this is where we would serve stale-if-error
      throw fetchError;
    }
    
  } catch (error) {
    console.error('❌ [History] Error:', error);
    const status = (error.message && error.message.includes('CoinGecko')) ? 502 : 500;
    return jsonResponse({ 
      error: 'Failed to fetch price history', 
      details: error.message || 'unknown' 
    }, status, { 'X-Client-Cache': 'no-store', 'X-Latency-ms': String(Date.now() - start) });
  }
}

async function handleNews(request, env) {
  try {
    const url = new URL(request.url);
    const coinName = url.searchParams.get('coin') || 'bitcoin';
    
    // Validate API key
    if (!env.NEWSAPI_KEY) {
      throw new Error('NewsAPI key not configured');
    }
    
    // Create more specific search queries for better results
    const coinInfo = SUPPORTED_COINS[coinName];
    const searchTerms = [
      coinInfo ? coinInfo.name : coinName,
      coinInfo ? coinInfo.symbol : coinName.toUpperCase(),
      'cryptocurrency',
      'crypto'
    ];
    
    const searchQuery = searchTerms.join(' OR ');
    
    // Fetch news from NewsAPI.org with improved parameters
    const response = await fetch(
      `https://newsapi.org/v2/everything?q=${encodeURIComponent(searchQuery)}&language=en&sortBy=publishedAt&pageSize=20&from=${getDateDaysAgo(1)}&apiKey=${env.NEWSAPI_KEY}`,
      {
        headers: {
          'User-Agent': 'Crypto-Mood-Dashboard/1.0',
          'Accept': 'application/json'
        }
      }
    );
    
    if (!response.ok) {
      let errorDetails = '';
      try {
        const errorBody = await response.json();
        errorDetails = errorBody.message ? ` - ${errorBody.message}` : '';
      } catch (e) {
        errorDetails = ` - HTTP ${response.status}`;
      }
      throw new Error(`NewsAPI error: ${response.status}${errorDetails}`);
    }
    
    const data = await response.json();
    
    if (data.status === 'error') {
      throw new Error(`NewsAPI error: ${data.message}`);
    }
    
    // Validate news data
    if (!validateNewsData(data)) {
      console.warn('Invalid news data structure received');
      return jsonResponse({
        coin: coinName,
        headlines: [],
        total: 0,
        error: 'Invalid news data format'
      });
    }
    
    // Filter and clean news data
    const headlines = data.articles
      .filter(article => 
        article.title && 
        article.title.length > 10 && 
        !article.title.includes('[Removed]') &&
        !article.title.toLowerCase().includes('advertisement')
      )
      .map(article => ({
        title: article.title.trim(),
        description: article.description ? article.description.trim() : '',
      url: article.url,
      source: article.source?.name || 'Unknown',
      published: article.publishedAt,
        author: article.author || null,
        urlToImage: article.urlToImage || null,
      }))
      .slice(0, 15); // Limit to 15 best headlines
    
    return jsonResponse({
      coin: coinName,
      headlines: headlines,
      total: data.totalResults || headlines.length,
      source: 'newsapi',
      query: searchQuery
    });
    
  } catch (error) {
    console.error('Error fetching news:', error);
    return errorResponse(`Failed to fetch news: ${error.message}`);
  }
}

// Helper function to get date N days ago
function getDateDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split('T')[0];
}

async function handleSentiment(request, env) {
  try {
    if (request.method !== 'POST') {
      return errorResponse('Method not allowed', 405);
    }
    
    const body = await request.json();
    const headlines = body.headlines || [];
    
    // Validate input
    if (!Array.isArray(headlines) || headlines.length === 0) {
      return jsonResponse({
        score: 0,
        category: 'neutral',
        confidence: 0,
        total: 0,
        method: 'no-data',
        note: 'No headlines provided for analysis'
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
  // Validate Cohere API key
  if (!env.COHERE_API_KEY) {
    throw new Error('Cohere API key not configured');
  }
  
  // Limit to 10 headlines for better processing
  const textsToAnalyze = headlines
    .map(h => h.title || h)
    .filter(text => text && text.length > 5)
    .slice(0, 10);
  
  if (textsToAnalyze.length === 0) {
    throw new Error('No valid headlines to analyze');
  }
  
  console.log('Cohere analysis for:', textsToAnalyze.length, 'headlines');
  
  // Create prompt for sentiment analysis using Chat API
  const prompt = `Analyze the sentiment of these cryptocurrency news headlines and classify each as "positive", "negative", or "neutral":

${textsToAnalyze.map((text, i) => `${i + 1}. ${text}`).join('\n')}

Respond with ONLY a JSON array in this exact format:
[{"text": "headline 1", "sentiment": "positive", "confidence": 0.8}, {"text": "headline 2", "sentiment": "negative", "confidence": 0.9}]

Use these criteria:
- "positive": bullish, optimistic, gains, growth, adoption, institutional investment, partnerships, upgrades
- "negative": bearish, crashes, bans, hacks, fears, regulatory concerns, sell-offs, decline
- "neutral": stable, mixed, updates, general news without clear sentiment
- Include confidence (0.0-1.0) based on how certain you are about the sentiment`;

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
      max_tokens: 1500
    }),
  });
  
  if (!response.ok) {
    let errorDetails = 'Unknown error';
    try {
      const errorBody = await response.text();
      errorDetails = errorBody;
    } catch (e) {
      errorDetails = `HTTP ${response.status}`;
    }
    
    if (response.status === 429) {
      throw new Error('Rate limit exceeded');
    }
    throw new Error(`Cohere API error: ${response.status} - ${errorDetails}`);
  }
  
  const data = await response.json();
  
  // Parse the response
  let sentimentResults = [];
  try {
    const messageContent = data.message?.content?.[0]?.text || '';
    
    // Extract JSON from response
    const jsonMatch = messageContent.match(/\[.*\]/s);
    if (jsonMatch) {
      sentimentResults = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error('No JSON array found in response');
    }
  } catch (parseError) {
    console.log('Failed to parse AI response:', parseError.message);
    throw new Error('Invalid response format from Cohere');
  }
  
  // Calculate improved sentiment metrics
  const results = calculateImprovedSentimentMetrics(sentimentResults, headlines.length);
  
  return jsonResponse({
    ...results,
    method: 'cohere-chat-api',
    analyzed: sentimentResults.length,
    total: headlines.length
  });
}

function analyzeSentimentWithKeywords(headlines) {
  const positiveKeywords = [
    'soar', 'surge', 'rally', 'bull', 'bullish', 'gain', 'gains', 'rise', 'rising', 
    'up', 'high', 'moon', 'pump', 'breakthrough', 'adoption', 'institutional',
    'investment', 'buy', 'support', 'strong', 'growth', 'increase', 'positive',
    'optimistic', 'confidence', 'milestone', 'achievement', 'success', 'upgrade',
    'partnership', 'expansion', 'innovation', 'record', 'all-time', 'ath',
    'boost', 'advance', 'progress', 'breakthrough', 'approve', 'approved'
  ];
  
  const negativeKeywords = [
    'crash', 'dump', 'bear', 'bearish', 'fall', 'drop', 'down', 'low', 'dip',
    'decline', 'plunge', 'collapse', 'sell', 'selling', 'pressure', 'fear',
    'panic', 'concern', 'worry', 'risk', 'volatile', 'uncertainty', 'loss',
    'losses', 'negative', 'pessimistic', 'regulation', 'ban', 'hack', 'attack',
    'fraud', 'scam', 'bubble', 'warning', 'alert', 'crisis', 'problem',
    'reject', 'rejected', 'struggle', 'suffer', 'plummet', 'crash'
  ];
  
  const sentimentResults = [];
  
  headlines.forEach(headline => {
    const text = (headline.title || headline).toLowerCase();
    const positiveMatches = positiveKeywords.filter(keyword => text.includes(keyword));
    const negativeMatches = negativeKeywords.filter(keyword => text.includes(keyword));
    
    let sentiment = 'neutral';
    let confidence = 0.5; // Default neutral confidence
    
    if (positiveMatches.length > negativeMatches.length) {
      sentiment = 'positive';
      confidence = Math.min(0.9, 0.6 + (positiveMatches.length * 0.1));
    } else if (negativeMatches.length > positiveMatches.length) {
      sentiment = 'negative';
      confidence = Math.min(0.9, 0.6 + (negativeMatches.length * 0.1));
    } else if (positiveMatches.length > 0 || negativeMatches.length > 0) {
      confidence = 0.3; // Low confidence for mixed signals
    }
    
    sentimentResults.push({
      text: headline.title || headline,
      sentiment: sentiment,
      confidence: confidence,
      matches: {
        positive: positiveMatches,
        negative: negativeMatches
      }
    });
  });
  
  // Calculate improved sentiment metrics
  const results = calculateImprovedSentimentMetrics(sentimentResults, headlines.length);
  
  return jsonResponse({
    ...results,
    method: 'keyword-analysis',
    analyzed: sentimentResults.length,
    total: headlines.length
  });
}

function calculateImprovedSentimentMetrics(sentimentResults, totalHeadlines) {
  let positiveCount = 0;
  let negativeCount = 0;
  let neutralCount = 0;
  let totalConfidence = 0;
  let weightedScore = 0;
  
  sentimentResults.forEach(result => {
    const sentiment = result.sentiment?.toLowerCase();
    const confidence = result.confidence || 0.5;
    
    totalConfidence += confidence;
    
    if (sentiment === 'positive') {
      positiveCount++;
      weightedScore += confidence * 2; // Positive contributes +2 weighted by confidence
    } else if (sentiment === 'negative') {
      negativeCount++;
      weightedScore -= confidence * 2; // Negative contributes -2 weighted by confidence
    } else {
      neutralCount++;
      // Neutral contributes 0 to weighted score
    }
  });
  
  const analyzed = sentimentResults.length;
  const avgConfidence = analyzed > 0 ? totalConfidence / analyzed : 0;
  
  // Calculate score on -5 to +5 scale, weighted by confidence
  const maxPossibleScore = analyzed * 2; // Maximum positive score
  const score = maxPossibleScore > 0 ? (weightedScore / maxPossibleScore) * 5 : 0;
  
  // Determine category with improved thresholds
  let category = 'neutral';
  if (score >= 0.5) {
    category = 'bullish';
  } else if (score <= -0.5) {
    category = 'bearish';
  }
  
  // Improved confidence calculation
  // High confidence if: strong sentiment direction + high individual confidences
  const sentimentStrength = Math.abs(score) / 5; // 0-1 scale
  const overallConfidence = Math.min(0.95, avgConfidence * sentimentStrength + 0.3);
  
  return {
    score: Math.round(score * 100) / 100,
    category,
    confidence: Math.round(overallConfidence * 100) / 100,
    breakdown: {
      positive: positiveCount,
      negative: negativeCount,
      neutral: neutralCount
    },
    metrics: {
      average_individual_confidence: Math.round(avgConfidence * 100) / 100,
      sentiment_strength: Math.round(sentimentStrength * 100) / 100,
      weighted_score: Math.round(weightedScore * 100) / 100
    }
  };
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
 * Explain trading patterns using Cohere Chat API v2
 */
async function explainPatternWithCohere(rsi, sma, bb, signals, coin, timeframe, env, liveValues) {
  const { currentPrice, currentRSI, currentSMA, currentBBUpper, currentBBLower } = liveValues;
  
  // Prepare comprehensive technical analysis context
  const rsiValue = rsi.length > 0 ? rsi[rsi.length - 1].y : currentRSI;
  const smaValue = sma.length > 0 ? sma[sma.length - 1].y : currentSMA;
  
  // Create detailed prompt for AI explanation
  const prompt = `You are a professional cryptocurrency technical analyst. Provide a comprehensive explanation of the current market pattern for ${coin.toUpperCase()}.

**Current Technical Analysis Data:**
- Current Price: $${currentPrice.toLocaleString()}
- RSI (14): ${rsiValue.toFixed(2)}
- SMA (20): $${smaValue.toLocaleString()}
- Bollinger Band Upper: $${currentBBUpper.toLocaleString()}
- Bollinger Band Lower: $${currentBBLower.toLocaleString()}
- Timeframe: ${timeframe} days
- Analysis Signals: ${signals.map(s => `${s.type}: ${s.signal} (${s.strength})`).join(', ')}

**Instructions:**
1. Explain what these technical indicators are telling us about ${coin.toUpperCase()}'s current market condition
2. Analyze the relationship between price and moving averages
3. Interpret the RSI level and what it suggests about momentum
4. Explain the Bollinger Bands positioning and market volatility
5. Provide trading insights based on the combined signals
6. Include risk management considerations
7. Keep the explanation educational and professional

**Important:** This is educational content only, not financial advice. Focus on explaining the technical patterns and what they typically indicate in market analysis.

Provide a detailed, well-structured explanation in plain English that helps users understand the current market pattern.`;

  console.log('🤖 Sending comprehensive explanation request to Cohere...');
  
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
      temperature: 0.4,
      max_tokens: 1500
    }),
  });
  
  if (!response.ok) {
    const errorBody = await response.text();
    console.log('Cohere Chat API explanation error:', errorBody);
    throw new Error(`Cohere Chat API error: ${response.status}`);
  }
  
  const data = await response.json();
  console.log('🤖 Cohere explanation API success');

  // Extract the explanation
  const explanation = data.message?.content?.[0]?.text || 'No explanation generated';
  
  return jsonResponse({
    explanation: explanation,
    method: 'cohere-chat-api',
    coin: coin,
    timestamp: new Date().toISOString(),
    technicalContext: {
      currentPrice,
      currentRSI: rsiValue,
      currentSMA: smaValue,
      timeframe
    }
  });
}

/**
 * Fallback explanation when Cohere AI is not available
 */
function explainPatternFallback(rsi, sma, bb, signals, coin, timeframe, liveValues) {
  const { currentPrice, currentRSI, currentSMA, currentBBUpper, currentBBLower } = liveValues;
  
  const rsiValue = rsi.length > 0 ? rsi[rsi.length - 1].y : currentRSI;
  const smaValue = sma.length > 0 ? sma[sma.length - 1].y : currentSMA;
  
  let explanation = `**Technical Analysis Explanation for ${coin.toUpperCase()}**\n\n`;
  
  explanation += `**Current Market Snapshot:**\n`;
  explanation += `• Price: $${currentPrice.toLocaleString()}\n`;
  explanation += `• Timeframe: ${timeframe} days\n\n`;
  
  explanation += `**RSI Analysis (${rsiValue.toFixed(2)}):**\n`;
  if (rsiValue < 30) {
    explanation += `• The RSI is in oversold territory, suggesting the asset may be undervalued and due for a potential price recovery.\n`;
  } else if (rsiValue > 70) {
    explanation += `• The RSI is in overbought territory, indicating the asset may be overvalued and could face selling pressure.\n`;
  } else {
    explanation += `• The RSI is in a neutral range, suggesting balanced buying and selling pressure.\n`;
  }
  
  explanation += `\n**Moving Average Analysis:**\n`;
  const priceVsSMA = ((currentPrice - smaValue) / smaValue) * 100;
  explanation += `• Current price is ${priceVsSMA >= 0 ? 'above' : 'below'} the 20-day moving average by ${Math.abs(priceVsSMA).toFixed(2)}%\n`;
  if (currentPrice > smaValue * 1.02) {
    explanation += `• This suggests an upward trend with bullish momentum.\n`;
  } else if (currentPrice < smaValue * 0.98) {
    explanation += `• This indicates a downward trend with bearish pressure.\n`;
  } else {
    explanation += `• Price is consolidating around the moving average.\n`;
  }
  
  explanation += `\n**Bollinger Bands Analysis:**\n`;
  explanation += `• Upper Band: $${currentBBUpper.toLocaleString()}\n`;
  explanation += `• Lower Band: $${currentBBLower.toLocaleString()}\n`;
  if (currentPrice > currentBBUpper) {
    explanation += `• Price is above the upper band, suggesting potential overbought conditions.\n`;
  } else if (currentPrice < currentBBLower) {
    explanation += `• Price is below the lower band, suggesting potential oversold conditions.\n`;
  } else {
    explanation += `• Price is within the bands, indicating normal volatility levels.\n`;
  }
  
  explanation += `\n**Signal Summary:**\n`;
  const buySignals = signals.filter(s => s.signal === 'BUY').length;
  const sellSignals = signals.filter(s => s.signal === 'SELL').length;
  explanation += `• ${buySignals} bullish signals detected\n`;
  explanation += `• ${sellSignals} bearish signals detected\n`;
  
  explanation += `\n**Risk Management Notes:**\n`;
  explanation += `• Always use proper position sizing and stop-loss orders\n`;
  explanation += `• Technical analysis should be combined with fundamental analysis\n`;
  explanation += `• Past performance does not guarantee future results\n\n`;
  
  explanation += `**Disclaimer:** This analysis is for educational purposes only and should not be considered financial advice.`;
  
  return jsonResponse({
    explanation: explanation,
    method: 'rule-based',
    coin: coin,
    timestamp: new Date().toISOString(),
    technicalContext: {
      currentPrice,
      currentRSI: rsiValue,
      currentSMA: smaValue,
      timeframe
    }
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
        headers: {
          ...CORS_HEADERS,
          'Cache-Control': 'no-store, max-age=0, must-revalidate',
          'Surrogate-Control': 'no-store',
          'Pragma': 'no-cache',
          'Expires': '0'
        },
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