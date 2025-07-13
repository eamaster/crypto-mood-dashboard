<script>
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import PriceCard from '$lib/components/PriceCard.svelte';
	import MoodCard from '$lib/components/MoodCard.svelte';
	import ChartCard from '$lib/components/ChartCard.svelte';

	/** @type {import('./$types').PageData} */
	export let data;

	// Cloudflare Worker endpoint
	const WORKER_URL = 'https://crypto-mood-dashboard-production.smah0085.workers.dev';

	let selectedCoin = data.selectedCoin;
	let lastUpdated = 'Never';
	let realTimeActive = false;
	let realTimeStatus = { icon: '🔴', text: 'Real-time updates stopped' };
	let realTimeInterval;
	let isRefreshing = false;
	
	// Initialize data from load function
	let coins = data.coins;
	let priceData = data.initialPriceData ? {
		price: data.initialPriceData.price,
		change: data.initialPriceData.change24h,
		symbol: data.initialPriceData.symbol
	} : { price: 0, change: 0, symbol: 'BTC' };
	
	let moodData = data.initialNewsData?.sentiment ? {
		badge: getMoodBadge(data.initialNewsData.sentiment.category),
		score: data.initialNewsData.sentiment.score,
		source: `Based on ${data.initialNewsData.news?.length || 0} headlines`
	} : { badge: '😐 Neutral', score: 0, source: 'Based on 0 headlines' };
	
	let newsItems = data.initialNewsData?.news || [];
	let historyData = data.initialHistoryData || [];
	let sentimentData = data.initialNewsData?.sentiment || null;
	
	// Error states
	let priceError = null;
	let moodError = null;
	let chartError = null;
	let refreshError = null;
	
	// Loading states
	let priceLoading = false;
	let moodLoading = false;
	let chartLoading = false;

	onMount(() => {
		// Update timestamp
		updateTimestamp();
		
		console.log('Dashboard initialized with data:', { 
			coins: coins.length, 
			priceData, 
			moodData, 
			historyPoints: historyData.length 
		});
	});

	onDestroy(() => {
		if (realTimeInterval) {
			clearInterval(realTimeInterval);
		}
	});

	function getMoodBadge(category) {
		switch (category) {
			case 'bullish':
				return '🐂 Bullish';
			case 'bearish':
				return '🐻 Bearish';
			default:
				return '😐 Neutral';
		}
	}

	function updateTimestamp() {
		lastUpdated = new Date().toLocaleString('en-US', {
			timeZone: 'UTC',
			timeZoneName: 'short'
		});
	}

	async function fetchPrice(coinId) {
		try {
			const response = await fetch(`${WORKER_URL}/price?coin=${coinId}`);
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: Unable to fetch price data`);
			}
			const data = await response.json();
			if (data.error) {
				throw new Error(data.error);
			}
			return {
				price: data.price,
				change: data.change24h || 0,
				symbol: data.symbol
			};
		} catch (error) {
			console.error('Error fetching price:', error);
			throw error;
		}
	}

	async function fetchNews(coinId) {
		try {
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
				return {
					news: [],
					sentiment: {
						score: 0,
						category: 'neutral',
						confidence: 0
					}
				};
			}
			
			// Analyze sentiment
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
						return {
							news: newsArray,
							sentiment: {
								score: sentimentData.score || 0,
								category: sentimentData.category || 'neutral',
								confidence: sentimentData.confidence || 0
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
			throw error;
		}
	}

	async function fetchHistory(coinId) {
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
			return data.prices.map(item => ({
				x: new Date(item.timestamp),
				y: item.price
			}));
		} catch (error) {
			console.error('Error fetching history:', error);
			throw error;
		}
	}

	async function refreshData() {
		if (isRefreshing) return;
		
		isRefreshing = true;
		refreshError = null;
		priceError = null;
		moodError = null;
		chartError = null;
		
		console.log('Refreshing data for coin:', selectedCoin);
		
		try {
			// Refresh price data
			priceLoading = true;
			try {
				const newPriceData = await fetchPrice(selectedCoin);
				priceData = newPriceData;
				priceError = null;
			} catch (error) {
				priceError = error.message;
				console.error('Price refresh failed:', error);
			}
			priceLoading = false;
			
			// Refresh mood data
			moodLoading = true;
			try {
				const newNewsData = await fetchNews(selectedCoin);
				newsItems = newNewsData.news;
				sentimentData = newNewsData.sentiment;
				moodData = {
					badge: getMoodBadge(newNewsData.sentiment.category),
					score: newNewsData.sentiment.score,
					source: `Based on ${newNewsData.news.length} headlines`
				};
				moodError = null;
			} catch (error) {
				moodError = error.message;
				console.error('Mood refresh failed:', error);
			}
			moodLoading = false;
			
			// Refresh chart data
			chartLoading = true;
			try {
				const newHistoryData = await fetchHistory(selectedCoin);
				historyData = newHistoryData;
				chartError = null;
			} catch (error) {
				chartError = error.message;
				console.error('Chart refresh failed:', error);
			}
			chartLoading = false;
			
			updateTimestamp();
			
		} catch (error) {
			refreshError = error.message;
			console.error('Data refresh failed:', error);
		} finally {
			isRefreshing = false;
		}
	}

	async function handleCoinChange(event) {
		const newCoin = event.target.value;
		if (newCoin === selectedCoin) return;
		
		selectedCoin = newCoin;
		console.log('Coin changed to:', selectedCoin);
		
		// Refresh data for new coin
		await refreshData();
	}

	async function handleRefresh() {
		await refreshData();
	}

	function toggleRealTime() {
		realTimeActive = !realTimeActive;
		
		if (realTimeActive) {
			realTimeStatus = { icon: '🟢', text: 'Real-time updates active (every 5 min)' };
			// Start real-time updates every 5 minutes
			realTimeInterval = setInterval(async () => {
				realTimeStatus = { icon: '🔄', text: 'Updating...' };
				await refreshData();
				realTimeStatus = { icon: '🟢', text: 'Real-time updates active (every 5 min)' };
			}, 5 * 60 * 1000); // 5 minutes
		} else {
			realTimeStatus = { icon: '🔴', text: 'Real-time updates stopped' };
			if (realTimeInterval) {
				clearInterval(realTimeInterval);
				realTimeInterval = null;
			}
		}
	}

	function navigateToTechnicalAnalysis() {
		goto('technical-analysis');
	}
</script>

<section class="controls">
	<div class="controls-layout">
		<div class="controls-row">
			<div class="controls-left">
				<div class="coin-selector">
					<label for="coinSelect">Select Cryptocurrency:</label>
					<select id="coinSelect" bind:value={selectedCoin} on:change={handleCoinChange} disabled={isRefreshing}>
						{#each coins as coin}
							<option value={coin.id}>{coin.name} ({coin.symbol.toUpperCase()})</option>
						{/each}
					</select>
				</div>
				<div class="button-group">
					<button on:click={handleRefresh} disabled={isRefreshing}>
						{#if isRefreshing}
							🔄 Refreshing...
						{:else}
							🔄 Refresh
						{/if}
					</button>
					<button on:click={toggleRealTime} data-active={realTimeActive} disabled={isRefreshing}>
						{realTimeActive ? '⏸️ Stop Real-Time' : '📡 Start Real-Time (5min)'}
					</button>
					<button on:click={navigateToTechnicalAnalysis} class="ta-button">
						🔍 Technical Analysis
					</button>
				</div>
			</div>
			<div class="controls-right">
				<div class="dashboard-status">
					<div class="last-updated">
						Last updated: <span>{lastUpdated}</span>
					</div>
					{#if realTimeActive}
						<div class="real-time-status" data-status={realTimeStatus.icon === '🟢' ? 'active' : realTimeStatus.icon === '🔄' ? 'updating' : 'error'}>
							<span>{realTimeStatus.icon}</span> <span>{realTimeStatus.text}</span>
						</div>
					{/if}
					{#if refreshError}
						<div class="error-message">
							❌ Refresh failed: {refreshError}
						</div>
					{/if}
				</div>
			</div>
		</div>
	</div>
</section>

<section class="dashboard-grid">
	<!-- Price Card -->
	<PriceCard 
		price={priceData.price} 
		change={priceData.change} 
		symbol={priceData.symbol}
		loading={priceLoading}
		error={priceError}
	/>

	<!-- Mood Card -->
	<MoodCard 
		badge={moodData.badge}
		score={moodData.score}
		source={moodData.source}
		newsItems={newsItems}
		category={sentimentData?.category || 'neutral'}
		loading={moodLoading}
		error={moodError}
	/>

	<!-- Chart Card -->
	<ChartCard 
		historyData={historyData}
		sentimentData={sentimentData}
		coinId={selectedCoin}
		loading={chartLoading}
		error={chartError}
	/>
</section> 