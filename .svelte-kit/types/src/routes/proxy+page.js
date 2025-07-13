// @ts-nocheck
// Cloudflare Worker endpoint
const WORKER_URL = 'https://crypto-mood-dashboard-production.smah0085.workers.dev';

/** @param {Parameters<import('./$types').PageLoad>[0]} event */
export async function load({ fetch }) {
	try {
		// Fetch coins list
		const coinsResponse = await fetch(`${WORKER_URL}/coins`);
		let coins = [];
		
		if (coinsResponse.ok) {
			coins = await coinsResponse.json();
			
			// Validate coins data
			if (!Array.isArray(coins)) {
				console.warn('Invalid coins data received');
				coins = [];
			}
		} else {
			console.error('Failed to fetch coins list:', coinsResponse.status);
		}
		
		// Default to Bitcoin if no coins or Bitcoin not found
		const defaultCoin = 'bitcoin';
		const selectedCoin = coins.find(coin => coin.id === defaultCoin) ? defaultCoin : coins[0]?.id || defaultCoin;
		
		// Fetch initial data for the default coin (Bitcoin)
		const [priceData, historyData, newsData] = await Promise.allSettled([
			fetchPrice(selectedCoin, fetch),
			fetchHistory(selectedCoin, fetch),
			fetchNews(selectedCoin, fetch)
		]);
		
		return {
			coins: coins,
			selectedCoin: selectedCoin,
			initialPriceData: priceData.status === 'fulfilled' ? priceData.value : null,
			initialHistoryData: historyData.status === 'fulfilled' ? historyData.value : null,
			initialNewsData: newsData.status === 'fulfilled' ? newsData.value : null
		};
		
	} catch (error) {
		console.error('Error loading dashboard data:', error);
		
		// Return fallback data
		return {
			coins: [{ id: 'bitcoin', name: 'Bitcoin', symbol: 'BTC' }],
			selectedCoin: 'bitcoin',
			initialPriceData: null,
			initialHistoryData: null,
			initialNewsData: null
		};
	}
}

async function fetchPrice(coinId, fetch) {
	try {
		const response = await fetch(`${WORKER_URL}/price?coin=${coinId}`);
		
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: Unable to fetch price data`);
		}
		
		const data = await response.json();
		
		if (data.error) {
			throw new Error(data.error);
		}
		
		// Validate price data
		if (!validatePriceData(data)) {
			throw new Error('Invalid price data received from server');
		}
		
		return {
			price: data.price,
			change24h: data.change24h || 0,
			market_cap: data.market_cap || null,
			volume_24h: data.volume_24h || null,
			symbol: data.symbol,
			source: data.source || 'unknown'
		};
		
	} catch (error) {
		console.error('Error fetching price:', error);
		throw error;
	}
}

async function fetchHistory(coinId, fetch) {
	try {
		const response = await fetch(`${WORKER_URL}/history?coin=${coinId}&days=7`);
		
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: Unable to fetch price history`);
		}
		
		const data = await response.json();
		
		if (data.error) {
			throw new Error(data.error);
		}
		
		if (!data.prices || data.prices.length === 0) {
			throw new Error(`No price history found for ${coinId}`);
		}
		
		// Transform history data
		const historyData = data.prices.map(item => ({
			x: new Date(item.timestamp),
			y: item.price
		}));
		
		console.log(`📈 Fetched ${historyData.length} price points from ${data.source || 'unknown source'}`);
		return historyData;
		
	} catch (error) {
		console.error('Error fetching price history:', error);
		throw error;
	}
}

async function fetchNews(coinId, fetch) {
	try {
		// Step 1: Fetch news headlines
		const response = await fetch(`${WORKER_URL}/news?coin=${coinId}`);
		
		if (!response.ok) {
			throw new Error(`Failed to fetch news for ${coinId}`);
		}
		
		const data = await response.json();
		
		if (data.error) {
			console.error('News API error:', data.error);
			return {
				news: [],
				sentiment: {
					score: 0,
					category: 'neutral',
					confidence: 0
				}
			};
		}
		
		// Extract headlines from response
		let newsArray = [];
		if (data.headlines && Array.isArray(data.headlines)) {
			newsArray = data.headlines;
		} else if (data.news && Array.isArray(data.news)) {
			newsArray = data.news;
		}
		
		if (newsArray.length === 0) {
			console.warn('No news data available');
			return {
				news: [],
				sentiment: {
					score: 0,
					category: 'neutral',
					confidence: 0
				}
			};
		}
		
		// Step 2: Analyze sentiment of headlines (like original implementation)
		try {
			const sentimentResponse = await fetch(`${WORKER_URL}/sentiment`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					headlines: newsArray
				})
			});
			
			if (sentimentResponse.ok) {
				const sentimentData = await sentimentResponse.json();
				
				if (!sentimentData.error && sentimentData.score !== undefined) {
					console.log(`🧠 Sentiment analysis: ${sentimentData.category} (${sentimentData.score}) from ${newsArray.length} headlines`);
					
					return {
						news: newsArray,
						sentiment: {
							score: sentimentData.score || 0,
							category: sentimentData.category || 'neutral',
							confidence: sentimentData.confidence || 0,
							breakdown: sentimentData.breakdown || null,
							method: sentimentData.method || 'unknown'
						}
					};
				}
			}
		} catch (sentimentError) {
			console.error('Sentiment analysis failed:', sentimentError);
		}
		
		// Fallback: return news without sentiment
		return {
			news: newsArray,
			sentiment: {
				score: 0,
				category: 'neutral',
				confidence: 0
			}
		};
		
	} catch (error) {
		console.error('Error fetching news:', error);
		return {
			news: [],
			sentiment: {
				score: 0,
				category: 'neutral',
				confidence: 0
			}
		};
	}
}

function validatePriceData(data) {
	if (!data || typeof data !== 'object') {
		console.warn('Invalid price data: not an object');
		return false;
	}
	
	if (typeof data.price !== 'number' || data.price <= 0) {
		console.warn('Invalid price data: price not a positive number');
		return false;
	}
	
	if (typeof data.change24h !== 'number') {
		console.warn('Invalid price data: change24h not a number');
		return false;
	}
	
	if (!data.symbol || typeof data.symbol !== 'string') {
		console.warn('Invalid price data: missing or invalid symbol');
		return false;
	}
	
	return true;
} 