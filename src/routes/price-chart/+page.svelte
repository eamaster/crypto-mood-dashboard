<script>
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import Chart from 'chart.js/auto';
	import 'chartjs-adapter-date-fns';
	import { WORKER_URL } from '../../lib/config.js';

	// Reactive variables
	let coinId = 'bitcoin';
	let loading = false;
	let error = null;
	let chartCanvas;
	let chartInstance = null;

	onMount(async () => {
		// Auto-load chart on page load
		await fetchChart();
	});

	async function fetchChart() {
		if (!browser) return;
		
		const coin = coinId.trim() || 'bitcoin';
		loading = true;
		error = null;

		try {
			// Destroy existing chart
			if (chartInstance) {
				chartInstance.destroy();
				chartInstance = null;
			}

			const response = await fetch(`${WORKER_URL}/history?coin=${coin}&days=7`);
			
			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`HTTP error! status: ${response.status} - ${errorText}`);
			}
			
			const data = await response.json();
			
			if (data.error) {
				throw new Error(data.error);
			}
			
			if (!data.prices || data.prices.length === 0) {
				throw new Error(`No price data found for "${coin}"`);
			}
			
			// Process data for Chart.js
			const prices = data.prices.map(item => ({
				x: new Date(item.timestamp),
				y: item.price
			}));
			
			// Create chart
			await createChart(prices, coin.toUpperCase());
			
		} catch (err) {
			console.error('Error fetching chart data:', err);
			error = err.message;
		} finally {
			loading = false;
		}
	}

	async function createChart(prices, coinSymbol) {
		if (!browser || !chartCanvas) return;

		try {
			chartInstance = new Chart(chartCanvas, {
				type: 'line',
				data: {
					datasets: [{
						label: `${coinSymbol} Price (USD)`,
						data: prices,
						borderColor: '#007bff',
						backgroundColor: 'rgba(0, 123, 255, 0.1)',
						borderWidth: 2,
						fill: true,
						tension: 0.1
					}]
				},
				options: {
					responsive: true,
					maintainAspectRatio: false,
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
						y: {
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
					},
					plugins: {
						title: {
							display: true,
							text: `7-Day Price History for ${coinSymbol}`,
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
									return `Price: ${context.parsed.y.toLocaleString('en-US', {
										style: 'currency',
										currency: 'USD'
									})}`;
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

	function handleKeyPress(event) {
		if (event.key === 'Enter') {
			fetchChart();
		}
	}

	function goBack() {
		goto('modules');
	}
</script>

<svelte:head>
	<title>📈 Price Chart - Crypto Mood Dashboard</title>
</svelte:head>

<div class="container">
	<div class="header">
		<h1>📈 7-Day Price Chart Demo</h1>
		<button class="back-button" on:click={goBack}>← Back to Modules</button>
	</div>
	
	<p>Enter a CoinGecko coin ID to view its 7-day price history:</p>
	
	<div class="input-group">
		<input 
			type="text" 
			bind:value={coinId}
			placeholder="bitcoin"
			on:keypress={handleKeyPress}
			disabled={loading}
		>
		<button on:click={fetchChart} disabled={loading}>
			{loading ? '⏳ Loading...' : 'Load Chart'}
		</button>
	</div>
	
	{#if loading}
		<div class="loading">⏳ Loading 7-day price data...</div>
	{:else if error}
		<div class="error">❌ Error: {error}</div>
	{/if}
	
	<div class="chart-container">
		<canvas bind:this={chartCanvas} id="priceChart"></canvas>
	</div>
</div>

<style>
	.container {
		max-width: 800px;
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

	.chart-container {
		margin-top: 1.5rem;
		height: 400px;
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

		.chart-container {
			height: 300px;
		}
	}
</style> 