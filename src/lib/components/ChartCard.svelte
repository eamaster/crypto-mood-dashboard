<script>
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import Chart from 'chart.js/auto';
	import 'chartjs-adapter-date-fns';
	import DataCard from './DataCard.svelte';
	
	// Props for chart data
	export let historyData = [];
	export let sentimentData = null;
	export let coinId = 'bitcoin';
	export let error = null;
	export let loading = false;
	
	let chartCanvas;
	let chartInstance = null;
	let chartContainer;
	let isChartReady = false;
	
	$: if (browser && historyData.length > 0 && !loading && !error) {
		initializeChart();
	}
	
	onMount(() => {
		if (browser && historyData.length > 0 && !loading && !error) {
			initializeChart();
		}
	});
	
	onDestroy(() => {
		// Clean up chart when component is destroyed
		if (chartInstance) {
			chartInstance.destroy();
			chartInstance = null;
		}
	});
	
	async function initializeChart() {
		if (!browser || !chartCanvas || historyData.length === 0 || loading || error) return;
		
		try {
			// Destroy existing chart if it exists
			if (chartInstance) {
				chartInstance.destroy();
				chartInstance = null;
			}
			
			// Create sentiment bar data if sentiment data is available
			const datasets = [
				{
					label: `${coinId.toUpperCase()} Price (USD)`,
					data: historyData,
					borderColor: '#007bff',
					backgroundColor: 'rgba(0, 123, 255, 0.1)',
					borderWidth: 2,
					fill: true,
					tension: 0.1,
					yAxisID: 'price'
				}
			];
			
			const scales = {
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
				}
			};
			
			// Add sentiment data if available
			if (sentimentData && sentimentData.score !== undefined) {
				const sentimentBarData = [{
					x: historyData[historyData.length - 1].x,
					y: sentimentData.score
				}];
				
				let sentimentColor;
				if (sentimentData.category === 'bullish') {
					sentimentColor = 'rgba(40, 167, 69, 0.8)';
				} else if (sentimentData.category === 'bearish') {
					sentimentColor = 'rgba(220, 53, 69, 0.8)';
				} else {
					sentimentColor = 'rgba(108, 117, 125, 0.8)';
				}
				
				datasets.push({
					label: 'Current Sentiment',
					data: sentimentBarData,
					type: 'bar',
					backgroundColor: sentimentColor,
					borderColor: sentimentColor.replace('0.8', '1'),
					borderWidth: 1,
					yAxisID: 'sentiment',
					barThickness: 30
				});
				
				scales.sentiment = {
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
					ticks: {
						callback: function(value) {
							if (value > 1) return value + ' (Bullish)';
							if (value < -1) return value + ' (Bearish)';
							return value + ' (Neutral)';
						}
					}
				};
			}
			
			// Chart configuration
			const config = {
				type: 'line',
				data: {
					datasets: datasets
				},
				options: {
					responsive: true,
					maintainAspectRatio: false,
					interaction: {
						mode: 'index',
						intersect: false,
					},
					scales: scales,
					plugins: {
						title: {
							display: true,
							text: sentimentData ? 
								`${coinId.toUpperCase()} Price vs Market Sentiment (7 days)` :
								`${coinId.toUpperCase()} Price History (7 days)`,
							font: {
								size: 16
							}
						},
						legend: {
							display: true,
							position: 'top'
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
										return `Sentiment: ${context.parsed.y.toFixed(2)} (${sentimentData?.category || 'neutral'})`;
									}
								}
							}
						}
					}
				}
			};
			
			// Create new chart
			chartInstance = new Chart(chartCanvas, config);
			isChartReady = true;
			
		} catch (error) {
			console.error('Error initializing chart:', error);
			isChartReady = false;
		}
	}
</script>

