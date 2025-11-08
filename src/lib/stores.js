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

// Per-coin client throttle (8s between fetches)
const _lastPriceFetch = new Map();
const _lastHistoryFetch = new Map();

// Helper: fetch with timeout and no-store cache (no custom headers for GET to avoid preflight)
async function fetchWithTimeout(url, opts = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            cache: 'no-store',
            signal: controller.signal,
            ...opts
        });
        clearTimeout(id);
        return res;
    } catch (e) {
        clearTimeout(id);
        throw e;
    }
}

// Helper functions to fetch data
const fetchCoins = async () => {
    try {
        const response = await fetchWithTimeout(`${WORKER_URL}/coins`);
        if (!response.ok) {
            throw new Error('Failed to fetch coins list');
        }
        const coins = await response.json();
        if (!validateCoins(coins)) {
            throw new Error('Invalid coins data');
        }
        return coins;
    } catch (error) {
        console.error('Error fetching coins:', error);
        return [];
    }
};

const fetchPriceInternal = async (coinId) => {
    try {
        console.log(`🔍 Fetching price for ${coinId} from ${WORKER_URL}/price`);
        const response = await fetchWithTimeout(`${WORKER_URL}/price?coin=${coinId}&_=${Date.now()}`);
        console.log(`📊 Price response status: ${response.status}, headers:`, {
            cache: response.headers.get('cache-control'),
            xcache: response.headers.get('X-Cache-Status'),
            xsource: response.headers.get('X-Cache-Source'),
            xdoage: response.headers.get('X-DO-Age'),
            xlat: response.headers.get('X-Latency-ms')
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ Price API error: ${response.status} - ${errorText}`);
            throw new Error(`Failed to fetch price data. Status: ${response.status}`);
        }
        
        const data = await response.json();
        console.log(`✅ Price data received:`, data);
        
        if (data.error) {
            throw new Error(data.error);
        }
        if (!validatePrice(data)) {
            console.error(`❌ Invalid price data:`, data);
            throw new Error('Invalid price data');
        }
        return data;
    } catch (error) {
        console.error(`❌ Error fetching price for ${coinId}:`, error);
        throw new Error(`Failed to fetch price data for ${coinId}.`);
    }
};

// Client-side throttle wrapper (8s per coin to prevent bursts)
const fetchPrice = async (coinId, force = false) => {
    const now = Date.now();
    const last = _lastPriceFetch.get(coinId) || 0;
    
    // Skip if last fetch within 8s (unless forced)
    if (!force && now - last < 8000) {
        const waitTime = Math.floor((8000 - (now - last)) / 1000);
        console.log(`⏱️ Client throttle: skipping price fetch for ${coinId} (retry in ${waitTime}s)`);
        throw new Error(`Please wait ${waitTime} seconds before refreshing ${coinId}`);
    }
    
    _lastPriceFetch.set(coinId, now);
    try {
        return await fetchPriceInternal(coinId);
    } finally {
        setTimeout(() => _lastPriceFetch.delete(coinId), 8000);
    }
};

const fetchHistoryInternal = async (coinId) => {
    try {
        console.log(`🔍 Fetching history for ${coinId} from ${WORKER_URL}/history`);
        const response = await fetchWithTimeout(`${WORKER_URL}/history?coin=${coinId}&days=7&_=${Date.now()}`);
        console.log(`📊 History response status: ${response.status}, headers:`, {
            cache: response.headers.get('cache-control'),
            xcache: response.headers.get('X-Cache-Status'),
            xsource: response.headers.get('X-Cache-Source'),
            xdoage: response.headers.get('X-DO-Age'),
            xlat: response.headers.get('X-Latency-ms')
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ History API error: ${response.status} - ${errorText}`);
            throw new Error(`Failed to fetch history data. Status: ${response.status}`);
        }
        
        const data = await response.json();
        console.log(`✅ History data received:`, data);
        
        if (data.error) {
            throw new Error(data.error);
        }
        
        if (!data.prices || !Array.isArray(data.prices)) {
            console.error(`❌ Invalid history data format:`, data);
            throw new Error('Invalid history data format');
        }
        
        const historyData = data.prices.map(item => ({
            x: new Date(item.timestamp),
            y: item.price
        }));
        
        if (!validateHistory(historyData)) {
            console.error(`❌ Invalid history data after transformation:`, historyData);
            throw new Error('Invalid history data');
        }
        return historyData;
    } catch (error) {
        console.error(`❌ Error fetching history for ${coinId}:`, error);
        throw new Error(`Failed to fetch history data for ${coinId}.`);
    }
};

