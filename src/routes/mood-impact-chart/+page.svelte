<script>
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import Chart from 'chart.js/auto';
	import 'chartjs-adapter-date-fns';
	import { WORKER_URL } from '../../lib/config.js';

	// API URLs
	const COINGECKO_API = 'https://api.coingecko.com/api/v3';
	const ENABLE_NEWS = true; // Enable news analysis

	// Reactive variables
	let coinId = 'bitcoin';
	let loading = false;
	let error = null;
	let chartCanvas;
	let chartInstance = null;
	let sentimentData = null;
	let newsData = [];

	onMount(async () => {
		// Auto-load chart on page load
		await fetchMoodImpactData();
	});

	onDestroy(() => {
		// Clean up chart when component is destroyed
		if (chartInstance) {
			chartInstance.destroy();
			chartInstance = null;
		}
	});

	async function fetchMoodImpactData() {
		if (!browser) return;
		
		const coin = coinId.trim() || 'bitcoin';
		loading = true;
		error = null;
		sentimentData = null;
		newsData = [];

		try {
			// Destroy existing chart properly
			if (chartInstance) {
				chartInstance.destroy();
				chartInstance = null;
			}

			console.log('Starting enhanced fetchMoodImpactData for:', coin);
			
			// Fetch price data and news in parallel
			const [priceData, newsResults] = await Promise.all([
				fetchPriceData(coin),
				fetchNewsData(coin).catch(err => {
					console.warn('📰 News fetch failed, using empty array:', err.message);
					return []; // Continue with price-only chart
				})
			]);

			console.log('📈 Real price data received:', priceData.length, 'points');
			console.log('📰 News data received:', newsResults.length, 'headlines');

			// Validate data
			if (!validatePriceData(priceData)) {
				throw new Error('Invalid price data format');
			}

			if (newsResults.length > 0 && !validateNewsData(newsResults)) {
				console.warn('Invalid news data received, proceeding with empty news array');
				newsResults.length = 0;
			}

			newsData = newsResults;

			// Analyze sentiment
			console.log('Analyzing sentiment...');
			sentimentData = await analyzeSentimentData(newsResults);
			console.log('Enhanced sentiment analysis result:', sentimentData);

			// Validate sentiment data
			if (!validateSentimentData(sentimentData)) {
				console.warn('Invalid sentiment data, using neutral fallback');
				sentimentData = {
					score: 0,
					category: 'neutral',
					confidence: 0,
					method: 'fallback',
					emoji: '😐',
					count: 0
				};
			}

			// Create chart
			await createMoodImpactChart(priceData, sentimentData, coin);
			
		} catch (err) {
			console.error('Error fetching mood impact data:', err);
			error = err.message;
		} finally {
			loading = false;
		}
	}

	async function fetchPriceData(coin) {
		try {
			console.log(`📈 Fetching price data for ${coin} from CoinGecko...`);
			const response = await fetch(
				`${COINGECKO_API}/coins/${coin}/market_chart?vs_currency=usd&days=7&interval=daily`
			);
			
			if (!response.ok) {
				throw new Error(`Failed to fetch price data: HTTP ${response.status}`);
			}
			
			const data = await response.json();
			
			if (!data.prices || !Array.isArray(data.prices)) {
				throw new Error('Invalid price data format from API');
			}
			
			// Format the data for the chart
			const chartData = data.prices.map(([timestamp, price]) => ({
				x: new Date(timestamp),
				y: price
			}));
			
			console.log(`✅ Fetched ${chartData.length} price points for ${coin}`);
			return chartData;
		} catch (err) {
			console.error('Error in fetchPriceData:', err);
			throw new Error(`Failed to fetch price data for ${coin}: ${err.message}`);
		}
	}

	async function fetchNewsData(coin) {
		if (!ENABLE_NEWS) {
			console.log('ℹ️ News fetching is currently disabled');
			return [];
		}
		
		try {
			const response = await fetch(`${WORKER_URL}/news?coin=${coin}`);
			
			if (!response.ok) {
				throw new Error(`Failed to fetch news for ${coin}. HTTP status: ${response.status}`);
			}
			
			const data = await response.json();
			
			if (data.error) {
				throw new Error(data.error);
			}
			
			if (!data.headlines || data.headlines.length === 0) {
				console.warn(`⚠️ No news headlines found for ${coin}`);
				return [];
			}
			
			// Validate news data
			if (!validateNewsData(data.headlines)) {
				throw new Error('Invalid news data format received');
			}
			
			console.log(`✅ Successfully fetched ${data.headlines.length} headlines for ${coin}`);
			return data.headlines;
			
		} catch (err) {
			console.error('❌ News fetch failed:', err.message);
			throw err;
		}
	}

	async function analyzeSentimentData(headlines) {
		console.log(`🧠 Starting sentiment analysis for ${headlines.length} headlines...`);
		
		if (headlines.length === 0) {
			console.warn('⚠️ No headlines to analyze, returning neutral sentiment');
			return {
				score: 0,
				category: 'neutral',
				emoji: '😐',
				count: 0,
				confidence: 0,
				method: 'no-data',
				note: 'No headlines available for analysis'
			};
		}
		
		try {
			const response = await fetch(`${WORKER_URL}/sentiment`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					headlines: headlines
				})
			});
			
			if (!response.ok) {
				throw new Error(`Sentiment analysis failed: HTTP ${response.status}`);
			}
			
			const data = await response.json();
			
			if (data.error) {
				throw new Error(data.error);
			}
			
			// Validate sentiment response
			if (!validateSentimentData(data)) {
				throw new Error('Invalid sentiment data received from server');
			}
			
			let emoji;
			if (data.category === 'bullish') {
				emoji = '🐂';
			} else if (data.category === 'bearish') {
				emoji = '🐻';
			} else {
				emoji = '😐';
			}
			
			return {
				score: data.score || 0,
				category: data.category || 'neutral',
				emoji: emoji,
				count: data.total || data.analyzed || headlines.length,
				confidence: data.confidence || 0,
				method: data.method || 'unknown',
				breakdown: data.breakdown || null
			};
			
		} catch (err) {
			console.error('❌ Error in sentiment analysis:', err);
			return {
				score: 0,
				category: 'neutral',
				emoji: '😐',
				count: headlines.length,
				confidence: 0,
				method: 'error',
				error: err.message
			};
		}
	}

	async function createMoodImpactChart(priceData, sentiment, coin) {
		if (!browser || !chartCanvas) return;

		try {
			console.log('📊 Creating chart with:', {
				pricePoints: priceData.length,
				sentimentScore: sentiment.score,
				sentimentCategory: sentiment.category,
				headlinesCount: sentiment.count
			});
			
			// Create sentiment bar data - position it at the end for today's sentiment
			const sentimentBarData = [{
				x: priceData[priceData.length - 1].x,
				y: sentiment.score || 0
			}];
			
			// Determine sentiment bar color
			let sentimentColor;
			if (sentiment.category === 'bullish') {
				sentimentColor = 'rgba(40, 167, 69, 0.8)';
			} else if (sentiment.category === 'bearish') {
				sentimentColor = 'rgba(220, 53, 69, 0.8)';
			} else {
				sentimentColor = 'rgba(108, 117, 125, 0.8)';
			}
			
			chartInstance = new Chart(chartCanvas, {
				type: 'line',
				data: {
					datasets: [
						{
							label: `${coin.toUpperCase()} Price (USD)`,
							data: priceData,
							borderColor: '#007bff',
							backgroundColor: 'rgba(0, 123, 255, 0.1)',
							borderWidth: 2,
							fill: true,
							tension: 0.1,
							yAxisID: 'price'
						},
						{
							label: 'Today\'s Sentiment',
							data: sentimentBarData,
							type: 'bar',
							backgroundColor: sentimentColor,
							borderColor: sentimentColor.replace('0.8', '1'),
							borderWidth: 1,
							yAxisID: 'sentiment',
							barThickness: 30
						}
					]
				},
				options: {
					responsive: true,
					maintainAspectRatio: false,
					interaction: {
						mode: 'index',
						intersect: false,
					},
					scales: {
						x: {
							type: 'time',
							time: {
								unit: 'day',
								displayFormats: {
									day: 'MMM dd'
								}
							},
							title: {
								display: true,
								text: 'Date'
							}
						},
						price: {
							type: 'linear',
							display: true,
							position: 'left',
							title: {
								display: true,
								text: 'Price (USD)'
							},
							ticks: {
								callback: function(value) {
									return '$' + value.toLocaleString();
								}
							}
						},
						sentiment: {
							type: 'linear',
							display: true,
							position: 'right',
							title: {
								display: true,
								text: 'Sentiment Score'
							},
							min: -5,
							max: 5,
							grid: {
								drawOnChartArea: false,
							},
						}
					},
					plugins: {
						title: {
							display: true,
							text: `${coin.toUpperCase()} Price vs Market Sentiment (7 days)`,
							font: {
								size: 16
							}
						},
						legend: {
							display: true
						},
						tooltip: {
							callbacks: {
								label: function(context) {
									if (context.datasetIndex === 0) {
										return `Price: ${context.parsed.y.toLocaleString('en-US', {
											style: 'currency',
											currency: 'USD'
										})}`;
									} else {
										return `Sentiment: ${context.parsed.y.toFixed(2)} (${sentiment.category})`;
									}
								}
							}
						}
					}
				}
			});
			
		} catch (err) {
			console.error('Error creating chart:', err);
			error = 'Failed to create chart. Chart.js may not be available.';
		}
	}

	// Validation functions
	function validatePriceData(data) {
		if (!data || !Array.isArray(data)) return false;
		return data.every(point => 
			point && 
			point.x instanceof Date && 
			typeof point.y === 'number' && 
			point.y > 0
		);
	}

	function validateNewsData(data) {
		if (!data || !Array.isArray(data)) return false;
		return data.every(article => 
			article && 
			typeof article === 'object' && 
			(typeof article.title === 'string' || typeof article === 'string') &&
			(article.title || article).length > 0
		);
	}

	function validateSentimentData(data) {
		if (!data || typeof data !== 'object') return false;
		if (typeof data.score !== 'number' || data.score < -5 || data.score > 5) return false;
		if (!data.category || !['bullish', 'bearish', 'neutral'].includes(data.category)) return false;
		if (typeof data.confidence !== 'number' || data.confidence < 0 || data.confidence > 1) return false;
		return true;
	}

	function handleKeyPress(event) {
		if (event.key === 'Enter') {
			fetchMoodImpactData();
		}
	}

	function goBack() {
		goto('modules');
	}
