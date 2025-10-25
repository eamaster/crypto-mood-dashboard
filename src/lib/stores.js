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

// Helper functions to fetch data
const fetchCoins = async () => {
    try {
        const response = await fetch(`${WORKER_URL}/coins`);
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

const fetchPrice = async (coinId) => {
    try {
        console.log(`🔍 Fetching price for ${coinId} from ${WORKER_URL}/price`);
        const response = await fetch(`${WORKER_URL}/price?coin=${coinId}&_=${Date.now()}`, {
            headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache'
            }
        });
        console.log(`📊 Price response status: ${response.status}`);
        
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

const fetchHistory = async (coinId) => {
    try {
        console.log(`🔍 Fetching history for ${coinId} from ${WORKER_URL}/history`);
        const response = await fetch(`${WORKER_URL}/history?coin=${coinId}&days=7&_=${Date.now()}`, {
            headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache'
            }
        });
        console.log(`📊 History response status: ${response.status}`);
        
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

const fetchNews = async (coinId) => {
    try {
        const response = await fetch(`${WORKER_URL}/news?coin=${coinId}&_=${Date.now()}`, {
            headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache'
            }
        });
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
        const response = await fetch(`${WORKER_URL}/sentiment`, {
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

    const [priceData, historyData, newsData] = await Promise.all([
        fetchPrice(selectedCoin),
        fetchHistory(selectedCoin),
        fetchNews(selectedCoin)
    ]);

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
        const [priceData, historyData, newsData] = await Promise.all([
            fetchPrice(coinId),
            fetchHistory(coinId),
            fetchNews(coinId)
        ]);

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