<DataCard title="📈 Price & Sentiment Trend" {loading} {error}>
	{#if historyData.length === 0}
		<div class="no-data">
			<div class="no-data-icon">📊</div>
			<div class="no-data-text">
				<strong>No price history available</strong>
				<div class="no-data-details">
					Please try refreshing or select a different cryptocurrency.
				</div>
			</div>
		</div>
	{:else}
		<div class="chart-container" bind:this={chartContainer}>
			<canvas bind:this={chartCanvas} id="mainChart"></canvas>
		</div>
		
		{#if sentimentData}
			<div class="chart-info">
				<div class="sentiment-summary">
					<span class="sentiment-badge {sentimentData.category}">
						{sentimentData.category === 'bullish' ? '🐂' : sentimentData.category === 'bearish' ? '🐻' : '😐'}
						{sentimentData.category.charAt(0).toUpperCase() + sentimentData.category.slice(1)}
					</span>
					<span class="sentiment-score">
						Score: {sentimentData.score.toFixed(2)}
					</span>
					{#if sentimentData.confidence}
						<span class="sentiment-confidence">
							Confidence: {(sentimentData.confidence * 100).toFixed(1)}%
						</span>
					{/if}
				</div>
			</div>
		{/if}
		
		<div class="chart-stats">
			<div class="stat">
				<span class="stat-label">Data Points:</span>
				<span class="stat-value">{historyData.length}</span>
			</div>
			<div class="stat">
				<span class="stat-label">Time Range:</span>
				<span class="stat-value">7 days</span>
			</div>
			{#if historyData.length > 0}
				<div class="stat">
					<span class="stat-label">Latest Price:</span>
					<span class="stat-value">
						${historyData[historyData.length - 1].y.toLocaleString('en-US', { 
							minimumFractionDigits: 2, 
							maximumFractionDigits: 2 
						})}
					</span>
				</div>
			{/if}
		</div>
	{/if}
</DataCard>

<style>
	.chart-container {
		height: 400px;
		margin: 1rem 0;
	}
	
	.no-data {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 2rem;
		color: var(--text-secondary);
	}
	
	.no-data-icon {
		font-size: 2rem;
		flex-shrink: 0;
	}
	
	.no-data-text strong {
		display: block;
		margin-bottom: 0.5rem;
		font-weight: 600;
		color: var(--text-primary);
	}
	
	.no-data-details {
		font-size: 0.9rem;
		opacity: 0.8;
	}
	
	.chart-info {
		margin-top: 1rem;
		padding: 1rem;
		background: var(--bg-secondary);
		border-radius: 8px;
		border: 1px solid var(--border-color);
	}
	
	.sentiment-summary {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}
	
	.sentiment-badge {
		padding: 0.5rem 1rem;
		border-radius: 20px;
		font-weight: 600;
		font-size: 0.9rem;
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
	
	.dark-theme .sentiment-badge.bullish {
		background: #2d5a2d;
		color: #90ee90;
	}
	
	.dark-theme .sentiment-badge.neutral {
		background: #404040;
		color: #d0d0d0;
	}
	
	.dark-theme .sentiment-badge.bearish {
		background: #5a2d2d;
		color: #ffb3b3;
	}
	
	.sentiment-score,
	.sentiment-confidence {
		font-size: 0.9rem;
		color: var(--text-secondary);
	}
	
	.chart-stats {
		display: flex;
		gap: 1rem;
		margin-top: 1rem;
		padding: 1rem;
		background: var(--bg-secondary);
		border-radius: 8px;
		border: 1px solid var(--border-color);
		flex-wrap: wrap;
	}
	
	.stat {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	
	.stat-label {
		font-size: 0.8rem;
		color: var(--text-secondary);
		font-weight: 500;
	}
	
	.stat-value {
		font-size: 0.9rem;
		color: var(--text-primary);
		font-weight: 600;
	}

	@keyframes spin {
		0% { transform: rotate(0deg); }
		100% { transform: rotate(360deg); }
	}
</style> 