// Client-side throttle wrapper for history (8s per coin to prevent bursts)
const fetchHistory = async (coinId, force = false) => {
    const now = Date.now();
    const last = _lastHistoryFetch.get(coinId) || 0;
    
    // Skip if last fetch within 8s (unless forced)
    if (!force && now - last < 8000) {
        const waitTime = Math.floor((8000 - (now - last)) / 1000);
        console.log(`⏱️ Client throttle: skipping history fetch for ${coinId} (retry in ${waitTime}s)`);
        throw new Error(`Please wait ${waitTime} seconds before refreshing ${coinId}`);
    }
    
    _lastHistoryFetch.set(coinId, now);
    try {
        return await fetchHistoryInternal(coinId);
    } finally {
        setTimeout(() => _lastHistoryFetch.delete(coinId), 8000);
    }
};

const fetchNews = async (coinId) => {
    try {
        const response = await fetchWithTimeout(`${WORKER_URL}/news?coin=${coinId}&_=${Date.now()}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch news for ${coinId}. Status: ${response.status}`);
        }
        const data = await response.json();
        if (data.error) {
            throw new Error(data.error);
        }
        if (!validateNews(data)) {
            throw new Error('Invalid news data');
        }
        return data;
    } catch (error) {
        console.error(`Error fetching news for ${coinId}:`, error);
        throw new Error(`Failed to fetch news for ${coinId}.`);
    }
};

const fetchSentiment = async (headlines) => {
    try {
        const response = await fetchWithTimeout(`${WORKER_URL}/sentiment`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ headlines })
        });
        if (!response.ok) {
            throw new Error('Failed to fetch sentiment data');
        }
        const data = await response.json();
        if (data.error) {
            throw new Error(data.error);
        }
        if (!validateSentiment(data)) {
            throw new Error('Invalid sentiment data');
        }
        return data;
    } catch (error) {
        console.error('Error fetching sentiment:', error);
        return null;
    }
};

// Function to initialize the store
export const initStore = async () => {
    update(state => ({ ...state, loading: true, error: null }));
    const coins = await fetchCoins();
    const selectedCoin = coins.find(c => c.id === 'bitcoin') ? 'bitcoin' : (coins[0]?.id || 'bitcoin');

    try {
        // Parallelize price & history fetches (they don't depend on each other)
        // force=true on initial load to bypass throttle
        const [priceData, historyData] = await Promise.all([
            fetchPrice(selectedCoin, true),
            fetchHistory(selectedCoin, true)
        ]);

        // News and sentiment can run after price/history are loaded
        const newsData = await fetchNews(selectedCoin);

        let sentimentData = null;
        if (newsData?.headlines) {
            sentimentData = await fetchSentiment(newsData.headlines);
        }

        set({
            coins,
            selectedCoin,
            priceData,
            historyData,
            newsData: { ...newsData, sentiment: sentimentData },
            loading: false,
            error: null
        });
    } catch (error) {
        console.error('❌ Failed to initialize store:', error);
        set({
            coins,
            selectedCoin,
            priceData: null,
            historyData: null,
            newsData: null,
            loading: false,
            error: error.message || 'Failed to load data'
        });
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
        // Clear throttle for this coin when user explicitly switches
        _lastPriceFetch.delete(coinId);
        _lastHistoryFetch.delete(coinId);
        
        // Parallelize price & history fetches (they don't depend on each other)
        const [priceData, historyData] = await Promise.all([
            fetchPrice(coinId, true), // force=true bypasses throttle
            fetchHistory(coinId, true)
        ]);

        // News and sentiment can run after price/history are loaded
        const newsData = await fetchNews(coinId);

        let sentimentData = null;
        if (newsData?.headlines) {
            sentimentData = await fetchSentiment(newsData.headlines);
        }

        update(state => ({
            ...state,
            priceData,
            historyData,
            newsData: { ...newsData, sentiment: sentimentData },
            loading: false,
            error: null
        }));
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
