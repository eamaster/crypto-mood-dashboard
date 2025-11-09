// =============================================================================
// Crypto Mood Dashboard - Cloudflare Worker
// Handles API calls to CoinCap, NewsAPI.org, and Cohere AI
// =============================================================================

// CORS headers for frontend requests - Enhanced for GitHub Pages compatibility
const DEFAULT_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, HEAD',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept, Origin, Referer, User-Agent, Cache-Control, Pragma',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Type, X-Cache-Status, X-DO-Age, X-Cache-Source, X-Latency-ms',
  'Access-Control-Max-Age': '86400', // 24 hours
  'Vary': 'Origin, Accept-Encoding'
};

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

  return new Response(typeof data === 'string' ? data : JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...DEFAULT_CORS,
      ...defaultCacheHeaders,
      ...extraHeaders // extraHeaders override defaults
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

// Write a per-asset backoff timestamp into KV (for CoinCap rate limiting)
async function setBackoff(kv, assetId, untilMs) {
  try {
    await kv.put(`backoff_${assetId}`, String(untilMs));
  } catch (e) {
    console.warn('Failed to set backoff KV:', e.message);
  }
}

async function getBackoff(kv, assetId) {
  try {
    const raw = await kv.get(`backoff_${assetId}`);
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isNaN(n) ? 0 : n;
  } catch (e) {
    console.warn('Failed to get backoff KV:', e.message);
    return 0;
  }
}

  // CoinCap API configuration
const COINCAP_API_BASE = 'https://api.coincap.io/v2';
const COINCAP_BATCH_ENDPOINT = `${COINCAP_API_BASE}/assets`; // supports ?ids=bitcoin,ethereum,...

// Helper to attach CoinCap API key for authenticated requests (500 rpm with Pro key)
function coinCapAuthHeaders(env) {
  const headers = { 
    'Accept': 'application/json',
    'User-Agent': 'Crypto-Mood-Dashboard/1.0 (Cloudflare Worker)'
  };
  if (env && env.COINCAP_API_KEY) {
    headers['Authorization'] = `Bearer ${env.COINCAP_API_KEY}`;
  } else {
    console.warn('[coinCapAuthHeaders] COINCAP_API_KEY not set, using unauthenticated requests');
  }
  return headers;
}

// rateLimitedFetch: coalescing + retries + per-asset backoff (improved diagnostics)
async function rateLimitedFetch(url, options = {}, env, assetId) {
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
    let lastError = null; // Track last error for diagnostics

    // If K/V says we must backoff, do not call upstream: return an object indicating backoff
    const now = Date.now();
    const backoffUntil = assetId ? await getBackoff(env.RATE_LIMIT_KV, assetId) : 0;
    if (backoffUntil && backoffUntil > now) {
      const waitMs = backoffUntil - now;
      console.warn(`[rateLimitedFetch] Backoff in effect for ${assetId}, ${Math.ceil(waitMs/1000)}s left`);
      // Throw a special error so callers can serve stale-if-error
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
        // Merge headers from options (includes auth headers)
        const fetchOptions = {
          ...options,
          method: options.method || 'GET',
          headers: { ...options.headers },
          cf: { cacheTtlByStatus: { "200-299": 60 }, cacheEverything: true }
        };
        const resp = await fetch(url, fetchOptions);

        // If success, return parsed Response-like object
        if (resp.status >= 200 && resp.status < 300) {
          const text = await resp.text();
          let json = null;
          try { json = JSON.parse(text); } catch (e) { /* not json */ }
          console.log(`[rateLimitedFetch] ✅ Success on attempt ${attempt}, latency=${Date.now() - attemptStart}ms`);
          return { ok: true, status: resp.status, text, json, latency: Date.now() - attemptStart };
        }

        // Handle Retry/429/5xx
        if (resp.status === 429) {
          const ra = parseRetryAfterHeader(resp.headers.get('retry-after'));
          // compute backoff until
          const baseMs = 1000 * Math.pow(2, attempt); // exponential
          const backoffMs = ra ?? jitter(Math.min(16000, baseMs));
          const until = Date.now() + backoffMs;
          if (assetId && env.RATE_LIMIT_KV) {
            await setBackoff(env.RATE_LIMIT_KV, assetId, until);
            console.warn(`[rateLimitedFetch] 429 received. Setting KV backoff for ${assetId} until ${new Date(until).toISOString()} (${Math.ceil(backoffMs/1000)}s)`);
          }
          lastError = { status: 429, message: 'Rate limited' };
          // Wait before retrying
          if (attempt < maxAttempts) {
            console.log(`[rateLimitedFetch] Waiting ${Math.ceil(backoffMs/1000)}s before retry...`);
            await new Promise(r => setTimeout(r, backoffMs));
          }
          continue;
        }

        if (resp.status >= 500 && resp.status < 600) {
          // HTTP 530 is a Cloudflare-specific error (origin timeout/DNS issues)
          // Use longer backoff for 530 since it often indicates transient connectivity issues
          const is530 = resp.status === 530;
          const baseBackoff = is530 ? 2000 : 500; // Longer initial backoff for 530
          const maxBackoff = is530 ? 16000 : 8000; // Longer max backoff for 530
          const backoffMs = jitter(Math.min(maxBackoff, baseBackoff * Math.pow(2, attempt)));
          
          lastError = { 
            status: resp.status, 
            message: is530 ? `Cloudflare error 530 (origin timeout/connection issue)` : `Server error ${resp.status}`,
            type: is530 ? 'Cloudflare/Origin' : 'HTTP'
          };
          
          console.warn(`[rateLimitedFetch] ${is530 ? '⚠️ Cloudflare' : '5xx'} error (${resp.status}), backing off ${Math.ceil(backoffMs/1000)}s`);
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
        // Network/DNS error - log with explicit message
        const isDNSError = err.name === 'TypeError' || err.message?.includes('fetch') || err.message?.includes('ENOTFOUND');
        if (isDNSError) {
          console.error(`[rateLimitedFetch] ⚠️ Network/DNS error on attempt ${attempt} for ${url}: ${err.name} - ${err.message}`);
        } else {
          console.warn(`[rateLimitedFetch] Network error on attempt ${attempt} for ${url}: ${err.message}`);
        }
        
        lastError = { 
          name: err.name, 
          message: err.message,
          type: isDNSError ? 'DNS/Network' : 'Fetch'
        };
        
        if (attempt < maxAttempts) {
          const backoffMs = jitter(Math.min(8000, 500 * Math.pow(2, attempt)));
          console.log(`[rateLimitedFetch] Waiting ${Math.ceil(backoffMs/1000)}s before retry (${maxAttempts - attempt} attempts left)...`);
          await new Promise(r => setTimeout(r, backoffMs));
        }
        continue;
      }
    }

    // exhausted retries - include last error details
    const errorDetails = lastError 
      ? `Last error: ${lastError.type || 'HTTP'} - ${lastError.message || lastError.status}`
      : 'No upstream response';
    
    // Special handling for 530 errors
    if (lastError && lastError.status === 530) {
      console.error(`[rateLimitedFetch] ❌ Exhausted ${maxAttempts} retries for ${url}. CoinCap API returned 530 (Cloudflare origin error).`);
      console.error(`[rateLimitedFetch] This typically means: 1) CoinCap API is temporarily unavailable, 2) Network connectivity issues, or 3) DNS resolution problems.`);
    } else {
      console.error(`[rateLimitedFetch] ❌ Exhausted ${maxAttempts} retries for ${url}. ${errorDetails}`);
    }
    
    const err = new Error(`exhausted-retries: ${errorDetails}`);
    err.code = 'retries_exhausted';
    err.details = errorDetails;
    err.lastError = lastError;
    err.is530 = lastError && lastError.status === 530;
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

// Supported cryptocurrencies mapping (CoinCap IDs)
const SUPPORTED_COINS = {
  'bitcoin': { id: 'bitcoin', name: 'Bitcoin', symbol: 'BTC', coincap_id: 'bitcoin' },
  'ethereum': { id: 'ethereum', name: 'Ethereum', symbol: 'ETH', coincap_id: 'ethereum' },
  'litecoin': { id: 'litecoin', name: 'Litecoin', symbol: 'LTC', coincap_id: 'litecoin' },
  'bitcoin-cash': { id: 'bitcoin-cash', name: 'Bitcoin Cash', symbol: 'BCH', coincap_id: 'bitcoin-cash' },
  'cardano': { id: 'cardano', name: 'Cardano', symbol: 'ADA', coincap_id: 'cardano' },
  'ripple': { id: 'ripple', name: 'Ripple', symbol: 'XRP', coincap_id: 'xrp' },
  'dogecoin': { id: 'dogecoin', name: 'Dogecoin', symbol: 'DOGE', coincap_id: 'dogecoin' },
  'polkadot': { id: 'polkadot', name: 'Polkadot', symbol: 'DOT', coincap_id: 'polkadot' },
  'chainlink': { id: 'chainlink', name: 'Chainlink', symbol: 'LINK', coincap_id: 'chainlink' },
  'stellar': { id: 'stellar', name: 'Stellar', symbol: 'XLM', coincap_id: 'stellar' },
  'monero': { id: 'monero', name: 'Monero', symbol: 'XMR', coincap_id: 'monero' },
  'tezos': { id: 'tezos', name: 'Tezos', symbol: 'XTZ', coincap_id: 'tezos' },
  'eos': { id: 'eos', name: 'EOS', symbol: 'EOS', coincap_id: 'eos' },
  'zcash': { id: 'zcash', name: 'Zcash', symbol: 'ZEC', coincap_id: 'zcash' },
  'dash': { id: 'dash', name: 'Dash', symbol: 'DASH', coincap_id: 'dash' },
  'solana': { id: 'solana', name: 'Solana', symbol: 'SOL', coincap_id: 'solana' },
};

// Fetch asset data from CoinCap (batched API call for one or more coins)
async function fetchAssetsBatch(idsCsv, env) {
  const url = `${COINCAP_BATCH_ENDPOINT}?ids=${encodeURIComponent(idsCsv)}`;
  const fetchOpts = {
    method: 'GET',
    headers: coinCapAuthHeaders(env),
    cf: { cacheTtlByStatus: { "200-299": 60 }, cacheEverything: true }
  };
  
  try {
    const raw = await rateLimitedFetch(url, fetchOpts, env, idsCsv.split(',')[0]); // use first coin for backoff tracking
    
    if (!raw || !raw.ok) {
      const body = raw?.text || JSON.stringify(raw?.json || {});
      console.error(`[fetchAssetsBatch] CoinCap API error ${raw?.status}:`, body);
      throw new Error(`CoinCap API error: ${raw?.status || 'no-response'} - ${body}`);
    }
    
    const data = raw.json || (raw.text ? JSON.parse(raw.text) : null);
    const items = (data && data.data) || [];
    
    // Build normalized map
    const resultMap = {};
    for (const it of items) {
      const price = Number(it.priceUsd || 0);
      const change24h = Number(it.changePercent24Hr || 0);
      const market_cap = Number(it.marketCapUsd || 0);
      const volume_24h = Number(it.volumeUsd24Hr || 0);
      
      resultMap[it.id.toLowerCase()] = {
        coin: it.id.toLowerCase(),
        price: Math.round(price * 100) / 100,
        change24h: Math.round(change24h * 100) / 100,
        market_cap,
        volume_24h,
        symbol: it.symbol || it.id.toUpperCase(),
        timestamp: new Date().toISOString(),
        source: 'coincap'
      };
    }
    
    console.log(`✅ [fetchAssetsBatch] Got ${items.length} assets from CoinCap`);
    return resultMap;
  } catch (err) {
    console.error(`❌ [fetchAssetsBatch] Failed:`, err.message);
    throw err;
  }
}

// Fetch historical data from CoinCap for a single coin
async function fetchAssetHistory(coinId, days, env) {
  // Choose interval: day if days >= 7, otherwise hourly
  const interval = days >= 7 ? 'd1' : 'h1';
  const end = Date.now();
  const start = end - (days * 24 * 60 * 60 * 1000);
  const url = `${COINCAP_API_BASE}/assets/${encodeURIComponent(coinId)}/history?interval=${encodeURIComponent(interval)}&start=${start}&end=${end}`;
  
  const fetchOpts = {
    method: 'GET',
    headers: coinCapAuthHeaders(env),
    cf: { cacheTtlByStatus: { "200-299": 60 }, cacheEverything: true }
  };
  
  try {
    console.log(`🚀 [fetchAssetHistory] Fetching ${days}-day history for ${coinId}`);
    const raw = await rateLimitedFetch(url, fetchOpts, env, coinId);
    
    if (!raw || !raw.ok) {
      const body = raw?.text || JSON.stringify(raw?.json || {});
      console.error(`[fetchAssetHistory] CoinCap history API error ${raw?.status}:`, body);
      throw new Error(`CoinCap history API error: ${raw?.status || 'no-response'} - ${body}`);
    }
    
    const data = raw.json || (raw.text ? JSON.parse(raw.text) : null);
    const points = (data && data.data) ? data.data.map(p => ({
      timestamp: new Date(Number(p.time)).toISOString(),
      price: Math.round(Number(p.priceUsd) * 100) / 100
    })) : [];
    
    if (points.length === 0) {
      throw new Error(`No history data returned for ${coinId}`);
    }
    
    console.log(`✅ [fetchAssetHistory] Got ${points.length} points for ${coinId}`);
    return {
      coin: coinId,
      prices: points,
      days,
      symbol: SUPPORTED_COINS[coinId]?.symbol || coinId.toUpperCase(),
      source: 'coincap',
      note: 'Real market data from CoinCap'
    };
  } catch (err) {
    console.error(`❌ [fetchAssetHistory] Failed:`, err.message);
    throw err;
  }
}

// Smart caching with background refresh for CoinCap API (with legacy CoinGecko purge)
async function getCachedPriceData(coinId, env) {
  const cacheKey = `price_${coinId}`;
  const now = Date.now();
  const CACHE_TTL = 10000; // 10 seconds fresh cache (faster updates)
  const MAX_STALE = 60000; // 1 minute max stale (shorter stale period)
  
  try {
    // Get cached data
    const cached = await env.RATE_LIMIT_KV.get(cacheKey);
    
    if (cached) {
      try {
        const { data, timestamp } = JSON.parse(cached);
        const age = now - timestamp;
        
        // 🔥 MIGRATION: Detect and purge legacy CoinGecko cache entries
        // This checks if cached data was from OLD CoinGecko API and deletes it
        // Then fetches FRESH data from NEW CoinCap API
        const source = data?.source;
        if (source === 'coingecko') {
          console.log(`🧹 [Migration] Found legacy CoinGecko cache for ${cacheKey}, deleting and forcing CoinCap refresh`);
          await env.RATE_LIMIT_KV.delete(cacheKey);
          return await fetchFreshPriceData(coinId, env); // ← This fetches from CoinCap!
        }
        
        // Relaxed validation: removed overly strict price bounds
        // Just check if price is positive
        if (!data || !data.price || data.price <= 0) {
          console.log(`⚠️ [Cache] Invalid cached price for ${coinId}: $${data?.price}, fetching fresh data`);
          await env.RATE_LIMIT_KV.delete(cacheKey);
          return await fetchFreshPriceData(coinId, env);
        }
        
        // Fresh cache - return immediately
        if (age <= CACHE_TTL) {
          console.log(`✅ [Cache] Fresh data for ${coinId} (age: ${age}ms, source: ${source})`);
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
      } catch (parseError) {
        // Corrupt cache entry - delete and fetch fresh
        console.warn(`[Cache] Failed to parse KV ${cacheKey}, deleting corrupt entry:`, parseError.message);
        await env.RATE_LIMIT_KV.delete(cacheKey);
        return await fetchFreshPriceData(coinId, env);
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
  const coincapId = SUPPORTED_COINS[coinId]?.coincap_id || coinId;
  
  try {
    console.log(`🔄 [Background] Refreshing price for ${coinId}`);
    const resultMap = await fetchAssetsBatch(coincapId, env);
    const priceData = resultMap[coincapId];
    
    if (!priceData) {
      console.error(`[Background] CoinCap missing coin data for ${coincapId}`);
      return;
    }
    
    const now = Date.now();
    // Update cache with current timestamp
    await env.RATE_LIMIT_KV.put(`price_${coinId}`, JSON.stringify({
      data: priceData,
      timestamp: now
    }));
    
    console.log(`✅ [Background] Updated cache for ${coinId}: $${priceData.price}`);
  } catch (error) {
    // Gracefully handle backoff errors
    if (error.code === 'backoff' || error.code === 'retries_exhausted') {
      console.warn(`[Background] Suppressed upstream error for ${coinId}: ${error.message}`);
      return;
    }
    console.log(`❌ [Background] Failed to refresh ${coinId}:`, error.message);
  }
}

async function fetchFreshPriceData(coinId, env) {
  const coincapId = SUPPORTED_COINS[coinId]?.coincap_id || coinId;
  
  try {
    console.log(`🚀 [Fresh] Fetching price for ${coinId} from CoinCap`);
    const resultMap = await fetchAssetsBatch(coincapId, env);
    const priceData = resultMap[coincapId];
    
    if (!priceData) {
      throw new Error(`No price data for ${coincapId} in CoinCap response`);
    }
    
    // Cache the fresh data
    await env.RATE_LIMIT_KV.put(`price_${coinId}`, JSON.stringify({
      data: priceData,
      timestamp: Date.now()
    }));
    
    console.log(`✅ [Fresh] Cached fresh price for ${coinId}: $${priceData.price}`);
    return { data: priceData, fromCache: false, fresh: true };
    
  } catch (error) {
    console.log(`❌ [Fresh] Failed to fetch ${coinId}:`, error.message);
    throw error;
  }
}

// History data caching functions (with legacy CoinGecko purge)
async function getCachedHistoryData(coinId, days, env) {
  const cacheKey = `history_${coinId}_${days}`;
  const now = Date.now();
  const CACHE_TTL = 10000; // 10 seconds fresh cache (faster updates)
  const MAX_STALE = 60000; // 1 minute max stale (shorter stale period)
  
  try {
    // Get cached data
    const cached = await env.RATE_LIMIT_KV.get(cacheKey);
    
    if (cached) {
      try {
        const { data, timestamp } = JSON.parse(cached);
        const age = now - timestamp;
        
        // 🔥 MIGRATION: Detect and purge legacy CoinGecko cache entries
        // This checks if cached data was from OLD CoinGecko API and deletes it
        // Then fetches FRESH data from NEW CoinCap API
        const source = data?.source;
        if (source === 'coingecko') {
          console.log(`🧹 [Migration] Found legacy CoinGecko history cache for ${cacheKey}, deleting and forcing CoinCap refresh`);
          await env.RATE_LIMIT_KV.delete(cacheKey);
          return await fetchFreshHistoryData(coinId, days, env); // ← This fetches from CoinCap!
        }
        
        // Relaxed validation: just check if we have valid price data
        if (!data || !data.prices || !Array.isArray(data.prices) || data.prices.length === 0) {
          console.log(`⚠️ [History Cache] Invalid cached history for ${coinId}, fetching fresh data`);
          await env.RATE_LIMIT_KV.delete(cacheKey);
          return await fetchFreshHistoryData(coinId, days, env);
        }
        
        if (age < CACHE_TTL) {
          console.log(`✅ [History Cache] Serving fresh cached data for ${coinId} (${age}ms old, source: ${source})`);
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
      } catch (parseError) {
        // Corrupt cache entry - delete and fetch fresh
        console.warn(`[History Cache] Failed to parse KV ${cacheKey}, deleting corrupt entry:`, parseError.message);
        await env.RATE_LIMIT_KV.delete(cacheKey);
        return await fetchFreshHistoryData(coinId, days, env);
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
  const coincapId = SUPPORTED_COINS[coinId]?.coincap_id || coinId;
  
  try {
    console.log(`🚀 [Fresh History] Fetching history for ${coinId} (${days} days) from CoinCap`);
    const historyData = await fetchAssetHistory(coincapId, days, env);
    
    // Cache the fresh data
    await env.RATE_LIMIT_KV.put(`history_${coinId}_${days}`, JSON.stringify({
      data: historyData,
      timestamp: Date.now()
    }));
    
    console.log(`✅ [Fresh History] Cached fresh history for ${coinId}: ${historyData.prices.length} points`);
    return { data: historyData, fromCache: false, fresh: true };
    
  } catch (error) {
    console.log(`❌ [Fresh History] Failed to fetch history for ${coinId}:`, error.message);
    throw error;
  }
}

async function refreshHistoryInBackground(coinId, days, env) {
  try {
    await fetchFreshHistoryData(coinId, days, env);
    console.log(`✅ [Background History] Refreshed history for ${coinId}`);
  } catch (error) {
    // Gracefully handle backoff errors
    if (error.code === 'backoff' || error.code === 'retries_exhausted') {
      console.warn(`[Background History] Suppressed upstream error for ${coinId}: ${error.message}`);
      return;
    }
    console.warn(`⚠️ [Background History] Failed to refresh ${coinId}: ${error.message}`);
  }
}

// Data validation helpers for CoinCap API
function validatePriceData(data) {
  if (!data || typeof data !== 'object') return false;
  if (typeof data.price !== 'number' || data.price <= 0) return false;
  if (typeof data.change24h !== 'number') return false;
  if (typeof data.symbol !== 'string') return false;
  return true;
}

function validateHistoryData(data) {
  if (!data || !data.prices || !Array.isArray(data.prices)) return false;
  if (data.prices.length === 0) return false;
  
  // Check if all price points have timestamp and price
  return data.prices.every(point => 
    point && 
    point.timestamp && 
    typeof point.price === 'number' && 
    point.price > 0
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
    const origin = request.headers.get('Origin');

    console.log(`Fetching price for ${coinId} from origin: ${origin || 'direct'}`);

    // allow mutation
    let force = isForceRefresh(request.url);

    // Safety: delete KV if ultra-old (48h). Non-blocking best-effort.
    const VERY_OLD_MS = 48 * 60 * 60 * 1000;
    try {
      await deleteIfVeryOld(env.RATE_LIMIT_KV, `price_${coinId}`, VERY_OLD_MS);
    } catch (e) {
      console.warn('[Price] deleteIfVeryOld error:', e.message);
    }

    // SHORT TTL: force refresh if cached entry older than SHORT_TTL_MS
    const SHORT_TTL_MS = 60 * 1000; // 60s (matches POP cache TTL)
    if (!force) {
      try {
        const raw = await env.RATE_LIMIT_KV.get(`price_${coinId}`);
        if (raw) {
          const parsed = JSON.parse(raw);
          const cachedTs = parsed.timestamp || parsed.data?.timestamp || 0;
          if (cachedTs && (Date.now() - cachedTs > SHORT_TTL_MS)) {
            console.log(`[Price] Cached price too old (${Math.floor((Date.now()-cachedTs)/1000)}s), will force refresh`);
            force = true;
          }
        }
      } catch (e) {
        console.warn('[Price] error reading KV for age check:', e.message);
        // don't fail - proceed without forcing
      }
    }

    // Fetch path
    let result;
    let stageStart = Date.now();
    if (force) {
      console.log(`[Price] Force refresh for ${coinId}`);
      // fetch fresh (this throws only if upstream fails)
      try {
        result = await fetchFreshPriceData(coinId, env);
      } catch (upErr) {
        // Upstream failed — try to serve stale if available, otherwise bubble error
        console.warn(`[Price] fetchFreshPriceData failed: ${upErr.message}`);
        try {
          // try to serve whatever cached data we have, but mark stale-if-error
          const raw = await env.RATE_LIMIT_KV.get(`price_${coinId}`);
          if (raw) {
            const parsed = JSON.parse(raw);
            // 🔥 MIGRATION: Never serve CoinGecko cache, even in stale-if-error
            const source = parsed?.data?.source || parsed?.source;
            if (source === 'coingecko') {
              console.warn('[Price] Refusing to serve stale CoinGecko cache, throwing error instead');
              throw upErr; // Don't serve old CoinGecko data
            }
            result = { data: parsed.data, fromCache: true, fresh: false, staleIfError: true };
            console.warn('[Price] Serving stale cached price after upstream failure (source: coincap)');
          } else {
            throw upErr; // no cached data
          }
        } catch (serveErr) {
          console.error('[Price] No cached data to fall back to:', serveErr.message);
          throw upErr; // bubble original upstream error to outer catch
        }
      }
    } else {
      // Use smart cache (may trigger background refresh)
      const beforeKV = Date.now();
      result = await getCachedPriceData(coinId, env);
      const afterKV = Date.now();
      console.log(`[Price] KV read latency: ${afterKV - beforeKV}ms`);
      // If getCachedPriceData somehow returned nothing, fetch fresh
      if (!result || !result.data) {
        console.log('[Price] getCachedPriceData returned no data, fetching fresh');
        result = await fetchFreshPriceData(coinId, env);
      }
    }
    const stageEnd = Date.now();

    // Prepare observability headers with POP caching
    const dataTs = result?.data?.timestamp ? new Date(result.data.timestamp).getTime() : null;
    const xdoage = dataTs ? String(Math.floor((Date.now() - dataTs) / 1000)) : '';
    const xcacheStatus = result.fromCache ? (result.fresh ? 'fresh' : (result.staleIfError ? 'stale-if-error' : 'stale')) : 'miss';
    const headers = {
      'Cache-Control': 's-maxage=60, max-age=0, must-revalidate',
      'X-Cache-Status': xcacheStatus,
      'X-Cache-Source': result.fromCache ? 'cache' : 'api',
      'X-DO-Age': xdoage,
      'X-Latency-ms': String(Date.now() - start)
    };

    console.log(`✅ [Price] Got price for ${coinId}: $${result.data.price} (fromCache=${!!result.fromCache}, age=${xdoage}s), totalLatency=${Date.now()-start}ms`);
    return jsonResponse(result.data, 200, headers);

  } catch (error) {
    // More informative error for client; include diagnostics
    console.error('❌ [Price] Error handling price request:', error);
    
    // Determine status code based on error type
    let status = 500;
    if (error.code === 'retries_exhausted') {
      status = 502; // Bad Gateway - upstream unreachable
    } else if (error.message && error.message.includes('CoinCap')) {
      status = 502;
    }
    
    // Include detailed error information
    const errorDetails = {
      error: 'Failed to fetch price data',
      code: error.code || 'unknown',
      details: error.details || error.message || 'unknown error',
      timestamp: new Date().toISOString()
    };
    
    // Add lastError details if available (for exhausted-retries)
    if (error.lastError) {
      errorDetails.diagnostic = {
        type: error.lastError.type || 'unknown',
        message: error.lastError.message,
        status: error.lastError.status
      };
      
      // Special message for 530 errors
      if (error.lastError.status === 530) {
        errorDetails.message = 'CoinCap API is experiencing connectivity issues (Cloudflare error 530). This is usually temporary. Please try again in a few moments.';
        errorDetails.retry_after = 60; // Suggest retry after 60 seconds
      }
    }
    
    return jsonResponse(errorDetails, status, { 
      'X-Client-Cache': 'no-store',
      'X-Error-Type': error.code || 'unknown',
      'Retry-After': error.lastError?.status === 530 ? '60' : undefined
    });
  }
}

async function handleHistory(request, env) {
  const start = Date.now();
  try {
    const url = new URL(request.url);
    const coinId = url.searchParams.get('coin') || 'bitcoin';
    const days = Math.min(parseInt(url.searchParams.get('days')) || 7, 30);
    
    if (!SUPPORTED_COINS[coinId]) {
      return errorResponse(`Unsupported coin: ${coinId}`);
    }
    
    // allow mutation
    let force = isForceRefresh(request.url);

    // Safety: delete KV if ultra-old
    const VERY_OLD_MS = 48 * 60 * 60 * 1000;
    try {
      await deleteIfVeryOld(env.RATE_LIMIT_KV, `history_${coinId}_${days}`, VERY_OLD_MS);
    } catch (e) {
      console.warn('[History] deleteIfVeryOld error:', e.message);
    }

    // SHORT TTL: force refresh if cached entry older than SHORT_TTL_MS
    const SHORT_TTL_MS = 60 * 1000; // 60s (matches POP cache TTL)
    if (!force) {
      try {
        const raw = await env.RATE_LIMIT_KV.get(`history_${coinId}_${days}`);
        if (raw) {
          const parsed = JSON.parse(raw);
          const cachedTs = parsed.timestamp || 0;
          if (cachedTs && (Date.now() - cachedTs > SHORT_TTL_MS)) {
            console.log(`[History] Cached history too old (${Math.floor((Date.now()-cachedTs)/1000)}s), will force refresh`);
            force = true;
          }
        }
      } catch (e) {
        console.warn('[History] error reading KV for age check:', e.message);
      }
    }
    
    // Fetch path
    let result;
    if (force) {
      console.log(`[History] Force refresh for ${coinId} (${days} days)`);
      try {
        result = await fetchFreshHistoryData(coinId, days, env);
      } catch (upErr) {
        console.warn(`[History] fetchFreshHistoryData failed: ${upErr.message}`);
        try {
          const raw = await env.RATE_LIMIT_KV.get(`history_${coinId}_${days}`);
          if (raw) {
            const parsed = JSON.parse(raw);
            // 🔥 MIGRATION: Never serve CoinGecko cache, even in stale-if-error
            const source = parsed?.data?.source || parsed?.source;
            if (source === 'coingecko') {
              console.warn('[History] Refusing to serve stale CoinGecko cache, throwing error instead');
              throw upErr; // Don't serve old CoinGecko data
            }
            result = { data: parsed.data, fromCache: true, fresh: false, staleIfError: true };
            console.warn('[History] Serving stale cached history after upstream failure (source: coincap)');
          } else {
            throw upErr;
          }
        } catch (serveErr) {
          console.error('[History] No cached data to fall back to:', serveErr.message);
          throw upErr;
        }
      }
    } else {
      const beforeKV = Date.now();
      result = await getCachedHistoryData(coinId, days, env);
      const afterKV = Date.now();
      console.log(`[History] KV read latency: ${afterKV - beforeKV}ms`);
      if (!result || !result.data) {
        console.log('[History] getCachedHistoryData returned no data, fetching fresh');
        result = await fetchFreshHistoryData(coinId, days, env);
      }
    }
    
    // Build observability headers with POP caching (use last price timestamp for age)
    const lastPrice = result.data.prices && result.data.prices.length > 0 ? result.data.prices[result.data.prices.length-1] : null;
    const dataTs = lastPrice?.timestamp ? new Date(lastPrice.timestamp).getTime() : null;
    const xdoage = dataTs ? String(Math.floor((Date.now() - dataTs) / 1000)) : '';
    const xcacheStatus = result.fromCache ? (result.fresh ? 'fresh' : (result.staleIfError ? 'stale-if-error' : 'stale')) : 'miss';
    const headers = {
      'Cache-Control': 's-maxage=60, max-age=0, must-revalidate',
      'X-Cache-Status': xcacheStatus,
      'X-Cache-Source': result.fromCache ? 'cache' : 'api',
      'X-DO-Age': xdoage,
      'X-Latency-ms': String(Date.now() - start)
    };
    
    console.log(`✅ [History] Got history for ${coinId} (${result.data.prices.length} points, fromCache=${!!result.fromCache}, age=${xdoage}s), totalLatency=${Date.now()-start}ms`);
    return jsonResponse(result.data, 200, headers);
    
  } catch (error) {
    console.error('❌ [History] Error handling history request:', error);
    
    // Determine status code based on error type
    let status = 500;
    if (error.code === 'retries_exhausted') {
      status = 502; // Bad Gateway - upstream unreachable
    } else if (error.message && error.message.includes('CoinCap')) {
      status = 502;
    }
    
    // Include detailed error information
    const errorDetails = {
      error: 'Failed to fetch price history',
      code: error.code || 'unknown',
      details: error.details || error.message || 'unknown error',
      timestamp: new Date().toISOString()
    };
    
    // Add lastError details if available (for exhausted-retries)
    if (error.lastError) {
      errorDetails.diagnostic = {
        type: error.lastError.type || 'unknown',
        message: error.lastError.message,
        status: error.lastError.status
      };
      
      // Special message for 530 errors
      if (error.lastError.status === 530) {
        errorDetails.message = 'CoinCap API is experiencing connectivity issues (Cloudflare error 530). This is usually temporary. Please try again in a few moments.';
        errorDetails.retry_after = 60; // Suggest retry after 60 seconds
      }
    }
    
    return jsonResponse(errorDetails, status, { 
      'X-Client-Cache': 'no-store',
      'X-Error-Type': error.code || 'unknown',
      'Retry-After': error.lastError?.status === 530 ? '60' : undefined
    });
  }
}

// Generate realistic fallback historical data when CoinCap is unavailable
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
    note: 'Simulated market data (CoinCap temporarily unavailable)'
  });
}

// Generate realistic fallback price data when CoinCap is unavailable
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
    note: 'Simulated market data (CoinCap temporarily unavailable)'
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
      // Admin endpoint: Purge legacy CoinGecko cache (protected with ADMIN_PURGE_TOKEN)
      if (path === '/admin/purge-legacy-cache' && request.method === 'POST') {
        try {
          const body = await request.json().catch(() => ({}));
          
          // Validate admin token
          if (!env.ADMIN_PURGE_TOKEN || body.token !== env.ADMIN_PURGE_TOKEN) {
            console.warn('[Admin] Unauthorized purge attempt');
            return new Response(JSON.stringify({ error: 'Forbidden - invalid or missing token' }), {
              status: 403,
              headers: { 
                'Content-Type': 'application/json',
                ...DEFAULT_CORS
              }
            });
          }
          
          console.log('[Admin] 🧹 Starting legacy cache purge...');
          console.log('[Admin] This deletes OLD CoinGecko cache and forces fresh CoinCap data');
          const deleted = [];
          const errors = [];
          
          // Purge price cache for all supported coins
          // NOTE: This scans for OLD cache entries with source="coingecko" and DELETES them
          // After deletion, normal requests will fetch FRESH data from CoinCap API
          for (const coin of Object.keys(SUPPORTED_COINS)) {
            const priceKey = `price_${coin}`;
            try {
              const raw = await env.RATE_LIMIT_KV.get(priceKey);
              if (raw) {
                try {
                  const parsed = JSON.parse(raw);
                  const source = parsed?.data?.source || parsed?.source;
                  // Check if this is OLD CoinGecko data → DELETE it
                  if (source === 'coingecko') {
                    await env.RATE_LIMIT_KV.delete(priceKey);
                    deleted.push(priceKey);
                    console.log(`[Admin] ❌ Deleted legacy CoinGecko price cache: ${priceKey}`);
                  }
                } catch (parseErr) {
                  // Corrupt entry - delete it anyway
                  await env.RATE_LIMIT_KV.delete(priceKey);
                  deleted.push(`${priceKey} (corrupt)`);
                  console.log(`[Admin] ❌ Deleted corrupt cache: ${priceKey}`);
                }
              }
            } catch (err) {
              errors.push({ key: priceKey, error: err.message });
              console.error(`[Admin] Error processing ${priceKey}:`, err.message);
            }
            
            // Purge history cache for common day values
            // NOTE: Same logic - check for OLD CoinGecko data and DELETE it
            for (const days of [1, 7, 30]) {
              const historyKey = `history_${coin}_${days}`;
              try {
                const raw = await env.RATE_LIMIT_KV.get(historyKey);
                if (raw) {
                  try {
                    const parsed = JSON.parse(raw);
                    const source = parsed?.data?.source || parsed?.source;
                    // Check if this is OLD CoinGecko data → DELETE it
                    if (source === 'coingecko') {
                      await env.RATE_LIMIT_KV.delete(historyKey);
                      deleted.push(historyKey);
                      console.log(`[Admin] ❌ Deleted legacy CoinGecko history cache: ${historyKey}`);
                    }
                  } catch (parseErr) {
                    // Corrupt entry - delete it anyway
                    await env.RATE_LIMIT_KV.delete(historyKey);
                    deleted.push(`${historyKey} (corrupt)`);
                    console.log(`[Admin] ❌ Deleted corrupt cache: ${historyKey}`);
                  }
                }
              } catch (err) {
                errors.push({ key: historyKey, error: err.message });
                console.error(`[Admin] Error processing ${historyKey}:`, err.message);
              }
            }
          }
          
          const result = {
            status: 'completed',
            deleted: deleted.length,
            keys: deleted,
            errors: errors.length > 0 ? errors : undefined,
            timestamp: new Date().toISOString()
          };
          
          console.log(`[Admin] ✅ Purge completed: ${deleted.length} keys deleted, ${errors.length} errors`);
          
          return jsonResponse(result);
          
        } catch (err) {
          console.error('[Admin] Purge endpoint error:', err);
          return errorResponse(`Admin operation failed: ${err.message}`, 500);
        }
      }
      
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
