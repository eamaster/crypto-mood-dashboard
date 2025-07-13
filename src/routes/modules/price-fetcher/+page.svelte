<script>
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';

	// Worker URL
	const WORKER_URL = 'https://crypto-mood-dashboard-production.smah0085.workers.dev';

	// Reactive variables
	let coinId = 'bitcoin';
	let loading = false;
	let error = null;
	let priceData = null;

	onMount(() => {
		// Auto-fetch on page load
		fetchPrice();
	});

	async function fetchPrice() {
		const coin = coinId.trim() || 'bitcoin';
		loading = true;
		error = null;
		priceData = null;

		try {
			const response = await fetch(`${WORKER_URL}/price?coin=${coin}`);
			
			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}
			
			const data = await response.json();
			
			if (data.error) {
				throw new Error(data.error);
			}
			
			priceData = {
				price: data.price,
				change24h: data.change24h,
				symbol: data.symbol,
				timestamp: new Date()
			};
			
		} catch (err) {
			console.error('Error fetching price:', err);
			error = err.message;
		} finally {
			loading = false;
		}
	}

	function handleKeyPress(event) {
		if (event.key === 'Enter') {
			fetchPrice();
		}
	}

	function goBack() {
		goto('/modules');
	}
</script>

<svelte:head>
	<title>🚀 Price Fetcher - Crypto Mood Dashboard</title>
</svelte:head>

<div class="container">
	<div class="header">
		<h1>🚀 Price Fetcher Demo</h1>
		<button class="back-button" on:click={goBack}>← Back to Modules</button>
	</div>
	
	<p>Enter a CoinGecko coin ID to fetch its current price:</p>
	
	<div class="input-group">
		<input 
			type="text" 
			bind:value={coinId}
			placeholder="bitcoin"
			on:keypress={handleKeyPress}
			disabled={loading}
		>
		<button on:click={fetchPrice} disabled={loading}>
			{loading ? '⏳ Fetching...' : 'Fetch Price'}
		</button>
	</div>
	
	<div class="result">
		{#if loading}
			<div class="loading">⏳ Fetching price...</div>
		{:else if error}
			<div class="error">❌ Error: {error}</div>
		{:else if priceData}
			<div class="price-display">
				<div class="price">{priceData.symbol} price: {priceData.price.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</div>
				<div class="change" class:positive={priceData.change24h >= 0} class:negative={priceData.change24h < 0}>
					24h change: {priceData.change24h >= 0 ? '+' : ''}{priceData.change24h?.toFixed(2)}%
				</div>
				<div class="timestamp">
					Updated: {priceData.timestamp.toLocaleString()}
				</div>
			</div>
		{:else}
			<div class="placeholder">Enter a coin ID and click "Fetch Price"</div>
		{/if}
	</div>
</div>

<style>
	.container {
		max-width: 600px;
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

	.result {
		background: var(--bg-secondary);
		padding: 1.5rem;
		border-radius: 8px;
		min-height: 100px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.loading {
		color: var(--text-secondary);
		font-size: 1.1rem;
	}

	.error {
		color: var(--danger-color);
		background: #f8d7da;
		padding: 1rem;
		border-radius: 6px;
		text-align: center;
	}

	.placeholder {
		color: var(--text-secondary);
		text-align: center;
		font-style: italic;
	}

	.price-display {
		text-align: center;
		width: 100%;
	}

	.price {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--success-color);
		margin-bottom: 0.75rem;
	}

	.change {
		font-size: 1.1rem;
		font-weight: 600;
		margin-bottom: 0.75rem;
	}

	.change.positive {
		color: var(--success-color);
	}

	.change.negative {
		color: var(--danger-color);
	}

	.timestamp {
		font-size: 0.9rem;
		color: var(--text-secondary);
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

		.price {
			font-size: 1.3rem;
		}
	}
</style> 