</script>

<svelte:head>
	<title>📊 Mood Impact Chart - Crypto Mood Dashboard</title>
</svelte:head>

<div class="container">
	<div class="header">
		<h1>📊 Mood Impact Chart Demo</h1>
		<button class="back-button" on:click={goBack}>← Back to Modules</button>
	</div>
	
	<p>Combines 7-day price data with today's sentiment analysis from cryptocurrency news headlines:</p>
	
	<div class="input-group">
		<input 
			type="text" 
			bind:value={coinId}
			placeholder="bitcoin"
			on:keypress={handleKeyPress}
			disabled={loading}
		>
		<button on:click={fetchMoodImpactData} disabled={loading}>
			{loading ? '⏳ Loading...' : 'Generate Chart'}
		</button>
	</div>
	
	{#if loading}
		<div class="loading">⏳ Loading price data and analyzing sentiment...</div>
	{:else if error}
		<div class="error">❌ Error: {error}</div>
	{/if}
	
	{#if sentimentData && !loading && !error}
		<div class="sentiment-summary">
			<div class="sentiment-info">
				<strong>Today's Market Sentiment:</strong>
				<div class="sentiment-badge {sentimentData.category}">
					{sentimentData.emoji} {sentimentData.category.charAt(0).toUpperCase() + sentimentData.category.slice(1)}
				</div>
			</div>
			<div class="sentiment-stats">
				<div><strong>Headlines analyzed:</strong> {sentimentData.count}</div>
				<div><strong>Average score:</strong> {sentimentData.score.toFixed(2)}</div>
				<div><strong>Confidence:</strong> {(sentimentData.confidence * 100).toFixed(1)}%</div>
			</div>
		</div>

		{#if newsData.length > 0}
			<div class="news-preview">
				<h4>Recent Headlines Analyzed:</h4>
				{#each newsData.slice(0, 5) as newsItem, index}
					<div class="news-item">
						{index + 1}. {newsItem.title || newsItem}
					</div>
				{/each}
				{#if newsData.length > 5}
					<div class="news-item">... and {newsData.length - 5} more headlines</div>
				{/if}
			</div>
		{/if}
	{/if}
	
	<div class="chart-container">
		<canvas bind:this={chartCanvas} id="moodImpactChart"></canvas>
	</div>
</div>

<style>
	.container {
		max-width: 1000px;
		margin: 2rem auto;
		padding: 2rem;
		background: var(--bg-primary);
		border-radius: 12px;
		box-shadow: var(--shadow);
	}

	.header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
		flex-wrap: wrap;
		gap: 1rem;
	}

	.header h1 {
		color: var(--accent-color);
		margin: 0;
		font-size: 1.8rem;
	}

	.back-button {
		background: var(--bg-tertiary);
		color: var(--text-primary);
		border: 1px solid var(--border-color);
		padding: 0.5rem 1rem;
		border-radius: 6px;
		cursor: pointer;
		font-size: 0.9rem;
		transition: all 0.3s ease;
	}

	.back-button:hover {
		background: var(--accent-color);
		color: white;
	}

	p {
		color: var(--text-secondary);
		margin-bottom: 1.5rem;
		line-height: 1.6;
	}

	.input-group {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1.5rem;
		flex-wrap: wrap;
	}

	input {
		flex: 1;
		padding: 0.75rem;
		border: 1px solid var(--border-color);
		border-radius: 6px;
		background: var(--bg-secondary);
		color: var(--text-primary);
		font-size: 1rem;
		min-width: 200px;
	}

	input:focus {
		outline: 2px solid var(--accent-color);
		outline-offset: 2px;
		border-color: var(--accent-color);
	}

	input:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	button {
		background: var(--accent-color);
		color: white;
		border: none;
		padding: 0.75rem 1.5rem;
		border-radius: 6px;
		cursor: pointer;
		font-size: 1rem;
		font-weight: 600;
		transition: all 0.3s ease;
		white-space: nowrap;
	}

	button:hover:not(:disabled) {
		background: var(--accent-hover);
		transform: translateY(-1px);
	}

	button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
		transform: none;
	}

	.loading {
		text-align: center;
		margin: 1.5rem 0;
		font-size: 1.2rem;
		color: var(--text-secondary);
	}

	.error {
		color: var(--danger-color);
		margin: 1.5rem 0;
		padding: 1rem;
		background: #f8d7da;
		border-radius: 6px;
		text-align: center;
	}

	.sentiment-summary {
		margin-top: 1.5rem;
		padding: 1rem;
		background: var(--bg-secondary);
		border-radius: 8px;
		display: flex;
		justify-content: space-between;
		align-items: center;
		flex-wrap: wrap;
		gap: 1rem;
	}

	.sentiment-info {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.sentiment-badge {
		font-size: 1.5rem;
		font-weight: 700;
		padding: 0.5rem 1rem;
		border-radius: 20px;
		text-align: center;
	}

	.sentiment-badge.bullish {
		background: #d4edda;
		color: #155724;
	}

	.sentiment-badge.neutral {
		background: #e9ecef;
		color: #495057;
	}

	.sentiment-badge.bearish {
		background: #f8d7da;
		color: #721c24;
	}

	.sentiment-stats {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		text-align: right;
		font-size: 0.9rem;
		color: var(--text-secondary);
	}

	.news-preview {
		margin-top: 1rem;
		max-height: 150px;
		overflow-y: auto;
		background: var(--bg-secondary);
		padding: 1rem;
		border-radius: 6px;
	}

	.news-preview h4 {
		margin: 0 0 0.75rem 0;
		color: var(--text-primary);
		font-size: 1rem;
	}

	.news-item {
		padding: 0.375rem 0;
		margin: 0.25rem 0;
		background: var(--bg-primary);
		border-radius: 4px;
		padding: 0.5rem;
		font-size: 0.85rem;
		color: var(--text-secondary);
		border-left: 2px solid var(--accent-color);
	}

	.chart-container {
		margin-top: 1.5rem;
		height: 500px;
		position: relative;
		background: var(--bg-secondary);
		border-radius: 8px;
		padding: 1rem;
		box-shadow: var(--shadow);
	}

	@media (max-width: 768px) {
		.container {
			margin: 1rem;
			padding: 1.5rem;
		}

		.header {
			flex-direction: column;
			align-items: flex-start;
		}

		.input-group {
			flex-direction: column;
		}

		input {
			min-width: unset;
		}

		.sentiment-summary {
			flex-direction: column;
			text-align: center;
		}

		.sentiment-stats {
			text-align: center;
		}

		.chart-container {
			height: 400px;
		}
	}
</style> 