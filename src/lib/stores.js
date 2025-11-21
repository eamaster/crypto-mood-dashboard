import { writable, readable } from 'svelte/store';
import { WORKER_URL } from './config.js';

// Initial state
const initialState = {
    coins: [],
    selectedCoin: 'bitcoin',
    priceData: null,
    historyData: null,
    newsData: null,
    loading: true,
    error: null,
    largePatch: null // { diffAbs, diffPct, priceSource } when patch is large
};

// Create the store
const { subscribe, set, update } = writable(initialState);

// Per-coin cached results (live in-memory). Keeps last successful payload so throttle can return it.
const _lastPriceFetch = new Map();    // coinId -> { ts, data }
const _lastHistoryFetch = new Map();  // coinId_days -> { ts, data }
const THROTTLE_MS = 8000; // 8s

// Price patching thresholds for quiet logging
const PRICE_PATCH_ABS_THRESHOLD = 1.00;   // only log patches > $1.00
const PRICE_PATCH_PCT_THRESHOLD = 0.5;    // or > 0.5% difference
const LARGE_PATCH_ABS_THRESHOLD = 50.00;  // banner threshold: > $50
const LARGE_PATCH_PCT_THRESHOLD = 1.0;    // banner threshold: > 1.0%

// Helper function to format price for display
function formatPriceForLog(price) {
    return Number(price).toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

// Robust fetch with timeout and clear timeout correctly
async function fetchWithTimeout(url, opts = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const signal = controller.signal;
    let timeoutId = null;

    try {
        const mergedOpts = { cache: 'no-store', ...opts, signal };
        timeoutId = setTimeout(() => {
            controller.abort(new DOMException('Request timed out', 'AbortError'));
        }, timeoutMs);

        const res = await fetch(url, mergedOpts);
        clearTimeout(timeoutId);

        // Convert non-2xx to an error with body text for easier debugging
        if (!res.ok) {
            let bodyText = '';
            try { bodyText = await res.text(); } catch (e) { bodyText = String(e); }
            const err = new Error(`HTTP ${res.status}: ${bodyText}`);
            err.status = res.status;
            err.body = bodyText;
            throw err;
        }

        // Parse JSON safely but return both text/json in case caller wants raw
        const text = await res.text().catch(() => '');
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
        return { ok: true, status: res.status, text, json, headers: res.headers };
    } catch (err) {
        // Normalize AbortError so callers can detect it
        if (err.name === 'AbortError' || err instanceof DOMException) {
            const abortErr = new Error('AbortError: request aborted or timed out');
            abortErr.name = 'AbortError';
            throw abortErr;
        }
        throw err;
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
}

// Helper functions to fetch data
const fetchCoins = async () => {
    try {
        const res = await fetchWithTimeout(`${WORKER_URL}/coins`, { method: 'GET' });
        const coins = res.json ?? JSON.parse(res.text || '[]');
        if (!validateCoins(coins)) {
            throw new Error('Invalid coins data');
        }
        return coins;
    } catch (error) {
        console.error('Error fetching coins:', error);
        return [];
    }
};

// Normalize and validate price response (accepts ISO or epoch timestamps)
function normalizePriceResponse(resp) {
    // resp: the parsed JSON from /price
    if (!resp || typeof resp !== 'object') {
        throw new Error('Invalid price data: empty response');
    }

    // Price check: accept numeric or numeric-string
    const priceNumeric = Number(resp.price);
    if (!Number.isFinite(priceNumeric) || priceNumeric <= 0) {
        throw new Error(`Invalid price data: price not numeric or <=0 (price=${resp.price})`);
    }

    // Timestamp normalization: accept timestampMs (number) or timestampIso (string)
    let tsMs = null;
    if (typeof resp.timestampMs === 'number' && Number.isFinite(resp.timestampMs)) {
        tsMs = resp.timestampMs;
    } else if (typeof resp.timestampIso === 'string') {
        const parsed = Date.parse(resp.timestampIso);
        if (!Number.isFinite(parsed)) {
            throw new Error(`Invalid price data: timestampIso unparseable (timestampIso=${resp.timestampIso})`);
        }
        tsMs = parsed;
    } else if (typeof resp.timestamp === 'number') {
        tsMs = resp.timestamp; // backward compatibility (epoch ms)
    } else if (typeof resp.timestamp === 'string') {
        const p = Date.parse(resp.timestamp);
        if (!Number.isFinite(p)) {
            throw new Error(`Invalid price data: timestamp unparseable (timestamp=${resp.timestamp})`);
        }
        tsMs = p;
    } else {
        // No timestamp provided — that's acceptable but log as warning and continue
        console.warn('[store] Price response has no timestamp; proceeding but this is less robust.');
        tsMs = Date.now();
    }

    // priceFmt canonical (use server-provided or compute)
    const priceFmt = resp.priceFmt || Number(priceNumeric).toFixed(2);

    // change24h: accept server-provided or null (client will compute if null)
    const change24h = (typeof resp.change24h === 'number' && Number.isFinite(resp.change24h)) ? Number(resp.change24h) : null;
    const changeFmt = resp.changeFmt || (change24h != null ? Number(change24h).toFixed(2) : null);

    return {
        coin: resp.coin,
        price: priceNumeric, // numeric for compatibility
        priceNumeric: priceNumeric,
        priceFmt: priceFmt,
        timestampMs: Number(tsMs),
        timestampIso: new Date(tsMs).toISOString(),
        source: resp.source || resp.priceSource || 'unknown',
        symbol: resp.symbol || resp.coin?.toUpperCase().substring(0, 3) || 'BTC',
        change24h: change24h, // numeric or null (client will compute if null)
        changeFmt: changeFmt, // string formatted to 2 decimals or null
        raw: resp
    };
}

// Helper function to compute percent change from two numerics
function computeChangePercent(currentPrice, prevClose) {
    if (!Number.isFinite(currentPrice) || !Number.isFinite(prevClose) || prevClose === 0) {
        return null;
    }
    return ((currentPrice - prevClose) / prevClose) * 100;
}

const fetchPrice = async (coinId) => {
    const url = `${WORKER_URL}/price?coin=${encodeURIComponent(coinId)}&_=${Date.now()}`;
    try {
        console.log(`🔍 Fetching canonical price for ${coinId}`);
        const res = await fetchWithTimeout(url, { method: 'GET', credentials: 'omit' }, 15000); // 15s timeout for safety
        console.log(`📊 Price response: ${res.status}, headers:`, {
            cache: res.headers.get('cache-control'),
            xcache: res.headers.get('X-Cache-Status'),
            xsource: res.headers.get('X-Cache-Source'),
            xdoage: res.headers.get('X-DO-Age'),
            xlat: res.headers.get('X-Latency-ms')
        });

        const data = res.json ?? JSON.parse(res.text || '{}');

        // Normalize and validate price response
        try {
            const normalized = normalizePriceResponse(data);
            console.log(`✅ Fetched canonical price: $${normalized.priceFmt} (source: ${normalized.source}, timestampMs: ${normalized.timestampMs})`);

            // Update cache with normalized data
            _lastPriceFetch.set(coinId, { ts: Date.now(), data: normalized });
            return normalized;
        } catch (normErr) {
            console.error(`❌ Invalid price data: reason=${normErr.message}, details:`, data);
            throw new Error(`Price validation failed: ${normErr.message}`);
        }
    } catch (err) {
        if (err.name === 'AbortError') {
            console.warn('fetchPrice aborted:', err.message);
            throw err;
        }
        console.error(`❌ Error fetching price for ${coinId}:`, err);
        throw err;
    }
};

// Throttled wrapper for fetchPrice (returns cached data instead of throwing)
const fetchPriceThrottled = async (coinId, force = false) => {
    const now = Date.now();
    const last = _lastPriceFetch.get(coinId);
    const MAX_CACHE_AGE_MS = 5 * 60 * 1000; // 5 minutes - never return data older than this

    if (!force && last && (now - last.ts) < THROTTLE_MS) {
        // Check if cached data is not too old
        if (last.data && last.data.timestampMs) {
            const dataAge = now - last.data.timestampMs;
            if (dataAge > MAX_CACHE_AGE_MS) {
                console.warn(`⚠️ Cached price for ${coinId} is too old (${Math.floor(dataAge / 1000)}s), refetching...`);
                // Don't use cache - fall through to fetch
            } else {
                console.log(`⏱️ Client throttle: returning cached price for ${coinId}`);
                return last.data;
            }
        } else {
            console.log(`⏱️ Client throttle: returning cached price for ${coinId}`);
            return last.data;
        }
    }

    try {
        const data = await fetchPrice(coinId);
        return data;
    } catch (err) {
        // If we have a cached value that's not too old, return it instead of throwing
        if (last && last.data) {
            const dataAge = last.data.timestampMs ? (now - last.data.timestampMs) : (now - last.ts);
            if (dataAge < MAX_CACHE_AGE_MS) {
                console.warn(`fetchPriceThrottled: upstream failed, returning cached data for ${coinId} (age: ${Math.floor(dataAge / 1000)}s)`, err.message);
                return last.data;
            } else {
                console.error(`fetchPriceThrottled: upstream failed and cache too old (${Math.floor(dataAge / 1000)}s), propagating error for ${coinId}`);
                throw err;
            }
        }
        // No cached data: propagate error so UI shows network error
        throw err;
    }
};

const fetchHistory = async (coinId, days = 7) => {
    const url = `${WORKER_URL}/history?coin=${encodeURIComponent(coinId)}&days=${days}&_=${Date.now()}`;
    try {
        console.log(`🔍 Fetching history for ${coinId}`);
        const res = await fetchWithTimeout(url, { method: 'GET', credentials: 'omit' }, 20000); // 20s timeout for safety
        console.log(`📊 History response: ${res.status}, headers:`, {
            cache: res.headers.get('cache-control'),
            xcache: res.headers.get('X-Cache-Status'),
            xsource: res.headers.get('X-Cache-Source'),
            xdoage: res.headers.get('X-DO-Age'),
            xlat: res.headers.get('X-Latency-ms')
        });

        const data = res.json ?? JSON.parse(res.text || '{}');
        console.log(`✅ History data received:`, data);

        if (!data || !Array.isArray(data.prices)) {
            throw new Error('Invalid history payload');
        }

        const historyData = data.prices.map(item => ({
            x: new Date(item.timestamp),
            y: item.price
        }));

        if (!validateHistory(historyData)) {
            console.error(`❌ Invalid history data after transformation:`, historyData);
            throw new Error('Invalid history data');
        }

        // Update cache
        _lastHistoryFetch.set(`${coinId}_${days}`, { ts: Date.now(), data: historyData });
        return historyData;
    } catch (err) {
        if (err.name === 'AbortError') {
            console.warn('fetchHistory aborted:', err.message);
            throw err;
        }
        console.error(`❌ Error fetching history for ${coinId}:`, err);
        throw err;
    }
};

// Throttled wrapper for fetchHistory (returns cached data instead of throwing)
const fetchHistoryThrottled = async (coinId, days = 7, force = false) => {
    const key = `${coinId}_${days}`;
    const now = Date.now();
    const last = _lastHistoryFetch.get(key);
    const MAX_CACHE_AGE_MS = 5 * 60 * 1000; // 5 minutes - never return data older than this

    if (!force && last && (now - last.ts) < THROTTLE_MS) {
        // Check if cached data is not too old (use most recent data point timestamp)
        if (last.data && Array.isArray(last.data) && last.data.length > 0) {
            const lastPoint = last.data[last.data.length - 1];
            if (lastPoint.x instanceof Date) {
                const dataAge = now - lastPoint.x.getTime();
                if (dataAge > MAX_CACHE_AGE_MS) {
                    console.warn(`⚠️ Cached history for ${coinId} is too old (${Math.floor(dataAge / 1000)}s), refetching...`);
                    // Don't use cache - fall through to fetch
                } else {
                    console.log(`⏱️ Client throttle: returning cached history for ${coinId}`);
                    return last.data;
                }
            } else {
                console.log(`⏱️ Client throttle: returning cached history for ${coinId}`);
                return last.data;
            }
        } else {
            console.log(`⏱️ Client throttle: returning cached history for ${coinId}`);
            return last.data;
        }
    }

    try {
        const data = await fetchHistory(coinId, days);
        return data;
    } catch (err) {
        // If we have a cached value that's not too old, return it instead of throwing
        if (last && last.data) {
            let dataAge = now - last.ts;
            // Try to get more accurate age from data timestamp if available
            if (Array.isArray(last.data) && last.data.length > 0) {
                const lastPoint = last.data[last.data.length - 1];
                if (lastPoint.x instanceof Date) {
                    dataAge = now - lastPoint.x.getTime();
                }
            }

            if (dataAge < MAX_CACHE_AGE_MS) {
                console.warn(`fetchHistoryThrottled: upstream failed, returning cached history for ${key} (age: ${Math.floor(dataAge / 1000)}s)`, err.message);
                return last.data;
            } else {
                console.error(`fetchHistoryThrottled: upstream failed and cache too old (${Math.floor(dataAge / 1000)}s), propagating error for ${key}`);
                throw err;
            }
        }
        // No cached data: propagate error so UI shows network error
        throw err;
    }
};

// Fetch OHLC data from worker (includes canonical lastClosePrice)
const fetchOHLC = async (coinId, days = 7) => {
    const url = `${WORKER_URL}/ohlc?coin=${encodeURIComponent(coinId)}&days=${days}&_=${Date.now()}`;
    try {
        console.log(`🔍 Fetching OHLC data for ${coinId} (${days} days)`);
        const res = await fetchWithTimeout(url, { method: 'GET', credentials: 'omit' }, 15000);
        const data = res.json ?? JSON.parse(res.text || '{}');

        if (!data || !Array.isArray(data.ohlc)) {
            throw new Error('Invalid OHLC payload');
        }

        console.log(`✅ OHLC data received: ${data.ohlc.length} candles, lastClosePrice=${data.lastClosePrice}, priceSource=${data.priceSource || 'unknown'}`);
        return data;
    } catch (err) {
        if (err.name === 'AbortError') {
            console.warn('fetchOHLC aborted:', err.message);
            throw err;
        }
        console.error(`❌ Error fetching OHLC for ${coinId}:`, err);
        throw err;
    }
};

const fetchNews = async (coinId) => {
    const url = `${WORKER_URL}/news?coin=${encodeURIComponent(coinId)}&_=${Date.now()}`;
    try {
        const res = await fetchWithTimeout(url, { method: 'GET', credentials: 'omit' }, 5000); // Reduced to 5s - non-critical
        const data = res.json ?? JSON.parse(res.text || '{}');
        if (!validateNews(data)) {
            throw new Error('Invalid news data');
        }
        return data;
    } catch (error) {
        console.warn(`News fetch failed for ${coinId} (non-critical):`, error.message);
        // Return null instead of throwing - news is optional
        return null;
    }
};

// Per-coin sentiment cache (for throttling)
const _lastSentimentFetch = new Map(); // coinId -> { ts, data }

// Fetch canonical sentiment summary from worker
const fetchSentimentSummary = async (coinId, force = false) => {
    // Throttle: return cached if within THROTTLE_MS (unless force)
    if (!force && _lastSentimentFetch.has(coinId)) {
        const cached = _lastSentimentFetch.get(coinId);
        const age = Date.now() - cached.ts;
        if (age < THROTTLE_MS) {
            console.log(`[fetchSentimentSummary] Returning throttled cache for ${coinId} (age: ${Math.floor(age / 1000)}s)`);
            return cached.data;
        }
    }

    const url = `${WORKER_URL}/api/sentiment-summary?coin=${encodeURIComponent(coinId)}${force ? '&force=true' : ''}&_=${Date.now()}`;
    try {
        console.log(`🔍 Fetching sentiment summary for ${coinId}`);
        const res = await fetchWithTimeout(url, {
            method: 'GET',
            cache: 'no-store'
        }, 10000); // 10s timeout for sentiment
        const data = res.json ?? JSON.parse(res.text || '{}');

        // Validate response structure
        if (!data || typeof data.score !== 'number' || !data.label) {
            throw new Error('Invalid sentiment summary data');
        }

        // Cache result
        _lastSentimentFetch.set(coinId, { ts: Date.now(), data });
        console.log(`✅ Sentiment summary received for ${coinId}: score=${data.score}, label=${data.label}, source=${data.source}`);
        return data;
    } catch (error) {
        console.warn('Sentiment summary fetch failed (non-critical):', error.message);
        // Return cached data if available (even if stale)
        if (_lastSentimentFetch.has(coinId)) {
            const cached = _lastSentimentFetch.get(coinId);
            console.log(`⚠️ Using cached sentiment for ${coinId} due to fetch failure`);
            return cached.data;
        }
        return null; // Sentiment is optional, return null on failure
    }
};

// Throttled wrapper for sentiment fetch
const fetchSentimentThrottled = async (coinId, force = false) => {
    return fetchSentimentSummary(coinId, force);
};

// Legacy fetchSentiment for backward compatibility (maps to new endpoint)
const fetchSentiment = async (headlines) => {
    // This is deprecated - use fetchSentimentSummary instead
    // But keep for backward compatibility with old code
    console.warn('fetchSentiment(headlines) is deprecated - use fetchSentimentSummary(coinId) instead');
    return null;
};

// Function to initialize the store (optimized for fast initial load)
export const initStore = async () => {
    update(state => ({ ...state, loading: true, error: null }));

    // Fetch coins first (required for UI)
    const coins = await fetchCoins();
    const selectedCoin = coins.find(c => c.id === 'bitcoin') ? 'bitcoin' : (coins[0]?.id || 'bitcoin');

    // Set coins immediately so UI can render
    update(state => ({ ...state, coins, selectedCoin }));

    try {
        // Fetch price and history in parallel (critical data)
        const pricePromise = fetchPriceThrottled(selectedCoin, true);
        const historyPromise = fetchHistoryThrottled(selectedCoin, 7, true);

        const settled = await Promise.allSettled([pricePromise, historyPromise]);

        const priceResult = settled[0];
        const historyResult = settled[1];

        let priceData = null;
        let historyData = null;

        if (priceResult.status === 'fulfilled') {
            priceData = priceResult.value;
        } else {
            console.error('Price fetch failed:', priceResult.reason?.message || priceResult.reason);
        }

        if (historyResult.status === 'fulfilled') {
            historyData = historyResult.value;
        } else {
            console.error('History fetch failed:', historyResult.reason?.message || historyResult.reason);
        }

        // CANONICAL PRICE RECONCILIATION: Ensure history last point uses canonical price
        // Only reconcile if price normalization succeeded
        let largePatch = null;
        if (priceData && priceData.priceNumeric && historyData && Array.isArray(historyData) && historyData.length > 0) {
            const canonicalPrice = priceData.priceNumeric; // use normalized price
            const canonicalPriceFmt = priceData.priceFmt || Number(canonicalPrice).toFixed(2);
            const lastPoint = historyData[historyData.length - 1];
            const lastClose = Number(lastPoint.y);
            const lastCloseFmt = Number(lastClose).toFixed(2);

            // Format to 2 decimals for comparison
            if (canonicalPriceFmt !== lastCloseFmt) {
                // Calculate difference metrics
                const diffAbs = Math.abs(canonicalPrice - lastClose);
                const diffPct = lastClose > 0 ? Math.abs((canonicalPrice - lastClose) / lastClose) * 100 : 0;
                const canonicalTimestampMs = priceData.timestampMs || Date.now();

                // Only log detailed patch messages when difference is meaningful
                if (diffAbs > PRICE_PATCH_ABS_THRESHOLD || diffPct > PRICE_PATCH_PCT_THRESHOLD) {
                    console.warn(`[store] Price/history mismatch: canonicalPrice=${formatPriceForLog(canonicalPrice)} lastClose=${formatPriceForLog(lastClose)} -> patching last point (diff=${formatPriceForLog(diffAbs)}, ${diffPct.toFixed(2)}%)`);
                } else {
                    console.debug(`[store] Minor price mismatch: patching last point (diff=${formatPriceForLog(diffAbs)})`);
                }

                // Replace last point close with canonical price (keep timestamp)
                historyData[historyData.length - 1] = { x: lastPoint.x, y: canonicalPrice };
                // Update cache with modified history so throttling returns consistent data
                _lastHistoryFetch.set(`${selectedCoin}_7`, { ts: Date.now(), data: historyData });

                // Log confirmation only for material diffs
                if (diffAbs > PRICE_PATCH_ABS_THRESHOLD || diffPct > PRICE_PATCH_PCT_THRESHOLD) {
                    console.info(`[store] Patched history last point to canonical price: ${formatPriceForLog(canonicalPrice)}`);
                }

                // Track large patches for UI banner
                if (diffAbs > LARGE_PATCH_ABS_THRESHOLD || diffPct > LARGE_PATCH_PCT_THRESHOLD) {
                    largePatch = {
                        diffAbs: diffAbs,
                        diffPct: diffPct,
                        priceSource: priceData.source || 'unknown'
                    };
                }
            } else {
                console.log(`✅ [store] Price consistency verified: canonicalPrice=$${canonicalPriceFmt} matches history lastClose=$${lastCloseFmt}`);
            }
        } else if (priceData && !priceData.priceNumeric) {
            console.warn(`[store] Price data missing priceNumeric, skipping reconciliation`);
        }

        // COMPUTE change24h if server didn't provide it
        if (priceData && priceData.priceNumeric && priceData.change24h == null) {
            let lastClose = null;

            // Try to fetch OHLC data to get lastClosePriceNumeric
            try {
                const ohlcData = await fetchOHLC(selectedCoin, 7);
                if (ohlcData && typeof ohlcData.lastClosePriceNumeric === 'number') {
                    lastClose = ohlcData.lastClosePriceNumeric;
                    console.log(`[store] Using OHLC lastClosePriceNumeric=${lastClose} for change24h computation`);
                }
            } catch (ohlcErr) {
                console.warn(`[store] Failed to fetch OHLC for change24h computation:`, ohlcErr.message);
            }

            // Fallback to history's second-to-last point if OHLC not available
            if (lastClose == null && historyData && Array.isArray(historyData) && historyData.length >= 2) {
                lastClose = historyData[historyData.length - 2].y; // previous day
                console.log(`[store] Using history second-to-last point=${lastClose} for change24h computation`);
            }

            // Compute change24h if we have a previous close
            if (lastClose != null) {
                const computedChange = computeChangePercent(priceData.priceNumeric, lastClose);
                if (computedChange != null) {
                    priceData.change24h = computedChange;
                    priceData.changeFmt = Number(computedChange).toFixed(2);
                    console.log(`[store] Computed change24h=${priceData.changeFmt}% from lastClose=${lastClose}`);
                } else {
                    console.warn(`[store] Could not compute change24h (invalid prevClose=${lastClose}). Using 0.00 fallback.`);
                    priceData.change24h = 0;
                    priceData.changeFmt = '0.00';
                }
            } else {
                // Final fallback: set to 0 but log warning
                console.warn(`[store] Could not compute change24h (no OHLC/history prev close). Using 0.00 fallback.`);
                priceData.change24h = 0;
                priceData.changeFmt = '0.00';
            }
        }

        // Fallback: If price failed but history succeeded, extract latest price from history
        // Only use fallback if price normalization truly failed (not just format differences)
        if (!priceData && historyData && historyData.length > 0) {
            const latestHistory = historyData[historyData.length - 1];
            const previousHistory = historyData.length > 1 ? historyData[historyData.length - 2] : latestHistory;
            const changePercent = previousHistory ? ((latestHistory.y - previousHistory.y) / previousHistory.y) * 100 : 0;

            // Use coins list from the closure (already fetched above)
            const coinInfo = coins.find(c => c.id === selectedCoin);
            const symbol = coinInfo?.symbol || selectedCoin.toUpperCase().substring(0, 3);

            const fallbackPrice = latestHistory.y;
            priceData = {
                price: fallbackPrice,
                priceNumeric: fallbackPrice,
                priceFmt: Number(fallbackPrice).toFixed(2),
                change24h: changePercent,
                symbol: symbol,
                source: 'history-fallback',
                timestampMs: latestHistory.x.getTime(),
                timestampIso: latestHistory.x.toISOString(),
                fallback: true // Mark as fallback data
            };
            console.warn('⚠️ Using history data as price fallback (canonical price fetch failed):', priceData);
        }

        // Update UI immediately with price/history (non-blocking)
        update(state => ({
            ...state,
            priceData,
            historyData,
            largePatch: largePatch, // Include large patch info for UI banner
            loading: false,
            error: (!priceData && !historyData) ? 'Failed to load price data' : null
        }));

        // Fetch sentiment in background (non-blocking, async) using canonical endpoint
        // This happens after UI is rendered to improve perceived load time
        // Use setTimeout to defer even further - don't start immediately
        setTimeout(() => {
            // Fetch sentiment summary directly (includes headlines)
            fetchSentimentThrottled(selectedCoin, false)
                .then(sentimentData => {
                    if (sentimentData) {
                        // Update state with sentiment data
                        // Note: sentimentData includes headlines, so we can use it for newsData too
                        update(state => ({
                            ...state,
                            newsData: {
                                headlines: sentimentData.headlines || [],
                                sentiment: {
                                    score: sentimentData.score,
                                    category: sentimentData.label.toLowerCase(),
                                    label: sentimentData.label,
                                    source: sentimentData.source,
                                    count: sentimentData.count,
                                    timestamp: sentimentData.timestamp,
                                    summary: sentimentData.summary || []
                                }
                            }
                        }));
                    }
                })
                .catch(sentimentErr => {
                    console.warn('Sentiment fetch failed (non-critical):', sentimentErr.message);
                    // Don't update state - sentiment is optional
                });
        }, 500); // Defer by 500ms to let critical data render first

    } catch (error) {
        console.error('❌ Failed to initialize store:', error);
        update(state => ({
            ...state,
            priceData: null,
            historyData: null,
            newsData: null,
            loading: false,
            error: error.message || 'Failed to load data'
        }));
    }
};

// Function to update the selected coin
export const setCoin = async (coinId) => {
    // Clear old data immediately to prevent showing stale data
    update(state => ({
        ...state,
        loading: true,
        error: null,
        selectedCoin: coinId,
        priceData: null,
        historyData: null,
        newsData: null
    }));

    try {
        // Use Promise.allSettled to tolerate partial failures
        const pricePromise = fetchPriceThrottled(coinId, true); // force=true bypasses throttle
        const historyPromise = fetchHistoryThrottled(coinId, 7, true);

        const settled = await Promise.allSettled([pricePromise, historyPromise]);

        const priceResult = settled[0];
        const historyResult = settled[1];

        let priceData = null;
        let historyData = null;

        if (priceResult.status === 'fulfilled') {
            priceData = priceResult.value;
        } else {
            console.error('Price fetch failed:', priceResult.reason?.message || priceResult.reason);
        }

        if (historyResult.status === 'fulfilled') {
            historyData = historyResult.value;
        } else {
            console.error('History fetch failed:', historyResult.reason?.message || historyResult.reason);
        }

        // CANONICAL PRICE RECONCILIATION: Ensure history last point uses canonical price
        // Only reconcile if price normalization succeeded
        let largePatch = null;
        if (priceData && priceData.priceNumeric && historyData && Array.isArray(historyData) && historyData.length > 0) {
            const canonicalPrice = priceData.priceNumeric; // use normalized price
            const canonicalPriceFmt = priceData.priceFmt || Number(canonicalPrice).toFixed(2);
            const lastPoint = historyData[historyData.length - 1];
            const lastClose = Number(lastPoint.y);
            const lastCloseFmt = Number(lastClose).toFixed(2);

            // Format to 2 decimals for comparison
            if (canonicalPriceFmt !== lastCloseFmt) {
                // Calculate difference metrics
                const diffAbs = Math.abs(canonicalPrice - lastClose);
                const diffPct = lastClose > 0 ? Math.abs((canonicalPrice - lastClose) / lastClose) * 100 : 0;
                const canonicalTimestampMs = priceData.timestampMs || Date.now();

                // Only log detailed patch messages when difference is meaningful
                if (diffAbs > PRICE_PATCH_ABS_THRESHOLD || diffPct > PRICE_PATCH_PCT_THRESHOLD) {
                    console.warn(`[store] Price/history mismatch: canonicalPrice=${formatPriceForLog(canonicalPrice)} lastClose=${formatPriceForLog(lastClose)} -> patching last point (diff=${formatPriceForLog(diffAbs)}, ${diffPct.toFixed(2)}%)`);
                } else {
                    console.debug(`[store] Minor price mismatch: patching last point (diff=${formatPriceForLog(diffAbs)})`);
                }

                // Replace last point close with canonical price (keep timestamp)
                historyData[historyData.length - 1] = { x: lastPoint.x, y: canonicalPrice };
                // Update cache with modified history so throttling returns consistent data
                _lastHistoryFetch.set(`${coinId}_7`, { ts: Date.now(), data: historyData });

                // Log confirmation only for material diffs
                if (diffAbs > PRICE_PATCH_ABS_THRESHOLD || diffPct > PRICE_PATCH_PCT_THRESHOLD) {
                    console.info(`[store] Patched history last point to canonical price: ${formatPriceForLog(canonicalPrice)}`);
                }

                // Track large patches for UI banner
                if (diffAbs > LARGE_PATCH_ABS_THRESHOLD || diffPct > LARGE_PATCH_PCT_THRESHOLD) {
                    largePatch = {
                        diffAbs: diffAbs,
                        diffPct: diffPct,
                        priceSource: priceData.source || 'unknown'
                    };
                }
            } else {
                console.log(`✅ [store] Price consistency verified: canonicalPrice=$${canonicalPriceFmt} matches history lastClose=$${lastCloseFmt}`);
            }
        } else if (priceData && !priceData.priceNumeric) {
            console.warn(`[store] Price data missing priceNumeric, skipping reconciliation`);
        }

        // COMPUTE change24h if server didn't provide it
        if (priceData && priceData.priceNumeric && priceData.change24h == null) {
            let lastClose = null;

            // Try to fetch OHLC data to get lastClosePriceNumeric
            try {
                const ohlcData = await fetchOHLC(coinId, 7);
                if (ohlcData && typeof ohlcData.lastClosePriceNumeric === 'number') {
                    lastClose = ohlcData.lastClosePriceNumeric;
                    console.log(`[store] Using OHLC lastClosePriceNumeric=${lastClose} for change24h computation`);
                }
            } catch (ohlcErr) {
                console.warn(`[store] Failed to fetch OHLC for change24h computation:`, ohlcErr.message);
            }

            // Fallback to history's second-to-last point if OHLC not available
            if (lastClose == null && historyData && Array.isArray(historyData) && historyData.length >= 2) {
                lastClose = historyData[historyData.length - 2].y; // previous day
                console.log(`[store] Using history second-to-last point=${lastClose} for change24h computation`);
            }

            // Compute change24h if we have a previous close
            if (lastClose != null) {
                const computedChange = computeChangePercent(priceData.priceNumeric, lastClose);
                if (computedChange != null) {
                    priceData.change24h = computedChange;
                    priceData.changeFmt = Number(computedChange).toFixed(2);
                    console.log(`[store] Computed change24h=${priceData.changeFmt}% from lastClose=${lastClose}`);
                } else {
                    console.warn(`[store] Could not compute change24h (invalid prevClose=${lastClose}). Using 0.00 fallback.`);
                    priceData.change24h = 0;
                    priceData.changeFmt = '0.00';
                }
            } else {
                // Final fallback: set to 0 but log warning
                console.warn(`[store] Could not compute change24h (no OHLC/history prev close). Using 0.00 fallback.`);
                priceData.change24h = 0;
                priceData.changeFmt = '0.00';
            }
        }

        // Fallback: If price failed but history succeeded, extract latest price from history
        if (!priceData && historyData && historyData.length > 0) {
            // We need to access current state to get coins list, so use update with callback
            let fallbackPriceData = null;
            update(currentState => {
                const latestHistory = historyData[historyData.length - 1];
                const previousHistory = historyData.length > 1 ? historyData[historyData.length - 2] : latestHistory;
                const changePercent = previousHistory ? ((latestHistory.y - previousHistory.y) / previousHistory.y) * 100 : 0;

                // Get coin info from current state
                const coinInfo = currentState.coins?.find(c => c.id === coinId);
                const symbol = coinInfo?.symbol || coinId.toUpperCase().substring(0, 3);

                const fallbackPrice = latestHistory.y;
                fallbackPriceData = {
                    price: fallbackPrice,
                    priceNumeric: fallbackPrice,
                    priceFmt: Number(fallbackPrice).toFixed(2),
                    change24h: changePercent,
                    changeFmt: Number(changePercent).toFixed(2),
                    symbol: symbol,
                    source: 'history-fallback',
                    timestampMs: latestHistory.x.getTime(),
                    timestampIso: latestHistory.x.toISOString(),
                    fallback: true // Mark as fallback data
                };
                console.warn('⚠️ Using history data as price fallback (canonical price fetch failed):', fallbackPriceData);

                // Return updated state
                return {
                    ...currentState,
                    priceData: fallbackPriceData,
                    historyData,
                    loading: false,
                    error: null
                };
            });
            priceData = fallbackPriceData; // Update local variable for news fetch
        } else {
            // Update UI immediately with price/history (non-blocking)
            update(state => ({
                ...state,
                priceData,
                historyData,
                largePatch: largePatch, // Include large patch info for UI banner
                loading: false,
                error: (!priceData && !historyData) ? 'Failed to load price data' : null
            }));
        }

        // Fetch sentiment in background (non-blocking, async) using canonical endpoint
        // This happens after UI is updated to improve perceived load time
        // Use setTimeout to defer - don't start immediately
        setTimeout(() => {
            // Fetch sentiment summary directly (includes headlines) with force=true for user-initiated coin change
            fetchSentimentThrottled(coinId, true)
                .then(sentimentData => {
                    if (sentimentData) {
                        // Update state with sentiment data
                        // Note: sentimentData includes headlines, so we can use it for newsData too
                        update(state => ({
                            ...state,
                            newsData: {
                                headlines: sentimentData.headlines || [],
                                sentiment: {
                                    score: sentimentData.score,
                                    category: sentimentData.label.toLowerCase(),
                                    label: sentimentData.label,
                                    source: sentimentData.source,
                                    count: sentimentData.count,
                                    timestamp: sentimentData.timestamp,
                                    summary: sentimentData.summary || []
                                }
                            }
                        }));
                    }
                })
                .catch(sentimentErr => {
                    console.warn('Sentiment fetch failed (non-critical):', sentimentErr.message);
                    // Don't update state - sentiment is optional
                });
        }, 500); // Defer by 500ms to let critical data render first
    } catch (error) {
        console.error(`❌ Error in setCoin for ${coinId}:`, error);
        update(state => ({
            ...state,
            loading: false,
            error: error.message || 'Failed to load data'
        }));
    }
};

// Validation functions
const validateCoins = (coins) => {
    return Array.isArray(coins) && coins.every(c => c.id && c.name && c.symbol);
};

const validatePrice = (data) => {
    // Updated validation: accept normalized price response structure
    if (!data) return false;
    // priceNumeric or price must be a valid number
    const price = data.priceNumeric || data.price;
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return false;
    // symbol should be a string
    if (data.symbol && typeof data.symbol !== 'string') return false;
    // change24h is optional but if present should be numeric
    if (data.change24h !== undefined && (typeof data.change24h !== 'number' || !Number.isFinite(data.change24h))) return false;
    return true;
};

const validateHistory = (data) => {
    return Array.isArray(data) && data.every(d => d.x instanceof Date && typeof d.y === 'number');
};

const validateNews = (data) => {
    return data && Array.isArray(data.headlines);
};

const validateSentiment = (data) => {
    return data && typeof data.score === 'number' && typeof data.category === 'string';
};

export const cryptoStore = {
    subscribe,
    initStore,
    setCoin
};
