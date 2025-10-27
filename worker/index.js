// =============================================================================
// Crypto Mood Dashboard - Cloudflare Worker
// Handles API calls to CoinGecko, NewsAPI.org, and Cohere AI
// =============================================================================

// CORS headers for frontend requests - Enhanced for GitHub Pages compatibility
const DEFAULT_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, HEAD',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept, Origin, Referer, User-Agent, Cache-Control, Pragma',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Type, X-Cache-Status, X-DO-Age, X-Cache-Source',
  'Access-Control-Max-Age': '86400', // 24 hours
  'Vary': 'Origin, Accept-Encoding'
};

function jsonResponse(data, status = 200, extraHeaders = {}) {
  // Ensure client and CDN are instructed not to cache client-facing API responses
  const cacheHeaders = {
    'Cache-Control': 'no-store, max-age=0, must-revalidate',
    'Surrogate-Control': 'no-store',
    'Pragma': 'no-cache',
    'Expires': '0'
  };

  return new Response(typeof data === 'string' ? data : JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...DEFAULT_CORS,
      ...cacheHeaders,
      ...extraHeaders
    }
  });
}

function errorResponse(message, status = 400) {
  return jsonResponse({ error: message }, status);
}

// Helper: treat `_` or force=true as cache-bust
function isForceRefresh(requestUrl) {
  try {
    const u = new URL(requestUrl);
    if (u.searchParams.has('_')) return true;
    const f = u.searchParams.get('force');
    return f === '1' || f === 'true';
  } catch (e) {
    return false;
  }
}

// Delete a KV key if older than thresholdMs
async function deleteIfVeryOld(kv, cacheKey, thresholdMs) {
  try {
    const raw = await kv.get(cacheKey);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    const ts = parsed.timestamp || parsed.data?.timestamp || 0;
    if (!ts) return false;
    if (Date.now() - ts > thresholdMs) {
      console.log(`[Cache] Deleting very old cache ${cacheKey} (age: ${Math.floor((Date.now()-ts)/1000)}s)`);
      await kv.delete(cacheKey);
      return true;
    }
  } catch (e) {
    console.warn(`[Cache] deleteIfVeryOld failed for ${cacheKey}:`, e.message);
  }
  return false;
}

  // CoinGecko API configuration
