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
    error: null
};

// Create the store
const { subscribe, set, update } = writable(initialState);

// Per-coin cached results (live in-memory). Keeps last successful payload so throttle can return it.
const _lastPriceFetch = new Map();    // coinId -> { ts, data }
const _lastHistoryFetch = new Map();  // coinId_days -> { ts, data }
const THROTTLE_MS = 8000; // 8s

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

const fetchPrice = async (coinId) => {
    const url = `${WORKER_URL}/price?coin=${encodeURIComponent(coinId)}&_=${Date.now()}`;
    try {
        console.log(`🔍 Fetching price for ${coinId}`);
        const res = await fetchWithTimeout(url, { method: 'GET', credentials: 'omit' }, 15000); // 15s timeout for safety
        console.log(`📊 Price response: ${res.status}, headers:`, {
            cache: res.headers.get('cache-control'),
            xcache: res.headers.get('X-Cache-Status'),
            xsource: res.headers.get('X-Cache-Source'),
            xdoage: res.headers.get('X-DO-Age'),
            xlat: res.headers.get('X-Latency-ms')
        });
        
        const data = res.json ?? JSON.parse(res.text || '{}');
        console.log(`✅ Price data received:`, data);
        
        // Basic validation
        if (!data || typeof data.price !== 'number') {
            throw new Error('Invalid price payload');
        }
        if (!validatePrice(data)) {
            console.error(`❌ Invalid price data:`, data);
            throw new Error('Invalid price data');
        }
        
        // Update cache
        _lastPriceFetch.set(coinId, { ts: Date.now(), data });
        return data;
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

    if (!force && last && (now - last.ts) < THROTTLE_MS) {
        console.log(`⏱️ Client throttle: returning cached price for ${coinId}`);
        return last.data;
    }

    try {
        const data = await fetchPrice(coinId);
        return data;
    } catch (err) {
        // If we have a cached value, return stale value instead of throwing
        if (last && last.data) {
            console.warn(`fetchPriceThrottled: upstream failed, returning cached data for ${coinId}`, err.message);
            return last.data;
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

    if (!force && last && (now - last.ts) < THROTTLE_MS) {
        console.log(`⏱️ Client throttle: returning cached history for ${coinId}`);
        return last.data;
    }

    try {
        const data = await fetchHistory(coinId, days);
        return data;
    } catch (err) {
        // If we have a cached value, return stale value instead of throwing
        if (last && last.data) {
            console.warn(`fetchHistoryThrottled: upstream failed, returning cached history for ${key}`, err.message);
            return last.data;
        }
        // No cached data: propagate error so UI shows network error
        throw err;
    }
};

const fetchNews = async (coinId) => {
    const url = `${WORKER_URL}/news?coin=${encodeURIComponent(coinId)}&_=${Date.now()}`;
    try {
        const res = await fetchWithTimeout(url, { method: 'GET', credentials: 'omit' }, 8000);
        const data = res.json ?? JSON.parse(res.text || '{}');
        if (!validateNews(data)) {
            throw new Error('Invalid news data');
        }
        return data;
    } catch (error) {
        console.error(`Error fetching news for ${coinId}:`, error);
        throw error;
    }
};

const fetchSentiment = async (headlines) => {
    const url = `${WORKER_URL}/sentiment`;
    try {
        const res = await fetchWithTimeout(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ headlines })
        }, 10000);
        const data = res.json ?? JSON.parse(res.text || '{}');
        if (!validateSentiment(data)) {
            throw new Error('Invalid sentiment data');
        }
        return data;
    } catch (error) {
        console.error('Error fetching sentiment:', error);
        return null; // Sentiment is optional, return null on failure
    }
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

        // Fallback: If price failed but history succeeded, extract latest price from history
        if (!priceData && historyData && historyData.length > 0) {
            const latestHistory = historyData[historyData.length - 1];
            const previousHistory = historyData.length > 1 ? historyData[historyData.length - 2] : latestHistory;
            const changePercent = previousHistory ? ((latestHistory.y - previousHistory.y) / previousHistory.y) * 100 : 0;
            
            // Use coins list from the closure (already fetched above)
            const coinInfo = coins.find(c => c.id === selectedCoin);
            const symbol = coinInfo?.symbol || selectedCoin.toUpperCase().substring(0, 3);
            
            priceData = {
                price: latestHistory.y,
                change24h: changePercent,
                symbol: symbol,
                source: 'coincap',
                timestamp: latestHistory.x.getTime(),
                fallback: true // Mark as fallback data
            };
            console.log('⚠️ Using history data as price fallback:', priceData);
        }

        // Update UI immediately with price/history (non-blocking)
        update(state => ({
            ...state,
            priceData,
            historyData,
            loading: false,
            error: (!priceData && !historyData) ? 'Failed to load price data' : null
        }));

        // Fetch news and sentiment in background (non-blocking, async)
        // This happens after UI is rendered to improve perceived load time
        fetchNews(selectedCoin)
            .then(newsData => {
                if (newsData?.headlines) {
                    return fetchSentiment(newsData.headlines)
                        .then(sentimentData => {
                            update(state => ({
                                ...state,
                                newsData: newsData ? { ...newsData, sentiment: sentimentData } : null
                            }));
                        })
                        .catch(sentimentErr => {
                            console.warn('Sentiment fetch failed:', sentimentErr.message);
                            update(state => ({
                                ...state,
                                newsData: newsData ? { ...newsData, sentiment: null } : null
                            }));
                        });
                } else {
                    update(state => ({ ...state, newsData: null }));
                }
            })
            .catch(newsErr => {
                console.warn('News fetch failed:', newsErr.message);
                // Don't update state - keep existing newsData or null
            });

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
                
                fallbackPriceData = {
                    price: latestHistory.y,
                    change24h: changePercent,
                    symbol: symbol,
                    source: 'coincap',
                    timestamp: latestHistory.x.getTime(),
                    fallback: true // Mark as fallback data
                };
                console.log('⚠️ Using history data as price fallback:', fallbackPriceData);
                
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
                loading: false,
                error: (!priceData && !historyData) ? 'Failed to load price data' : null
            }));
        }

        // Fetch news and sentiment in background (non-blocking, async)
        // This happens after UI is updated to improve perceived load time
        fetchNews(coinId)
            .then(newsData => {
                if (newsData?.headlines) {
                    return fetchSentiment(newsData.headlines)
                        .then(sentimentData => {
                            update(state => ({
                                ...state,
                                newsData: newsData ? { ...newsData, sentiment: sentimentData } : null
                            }));
                        })
                        .catch(sentimentErr => {
                            console.warn('Sentiment fetch failed:', sentimentErr.message);
                            update(state => ({
                                ...state,
                                newsData: newsData ? { ...newsData, sentiment: null } : null
                            }));
                        });
                } else {
                    update(state => ({ ...state, newsData: null }));
                }
            })
            .catch(newsErr => {
                console.warn('News fetch failed:', newsErr.message);
                // Don't update state - keep existing newsData or null
            });
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
    return data && typeof data.price === 'number' && typeof data.change24h === 'number' && typeof data.symbol === 'string';
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