const COINGECKO_API_BASE = 'https://api.coingecko.com/api/v3';
  
  // Rate limiting configuration
  const COINGECKO_RATE_LIMIT_DELAY = 5000; // 5 seconds between requests (faster)
  
  // Rate-limited fetch function
  async function rateLimitedFetch(url, options = {}, env) {
    const cacheKey = `rate_limit_${Date.now()}`;
    
    try {
      // Check if we need to wait based on KV storage
      if (env.RATE_LIMIT_KV) {
        const lastRequest = await env.RATE_LIMIT_KV.get('last_coingecko_request');
        if (lastRequest) {
          const lastRequestTime = parseInt(lastRequest);
          const timeSinceLastRequest = Date.now() - lastRequestTime;
          
          if (timeSinceLastRequest < COINGECKO_RATE_LIMIT_DELAY) {
            const waitTime = COINGECKO_RATE_LIMIT_DELAY - timeSinceLastRequest;
            console.log(`⏳ Rate limiting: waiting ${waitTime}ms before CoinGecko request`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
          }
        }
        
        // Update last request time
        await env.RATE_LIMIT_KV.put('last_coingecko_request', Date.now().toString());
      }
      
      return await fetch(url, options);
    } catch (error) {
      console.log(`❌ Rate limited fetch error: ${error.message}`);
      throw error;
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

// Smart caching with background refresh for CoinGecko API
async function getCachedPriceData(coinId, env) {
  const cacheKey = `price_${coinId}`;
  const now = Date.now();
  const CACHE_TTL = 10000; // 10 seconds fresh cache (faster updates)
  const MAX_STALE = 60000; // 1 minute max stale (shorter stale period)
  
  try {
    // Get cached data
    const cached = await env.RATE_LIMIT_KV.get(cacheKey);
    
    if (cached) {
        const { data, timestamp } = JSON.parse(cached);
        const age = now - timestamp;
        
        // Validate cached price data - Bitcoin should be between $30,000 and $150,000
        if (coinId === 'bitcoin' && (data.price < 30000 || data.price > 150000)) {
          console.log(`⚠️ [Cache] Invalid cached Bitcoin price: $${data.price}, fetching fresh data`);
          // Clear invalid cache and fetch fresh data
          await env.RATE_LIMIT_KV.delete(cacheKey);
          return await fetchFreshPriceData(coinId, env);
        }
        
        // Fresh cache - return immediately
      if (age <= CACHE_TTL) {
        console.log(`✅ [Cache] Fresh data for ${coinId} (age: ${age}ms)`);
        return { data, fromCache: true, fresh: true };
      }
      
      // Stale cache - return immediately but trigger background refresh
      if (age <= MAX_STALE) {
        console.log(`🔄 [Cache] Stale data for ${coinId} (age: ${age}ms), triggering background refresh`);
        
        // Trigger background refresh without waiting
        refreshPriceInBackground(coinId, env).catch(error => {
          console.log(`Background refresh failed for ${coinId}:`, error);
        });
        
        return { data, fromCache: true, fresh: false };
      } else {
        // Even if very stale, serve it immediately and refresh in background
        console.log(`⚡ [Cache] Serving very stale cached data for ${coinId} (${age}ms old), refreshing in background`);
        refreshPriceInBackground(coinId, env).catch(error => {
          console.log(`Background refresh failed for ${coinId}:`, error);
        });
        return { data, fromCache: true, fresh: false };
      }
    }
    
    // No cache or too stale - fetch fresh data
    console.log(`🆕 [Cache] No cache for ${coinId}, fetching fresh data`);
    return await fetchFreshPriceData(coinId, env);
    
  } catch (error) {
    console.log(`❌ [Cache] Error getting cached data for ${coinId}:`, error);
    return await fetchFreshPriceData(coinId, env);
  }
}

async function refreshPriceInBackground(coinId, env) {
  const coingeckoId = SUPPORTED_COINS[coinId].coingecko_id;
  const url = `${COINGECKO_API_BASE}/simple/price?ids=${coingeckoId}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`;
  
  try {
    console.log(`🔄 [Background] Refreshing price for ${coinId}`);
    const response = await fetch(url);
    
    if (response.ok) {
      const data = await response.json();
      const coinData = data[coingeckoId];
      
      if (validatePriceData(coinData)) {
        const priceData = {
          coin: coinId,
          price: Math.round(coinData.usd * 100) / 100,
          change24h: coinData.usd_24h_change || 0,
          market_cap: coinData.usd_market_cap || 0,
          volume_24h: coinData.usd_24h_vol || 0,
          symbol: SUPPORTED_COINS[coinId].symbol,
          source: 'coingecko',
          timestamp: new Date().toISOString()
        };
        
        // Update cache
        await env.RATE_LIMIT_KV.put(`price_${coinId}`, JSON.stringify({
          data: priceData,
          timestamp: Date.now()
        }));
        
        console.log(`✅ [Background] Updated cache for ${coinId}`);
      }
    }
  } catch (error) {
    console.log(`❌ [Background] Failed to refresh ${coinId}:`, error);
  }
}

async function fetchFreshPriceData(coinId, env) {
  const coingeckoId = SUPPORTED_COINS[coinId].coingecko_id;
  const url = `${COINGECKO_API_BASE}/simple/price?ids=${coingeckoId}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`;
  
  try {
    console.log(`🚀 [Fresh] Fetching price for ${coinId}`);
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status}`);
    }
    
    const data = await response.json();
    const coinData = data[coingeckoId];
    
    if (!validatePriceData(coinData)) {
      throw new Error('Invalid CoinGecko response');
    }
    
    const priceData = {
      coin: coinId,
      price: Math.round(coinData.usd * 100) / 100,
      change24h: coinData.usd_24h_change || 0,
      market_cap: coinData.usd_market_cap || 0,
      volume_24h: coinData.usd_24h_vol || 0,
      symbol: SUPPORTED_COINS[coinId].symbol,
      source: 'coingecko',
      timestamp: new Date().toISOString()
    };
    
    // Cache the fresh data
    await env.RATE_LIMIT_KV.put(`price_${coinId}`, JSON.stringify({
      data: priceData,
      timestamp: Date.now()
    }));
    
    console.log(`✅ [Fresh] Cached fresh data for ${coinId}`);
    return { data: priceData, fromCache: false, fresh: true };
    
  } catch (error) {
    console.log(`❌ [Fresh] Failed to fetch ${coinId}:`, error);
    throw error;
  }
}

// History data caching functions
async function getCachedHistoryData(coinId, days, env) {
  const cacheKey = `history_${coinId}_${days}`;
  const now = Date.now();
  const CACHE_TTL = 10000; // 10 seconds fresh cache (faster updates)
  const MAX_STALE = 60000; // 1 minute max stale (shorter stale period)
  
  try {
    // Get cached data
    const cached = await env.RATE_LIMIT_KV.get(cacheKey);
    
    if (cached) {
        const { data, timestamp } = JSON.parse(cached);
        const age = now - timestamp;
        
        // Validate cached history data - Bitcoin prices should be reasonable
        if (coinId === 'bitcoin' && data.prices && data.prices.length > 0) {
          const avgPrice = data.prices.reduce((sum, p) => sum + p.price, 0) / data.prices.length;
          if (avgPrice < 30000 || avgPrice > 150000) {
            console.log(`⚠️ [History Cache] Invalid cached Bitcoin prices (avg: $${avgPrice}), fetching fresh data`);
            await env.RATE_LIMIT_KV.delete(cacheKey);
            return await fetchFreshHistoryData(coinId, days, env);
          }
        }
        
        if (age < CACHE_TTL) {
          console.log(`✅ [History Cache] Serving fresh cached data for ${coinId} (${age}ms old)`);
          return { data, fromCache: true, fresh: true };
        } else if (age < MAX_STALE) {
          console.log(`🔄 [History Cache] Serving stale cached data for ${coinId} (${age}ms old), refreshing in background`);
          // Trigger background refresh
          refreshHistoryInBackground(coinId, days, env);
          return { data, fromCache: true, fresh: false };
        } else {
          // Even if very stale, serve it immediately and refresh in background
          console.log(`⚡ [History Cache] Serving very stale cached data for ${coinId} (${age}ms old), refreshing in background`);
          refreshHistoryInBackground(coinId, days, env);
          return { data, fromCache: true, fresh: false };
        }
    }
    
    // No cache or too old, fetch fresh data
    console.log(`🔄 [History Cache] No valid cache for ${coinId}, fetching fresh data`);
    return await fetchFreshHistoryData(coinId, days, env);
    
  } catch (error) {
    console.log(`❌ [History Cache] Error getting cached data for ${coinId}: ${error.message}`);
    return await fetchFreshHistoryData(coinId, days, env);
  }
}

async function fetchFreshHistoryData(coinId, days, env) {
  const coingeckoId = SUPPORTED_COINS[coinId].coingecko_id;
  const url = `${COINGECKO_API_BASE}/coins/${coingeckoId}/market_chart?vs_currency=usd&days=${days}&interval=daily`;
  
  try {
    console.log(`🚀 [Fresh History] Fetching history for ${coinId} (${days} days)`);
    const response = await rateLimitedFetch(url, {}, env);
    
    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!validateHistoryData(data)) {
      throw new Error('Invalid CoinGecko response');
    }
    
    // Transform data to expected format
    const prices = data.prices.map(([timestamp, price]) => ({
        timestamp: new Date(timestamp).toISOString(),
        price: Math.round(price * 100) / 100, // Round to 2 decimal places
    }));
    
    const historyData = {
      coin: coinId,
      prices: prices,
      days: days,
      symbol: SUPPORTED_COINS[coinId].symbol,
      source: 'coingecko',
      note: 'Real market data from CoinGecko'
    };
    
    // Cache the fresh data
    await env.RATE_LIMIT_KV.put(`history_${coinId}_${days}`, JSON.stringify({
      data: historyData,
      timestamp: Date.now()
    }));
    
    console.log(`✅ [Fresh History] Cached fresh history data for ${coinId}`);
    return { data: historyData, fromCache: false, fresh: true };
    
  } catch (error) {
    console.log(`❌ [Fresh History] Failed to fetch history for ${coinId}:`, error);
    throw error;
  }
}

async function refreshHistoryInBackground(coinId, days, env) {
  // Don't await this - let it run in background
  fetchFreshHistoryData(coinId, days, env).catch(error => {
    console.log(`⚠️ [Background History] Failed to refresh ${coinId}: ${error.message}`);
  });
}

// Data validation helpers
function validatePriceData(data) {
  if (!data || typeof data !== 'object') return false;
  if (typeof data.usd !== 'number' || data.usd <= 0) return false;
  // usd_24h_change can be null, so we allow that
  if (data.usd_24h_change !== null && typeof data.usd_24h_change !== 'number') return false;
  
  // Validate Bitcoin price is reasonable (between $30,000 and $150,000)
  if (data.usd < 30000 || data.usd > 150000) {
    console.log(`⚠️ Unrealistic Bitcoin price from CoinGecko: $${data.usd}`);
    return false;
  }
  
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
  try {
    const url = new URL(request.url);
    const coinId = url.searchParams.get('coin') || 'bitcoin';
    const origin = request.headers.get('Origin');

    console.log(`Fetching price for ${coinId} from origin: ${origin || 'direct'}`);

    // Respect client cache-bust
    let force = isForceRefresh(request.url);

    // Delete KV if older than threshold (e.g., 48h stale safety)
    const VERY_OLD_MS = 48 * 60 * 60 * 1000; // 48 hours
    await deleteIfVeryOld(env.RATE_LIMIT_KV, `price_${coinId}`, VERY_OLD_MS);

    // Implement a short freshness threshold (30s)
    const SHORT_TTL_MS = 30 * 1000; // 30 seconds
    // If not force, check existing KV age and force refresh if older than SHORT_TTL_MS
    if (!force) {
      try {
        const raw = await env.RATE_LIMIT_KV.get(`price_${coinId}`);
        if (raw) {
          const parsed = JSON.parse(raw);
          const cachedTs = parsed.timestamp || 0;
          if (cachedTs && (Date.now() - cachedTs > SHORT_TTL_MS)) {
            console.log(`[Price] Cached price too old (${Math.floor((Date.now()-cachedTs)/1000)}s), forcing refresh`);
            force = true;
          }
        }
      } catch (e) {
        console.warn('[Price] error reading KV for age check:', e.message);
      }
    }

    let result;
    if (force) {
      // always attempt to fetch fresh and update cache
      console.log(`[Price] Force refresh for ${coinId}`);
      result = await fetchFreshPriceData(coinId, env);
    } else {
      // use smart cached data
      result = await getCachedPriceData(coinId, env);
    }

    // Build observability headers
    const dataTs = result.data?.timestamp ? new Date(result.data.timestamp).getTime() : Date.now();
    const xdoage = Math.floor((Date.now() - dataTs) / 1000);
    const headers = {
      'X-Cache-Status': result.fromCache ? (result.fresh ? 'fresh' : 'stale') : 'miss',
      'X-Cache-Source': result.fromCache ? 'cache' : 'api',
      'X-DO-Age': String(xdoage),
      'X-Client-Cache': 'no-store'
    };

    console.log(`✅ [Price] Got price for ${coinId}: $${result.data.price} (fromCache=${result.fromCache}, age=${xdoage}s)`);
    return jsonResponse(result.data, 200, headers);

  } catch (error) {
    console.error('❌ [Price] Error handling price request:', error);
    return errorResponse('Failed to fetch price data');
  }
}

async function handleHistory(request, env) {
  try {
    const url = new URL(request.url);
    const coinId = url.searchParams.get('coin') || 'bitcoin';
    const days = Math.min(parseInt(url.searchParams.get('days')) || 7, 30); // Max 30 days
    
    if (!SUPPORTED_COINS[coinId]) {
      return errorResponse(`Unsupported coin: ${coinId}`);
    }
    
    // Respect client cache-bust
    let force = isForceRefresh(request.url);

    // Delete KV if older than threshold
    const VERY_OLD_MS = 48 * 60 * 60 * 1000; // 48 hours
    await deleteIfVeryOld(env.RATE_LIMIT_KV, `history_${coinId}_${days}`, VERY_OLD_MS);

    // Implement a short freshness threshold (30s)
    const SHORT_TTL_MS = 30 * 1000; // 30 seconds
    if (!force) {
      try {
        const raw = await env.RATE_LIMIT_KV.get(`history_${coinId}_${days}`);
        if (raw) {
          const parsed = JSON.parse(raw);
          const cachedTs = parsed.timestamp || 0;
          if (cachedTs && (Date.now() - cachedTs > SHORT_TTL_MS)) {
            console.log(`[History] Cached history too old (${Math.floor((Date.now()-cachedTs)/1000)}s), forcing refresh`);
            force = true;
          }
        }
      } catch (e) {
        console.warn('[History] error reading KV for age check:', e.message);
      }
    }
    
    let result;
    if (force) {
      console.log(`[History] Force refresh for ${coinId} (${days} days)`);
      result = await fetchFreshHistoryData(coinId, days, env);
    } else {
      result = await getCachedHistoryData(coinId, days, env);
    }
    
    // Build observability headers (use first price timestamp for age)
    const firstPrice = result.data.prices && result.data.prices.length > 0 ? result.data.prices[0] : null;
    const dataTs = firstPrice?.timestamp ? new Date(firstPrice.timestamp).getTime() : Date.now();
    const xdoage = Math.floor((Date.now() - dataTs) / 1000);
    const headers = {
      'X-Cache-Status': result.fromCache ? (result.fresh ? 'fresh' : 'stale') : 'miss',
      'X-Cache-Source': result.fromCache ? 'cache' : 'api',
      'X-DO-Age': String(xdoage),
      'X-Client-Cache': 'no-store'
    };
    
    console.log(`✅ [History] Got history for ${coinId} (${result.data.prices.length} points, fromCache=${result.fromCache}, age=${xdoage}s)`);
    return jsonResponse(result.data, 200, headers);
    
  } catch (error) {
    console.error('Error in handleHistory:', error);
    return errorResponse(`Failed to fetch price history: ${error.message}`);
  }
}

// Generate realistic fallback historical data when CoinGecko is unavailable
function generateFallbackHistoryData(coinId, days) {
  const prices = [];
  const now = new Date();
  const basePrice = getFallbackBasePrice(coinId);
  
  // Generate realistic price movements
  let currentPrice = basePrice;
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    
    // Add realistic daily volatility (±2% to ±8% depending on coin)
    const volatility = getVolatilityForCoin(coinId);
    const changePercent = (Math.random() - 0.5) * 2 * volatility;
    currentPrice = currentPrice * (1 + changePercent / 100);
    
    prices.push({
      timestamp: date.toISOString(),
      price: Math.round(currentPrice * 100) / 100
    });
  }
  
  return jsonResponse({
    coin: coinId,
    prices: prices,
    days: days,
    symbol: SUPPORTED_COINS[coinId].symbol,
    source: 'fallback',
    note: 'Simulated market data (CoinGecko temporarily unavailable)'
  });
}

// Generate realistic fallback price data when CoinGecko is unavailable
function generateFallbackPriceData(coinId) {
  const basePrice = getFallbackBasePrice(coinId);
  const volatility = getVolatilityForCoin(coinId);
  
  // Generate realistic daily change (±volatility%)
  const changePercent = (Math.random() - 0.5) * 2 * volatility;
  const currentPrice = basePrice * (1 + changePercent / 100);
  
  // Generate realistic market data
  const marketCap = currentPrice * 19000000; // Approximate circulating supply multiplier
  const volume24h = marketCap * 0.05; // 5% of market cap as daily volume
  
  return jsonResponse({
    coin: coinId,
    price: Math.round(currentPrice * 100) / 100,
    change24h: changePercent,
    market_cap: Math.round(marketCap),
    volume_24h: Math.round(volume24h),
    symbol: SUPPORTED_COINS[coinId].symbol,
    source: 'fallback',
    timestamp: new Date().toISOString(),
    note: 'Simulated market data (CoinGecko temporarily unavailable)'
  });
}

// Get realistic base prices for different coins
function getFallbackBasePrice(coinId) {
  const basePrices = {
    'bitcoin': 111000, // Updated to current Bitcoin price range
    'ethereum': 3500,  // Updated to current Ethereum price
    'litecoin': 120,   // Updated to current Litecoin price
    'bitcoin-cash': 300, // Updated to current BCH price
    'cardano': 0.55,   // Updated to current ADA price
    'ripple': 0.65,   // Updated to current XRP price
    'dogecoin': 0.12,  // Updated to current DOGE price
    'polkadot': 8.5,   // Updated to current DOT price
    'chainlink': 18,   // Updated to current LINK price
    'stellar': 0.15,   // Updated to current XLM price
    'monero': 180,     // Updated to current XMR price
    'tezos': 1.5,      // Updated to current XTZ price
    'eos': 1.3,        // Updated to current EOS price
    'zcash': 55,       // Updated to current ZEC price
    'dash': 45,
    'solana': 25
  };
  
  return basePrices[coinId] || 100; // Default fallback price
}

// Get volatility percentage for different coins
function getVolatilityForCoin(coinId) {
  const volatilities = {
    'bitcoin': 4,      // ±4% daily volatility
    'ethereum': 5,     // ±5% daily volatility
    'litecoin': 6,     // ±6% daily volatility
    'bitcoin-cash': 6,
    'cardano': 7,
    'ripple': 7,
    'dogecoin': 8,     // ±8% daily volatility (more volatile)
    'polkadot': 7,
    'chainlink': 7,
    'stellar': 7,
    'monero': 6,
    'tezos': 7,
    'eos': 7,
    'zcash': 6,
    'dash': 6,
    'solana': 8
  };
  
  return volatilities[coinId] || 6; // Default 6% volatility
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
        model: 'command-a-03-2025',
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
  
  // Calculate dynamic confidence based on signal strength
  let baseConfidence = 60;
  
  // RSI confidence factors
  if (rsi >= 70 || rsi <= 30) baseConfidence += 20; // Strong RSI signals
  else if (rsi >= 60 || rsi <= 40) baseConfidence += 10; // Moderate RSI signals
  
  // SMA signal confidence
  if (smaSignal === 'BUY') baseConfidence += 10;
  else if (smaSignal === 'SELL') baseConfidence += 10;
  
  // Price trend confidence
  if (priceChange > 2 || priceChange < -2) baseConfidence += 10; // Strong trends
  else if (Math.abs(priceChange) > 0.5) baseConfidence += 5; // Moderate trends
  
  // Cap confidence at 90%
  baseConfidence = Math.min(90, baseConfidence);
  
  // Create a comprehensive prompt for Chat API classification
  const prompt = `You are a cryptocurrency market sentiment classifier. Based on the technical analysis indicators provided, classify the market sentiment as exactly one of: "bullish", "bearish", or "neutral".

Technical Analysis Data:
${inputText}

Guidelines:
- "bullish": Strong positive signals, RSI oversold (under 30) with buy signals, or strong upward momentum
- "bearish": Strong negative signals, RSI overbought (over 70) with sell signals, or strong downward momentum  
- "neutral": Mixed signals, RSI in normal range (30-70), or conflicting indicators

Examples:
- RSI: 25, SMA: BUY, BB: BUY, Price trend: rising strongly → bullish
- RSI: 80, SMA: SELL, BB: SELL, Price trend: declining sharply → bearish
- RSI: 50, SMA: NEUTRAL, BB: NEUTRAL, Price trend: sideways movement → neutral

Respond with ONLY a JSON object in this exact format:
{"sentiment": "bullish", "confidence": ${baseConfidence}, "reasoning": "Brief explanation"}

The confidence should be a number between 50-95 based on how clear the signals are.`;
  
  // Make request to Cohere Chat API v2
  const response = await fetch('https://api.cohere.com/v2/chat', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.COHERE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
        model: 'command-a-03-2025',
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 200
    }),
  });
  
  if (!response.ok) {
    const errorBody = await response.text();
    console.log('Cohere Chat API error:', errorBody);
    throw new Error(`Cohere Chat API error: ${response.status}`);
  }
  
  const data = await response.json();
  console.log('Cohere Chat API success for classification');
  
  // Extract the classification result
  const messageContent = data.message?.content?.[0]?.text || '';
  
  try {
    // Extract JSON from response
    const jsonMatch = messageContent.match(/\{.*\}/s);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      
      return jsonResponse({
        mood: result.sentiment,
        confidence: baseConfidence, // Use our calculated confidence instead of AI's
        reasoning: result.reasoning || `Based on RSI ${rsi.toFixed(1)}, SMA: ${smaSignal}, BB: ${bbSignal}, price trend: ${priceTrend}`,
        method: 'cohere-chat-api',
        coin: coin,
        timestamp: new Date().toISOString()
      });
    } else {
      throw new Error('No JSON found in response');
    }
  } catch (parseError) {
    console.log('Failed to parse AI classification response:', parseError.message);
    throw new Error('Invalid response format from Cohere Chat API');
  }
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
  
  // Round exactly once so the model can only echo these strings
  function toFixedStr(n, dp = 2) { return Number(n).toFixed(dp); }
  
  const P = toFixedStr(currentPrice, 2);
  const R = toFixedStr(rsiValue, 2);
  const S = toFixedStr(smaValue, 2);
  const L = toFixedStr(currentBBLower, 2);
  const U = toFixedStr(currentBBUpper, 2);
  const PERIOD = 4; // SMA period used in charts
  const TF = Number(timeframe);

  // Derived metrics for richer text (percentages shown with % in copy)
  const priceVsSmaPct   = ((Number(P) - Number(S)) / Number(S)) * 100;
  const distToLowerPct  = ((Number(P) - Number(L)) / Number(L)) * 100;
  const distToUpperPct  = ((Number(U) - Number(P)) / Number(P)) * 100;
  const bandWidthPct    = ((Number(U) - Number(L)) / Number(S)) * 100;

  const PV = toFixedStr(priceVsSmaPct, 2);
  const DL = toFixedStr(distToLowerPct, 2);
  const DU = toFixedStr(distToUpperPct, 2);
  const BW = toFixedStr(bandWidthPct, 2);

  // Allow common RSI thresholds explicitly
  const allowedNumbers = [
    P, R, S, L, U, String(PERIOD), String(TF),
    PV, DL, DU, BW,
    "30", "40", "60", "70"
  ];
  
  // Dynamic logic for scenario planning
  const isAboveSMA = Number(P) >= Number(S);
  const bullVerb = isAboveSMA ? "holds above" : "reclaims";
  const bullishLine = `- If price ${bullVerb} SMA(${PERIOD}) ${S} with RSI > 60, look for follow-through toward ${U}.`;
  const bearishLine = isAboveSMA
    ? `- If price closes back below SMA(${PERIOD}) ${S} with RSI < 40, risk shifts toward ${L}.`
    : `- If price loses ${L}, risk expands; distance to lower band was ${DL}% and may extend.`;
  const lean = Number(R) >= 60 ? "bearish" : Number(R) <= 40 ? "bullish" : "neutral";
  
  // Dynamic confidence calculation based on signal strength
  let conf = 60; // Base confidence
  const rsiNum = Number(R);
  
  // RSI confidence boost
  if (rsiNum >= 70 || rsiNum <= 30) conf += 15; // Strong RSI signals
  else if (rsiNum >= 60 || rsiNum <= 40) conf += 10; // Moderate RSI signals
  
  // Price vs SMA confidence boost
  const priceDeviation = Number(PV);
  if (Math.abs(priceDeviation) > 5) conf += 10; // Strong price deviation
  else if (Math.abs(priceDeviation) > 2) conf += 5; // Moderate price deviation
  
  // Band width confidence boost
  const bandWidth = Number(BW);
  if (bandWidth > 10) conf += 5; // High volatility = more uncertainty
  else if (bandWidth < 5) conf += 5; // Low volatility = more predictable
  
  // Cap confidence at 90%
  conf = Math.min(90, conf);

  // Create system and user prompts with strict rules
  const system = [
    "You are a crypto technical analysis assistant that produces three layers: a beginner-friendly summary, a decision helper, and a detailed section.",
    "STRICT RULES:",
    "- Use ONLY the numbers in 'AllowedNumbers'. Do not write any other numeric value.",
    "- Refer to the moving average exactly as 'SMA(" + PERIOD + ")'. Never say '50/100/200-day' unless provided.",
    "- Use given percentages verbatim (they may include a %).",
    "",
    "OUTPUT FORMAT (Markdown):",
    "## Simple Summary",
    "- In plain English (no jargon). Three short bullets: price vs SMA(" + PERIOD + "), what RSI means, and the key support/resistance.",
    "",
    "## Decision Helper",
    "- Three short bullets with clear if/then cues and verbs like 'consider' or 'avoid'.",
    "- Use ONLY the scenario lines supplied in the user message (do not alter numbers).",
    "",
    "## Detailed Guidance",
    "Write ~120–160 words with sections:",
    "**Guidance:** 3–5 sentences referencing Context/Derived.",
    "**Levels to Watch:** bullets with provided levels.",
    "**Scenario Plan:** two bullets using the exact scenario lines supplied.",
    "**Invalidation:** one sentence that fits the current baseline.",
    "**Confidence:** 0–100%.",
    "",
    "End with: 'Educational guidance, not financial advice.'"
  ].join("\n");

  const user = [
    `Coin: ${coin.toUpperCase()} — Timeframe: ${TF} days`,
    `Context: price=${P}, RSI=${R}, SMA(${PERIOD})=${S}, BB=[${L}-${U}]`,
    `Derived: price_vs_sma_pct=${PV}, dist_to_lower_pct=${DL}, dist_to_upper_pct=${DU}, band_width_pct=${BW}`,
    `AllowedNumbers: ${allowedNumbers.join(", ")}`,
    "",
    "Use these scenario lines EXACTLY (do not change numbers):",
    bullishLine,
    bearishLine,
    "",
    "Remember: Do not use any number not listed in AllowedNumbers."
  ].join("\n");

  console.log('🤖 Sending comprehensive explanation request to Cohere...');
  
  // Make request to Cohere Chat API v2
  const response = await fetch('https://api.cohere.com/v2/chat', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.COHERE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
        model: 'command-a-03-2025',
      messages: [
        {
          role: 'system',
          content: system
        },
        {
          role: 'user',
          content: user
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
  let explanation = data.message?.content?.[0]?.text || 'No explanation generated';
  
  // Guardrails: validate that AI only uses allowed numbers
  const okNums = new Set(allowedNumbers);
  function hasDisallowedNumber(text) {
    // capture numbers like 41,280.41 or 42502.07 or 60
    const matches = text.match(/\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\b/g) || [];
    return matches.some(n => !okNums.has(n));
  }
  function wrongLabel(text) {
    return /(?:\b|^)(?:50|100|200)[-\s]day\s+SMA|\bMA(?:50|100|200)\b/i.test(text);
  }
  
  // If AI violates rules, use strict rule-based explanation
  if (hasDisallowedNumber(explanation) || wrongLabel(explanation)) {
    console.log('🤖 AI violated number/label rules, using strict fallback');
    explanation = buildRuleBasedExplanationStrict({
      coin, P, R, S, L, U, PERIOD, TF, PV, DL, DU, BW
    });
  }
  
  return jsonResponse({
    explanation: explanation,
    method: 'cohere-chat-api',
    coin: coin,
    timestamp: new Date().toISOString(),
    technicalContext: {
      currentPrice: Number(P),
      currentRSI: Number(R),
      currentSMA: Number(S),
      timeframe: TF,
      smaPeriod: PERIOD
    }
  });
}

/**
 * Strict rule-based explanation that uses only provided numbers
 */
function buildRuleBasedExplanationStrict({ coin, P, R, S, L, U, PERIOD, TF, PV, DL, DU, BW }) {
  const rsiNum = Number(R);
  const mood = rsiNum >= 70 ? "overbought" : rsiNum <= 30 ? "oversold" : "neutral";
  const lean = rsiNum >= 60 ? "bearish" : rsiNum <= 40 ? "bullish" : "neutral";
  
  // Dynamic confidence calculation (same as AI version)
  let conf = 60; // Base confidence
  
  // RSI confidence boost
  if (rsiNum >= 70 || rsiNum <= 30) conf += 15; // Strong RSI signals
  else if (rsiNum >= 60 || rsiNum <= 40) conf += 10; // Moderate RSI signals
  
  // Price vs SMA confidence boost
  const priceDeviation = Number(PV);
  if (Math.abs(priceDeviation) > 5) conf += 10; // Strong price deviation
  else if (Math.abs(priceDeviation) > 2) conf += 5; // Moderate price deviation
  
  // Band width confidence boost
  const bandWidth = Number(BW);
  if (bandWidth > 10) conf += 5; // High volatility = more uncertainty
  else if (bandWidth < 5) conf += 5; // Low volatility = more predictable
  
  // Cap confidence at 90%
  conf = Math.min(90, conf);
  
  const isAboveSMA = Number(P) >= Number(S);
  const bullVerb = isAboveSMA ? "holds above" : "reclaims";
  const bullishLine = `- If price ${bullVerb} SMA(${PERIOD}) ${S} with RSI > 60, look for follow-through toward ${U}.`;
  const bearishLine = isAboveSMA
    ? `- If price closes back below SMA(${PERIOD}) ${S} with RSI < 40, risk shifts toward ${L}.`
    : `- If price loses ${L}, risk expands; distance to lower band was ${DL}% and may extend.`;

  return [
    "## Simple Summary",
    `- Price is ${isAboveSMA ? "above" : "below"} SMA(${PERIOD}) ${S}; current price $${P}.`,
    `- RSI ${R} indicates ${mood} conditions.`,
    `- Watch ${L} (support) and ${U} (resistance).`,
    "",
    "## Decision Helper",
    `- Consider ${isAboveSMA ? "holding" : "waiting for"} positions if price ${isAboveSMA ? "stays above" : "breaks above"} SMA(${PERIOD}) ${S}.`,
    `- Avoid ${mood === "overbought" ? "chasing" : mood === "oversold" ? "panic selling" : "large"} positions near current levels.`,
    `- Monitor ${L} as key support and ${U} as resistance for breakout signals.`,
    "",
    "## Detailed Guidance",
    "**Guidance:**",
    `${coin.toUpperCase()} trades near $${P}. RSI at ${R} is ${mood}. Price is between bands [${L}–${U}] and ${PV}% ${isAboveSMA ? "above" : "below"} SMA(${PERIOD}) ${S}. Band width is ${BW}% (volatility context). Baseline leaning: ${lean}.`,
    "**Levels to Watch:**",
    `- Support: ${L} (lower band)`,
    `- Resistance: ${S} (SMA(${PERIOD})), ${U} (upper band)`,
    "**Scenario Plan:**",
    bullishLine,
    bearishLine,
    `**Invalidation:** ${lean === "bearish"
        ? `A close above ${S} with RSI > 60 invalidates the bearish tilt.`
        : lean === "bullish"
          ? `A close below ${S} with RSI < 40 invalidates the bullish tilt.`
          : `A decisive move outside [${L}–${U}] with RSI > 60 or < 40 resolves the neutral state.`}`,
    `**Confidence:** ${conf}%`,
    "",
    "Educational guidance, not financial advice."
  ].join("\n");
}

/**
 * Fallback explanation when Cohere AI is not available
 */
function explainPatternFallback(rsi, sma, bb, signals, coin, timeframe, liveValues) {
  const { currentPrice, currentRSI, currentSMA, currentBBUpper, currentBBLower } = liveValues;
  
  const rsiValue = rsi.length > 0 ? rsi[rsi.length - 1].y : currentRSI;
  const smaValue = sma.length > 0 ? sma[sma.length - 1].y : currentSMA;
  
  // Use the same strict formatting as the AI version
  function toFixedStr(n, dp = 2) { return Number(n).toFixed(dp); }
  
  const P = toFixedStr(currentPrice, 2);
  const R = toFixedStr(rsiValue, 2);
  const S = toFixedStr(smaValue, 2);
  const L = toFixedStr(currentBBLower, 2);
  const U = toFixedStr(currentBBUpper, 2);
  const PERIOD = 4;
  const TF = Number(timeframe);

  // Calculate derived metrics for richer fallback
  const priceVsSmaPct   = ((Number(P) - Number(S)) / Number(S)) * 100;
  const distToLowerPct  = ((Number(P) - Number(L)) / Number(L)) * 100;
  const distToUpperPct  = ((Number(U) - Number(P)) / Number(P)) * 100;
  const bandWidthPct    = ((Number(U) - Number(L)) / Number(S)) * 100;

  const PV = toFixedStr(priceVsSmaPct, 2);
  const DL = toFixedStr(distToLowerPct, 2);
  const DU = toFixedStr(distToUpperPct, 2);
  const BW = toFixedStr(bandWidthPct, 2);
  
  const explanation = buildRuleBasedExplanationStrict({
    coin, P, R, S, L, U, PERIOD, TF, PV, DL, DU, BW
  });
  
  return jsonResponse({
    explanation: explanation,
    method: 'rule-based-fallback',
    coin: coin,
    timestamp: new Date().toISOString(),
    technicalContext: {
      currentPrice: Number(P),
      currentRSI: Number(R),
      currentSMA: Number(S),
      timeframe: TF,
      smaPeriod: PERIOD
    }
  });
}

/**
 * Fallback analysis without pattern analysis
 */
function classifyMarketMoodFallback(rsi, smaSignal, bbSignal, priceData, coin) {
  let bullishScore = 0;
  let bearishScore = 0;
  
  // RSI scoring
  if (rsi < 30) bullishScore += 2;
  else if (rsi > 70) bearishScore += 2;
  else if (rsi >= 45 && rsi <= 55) bullishScore += 0.5;
  
  // SMA scoring
  if (smaSignal === 'BUY') bullishScore += 1.5;
  else if (smaSignal === 'SELL') bearishScore += 1.5;
  
  // BB scoring
  if (bbSignal === 'BUY') bullishScore += 1;
  else if (bbSignal === 'SELL') bearishScore += 1;
  
  // Price trend analysis
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
    reasoning: `Fallback analysis: bullish signals ${bullishScore.toFixed(1)}, bearish signals ${bearishScore.toFixed(1)}`,
    method: 'rule-based-fallback',
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
    
     // Get current price using the same validation as price endpoint
     let currentPrice = 45000; // Default fallback price for Bitcoin
     
     try {
       const priceResult = await getCachedPriceData(coinId, env);
       currentPrice = priceResult.data.price;
       
       // Validate the price is reasonable for Bitcoin
       if (coinId === 'bitcoin' && (currentPrice < 30000 || currentPrice > 150000)) {
         console.log(`⚠️ [OHLC] Invalid Bitcoin price: $${currentPrice}, using fallback`);
         currentPrice = 45000; // Use reasonable fallback price
       }
     } catch (error) {
       console.log(`⚠️ [OHLC] Failed to get price data: ${error.message}, using fallback`);
       currentPrice = 45000; // Use reasonable fallback price
     }
    
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
    // Debug: Check if secrets are accessible
    console.log('🔑 Environment check:');
    console.log(`- COHERE_API_KEY: ${env.COHERE_API_KEY ? 'SET' : 'NOT SET'}`);
    console.log(`- NEWSAPI_KEY: ${env.NEWSAPI_KEY ? 'SET' : 'NOT SET'}`);
    console.log(`- ENVIRONMENT: ${env.ENVIRONMENT || 'NOT SET'}`);
    
    // Enhanced CORS preflight handling with logging
    if (request.method === 'OPTIONS') {
      const origin = request.headers.get('Origin');
      console.log(`CORS preflight from origin: ${origin}`);
      return new Response(null, {
        status: 200,
        headers: {
          ...DEFAULT_CORS,
          'Cache-Control': 'no-store, max-age=0, must-revalidate',
          'Surrogate-Control': 'no-store',
          'Pragma': 'no-cache',
          'Expires': '0'
        },
      });
    }
    
    const url = new URL(request.url);
    const path = url.pathname;
    const origin = request.headers.get('Origin');
    const referer = request.headers.get('Referer');
    
    // Log GitHub Pages requests for debugging
    if (origin && (origin.includes('github.io') || origin.includes('hesam.me'))) {
      console.log(`Request from GitHub Pages: ${request.method} ${path} (Origin: ${origin})`);
    }
    
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
          console.log(`404 for path: ${path} from origin: ${origin || 'unknown'}`);
          return errorResponse('Not found', 404);
      }
      
    } catch (error) {
      console.error(`Worker error for ${path} from ${origin || 'unknown'}:`, error);
      return errorResponse('Internal server error', 500);
    }
  },
}; 
