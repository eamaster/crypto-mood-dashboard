<script>
	// Props for price data
	export let price = 0;
	export let change = 0;
	export let symbol = 'BTC';
	export let error = null;
	export let loading = false;
	
	// Format price with fallback
	function formatPrice(price) {
		if (typeof price !== 'number' || isNaN(price)) return '$0.00';
		return price.toLocaleString('en-US', { 
			style: 'currency', 
			currency: 'USD',
			minimumFractionDigits: 2, 
			maximumFractionDigits: 2 
		});
	}
	
	// Format change with fallback
	function formatChange(change) {
		if (typeof change !== 'number' || isNaN(change)) return '0.00';
		return change.toFixed(2);
	}
</script>

<div class="card price-card">
	<h2>💰 Current Price</h2>
	
	{#if loading}
		<div class="loading">
			<div class="spinner"></div>
			Loading price data...
		</div>
	{:else if error}
		<div class="error-message">
			<div class="error-icon">⚠️</div>
			<div class="error-text">
				<strong>Price data unavailable</strong>
				<div class="error-details">
					{#if error.includes('429')}
						Rate limit exceeded. Please try again in a few minutes.
					{:else if error.includes('404')}
						Cryptocurrency not found. Please select a different coin.
					{:else if error.includes('fetch')}
						Network error. Please check your internet connection.
					{:else}
						{error}
					{/if}
				</div>
			</div>
		</div>
	{:else}
		<div class="price-widget">
			<div class="price-value">{formatPrice(price)}</div>
			<div class="price-change" class:positive={change >= 0} class:negative={change < 0}>
				{change >= 0 ? '+' : ''}{formatChange(change)}%
			</div>
			<div class="price-symbol">{symbol.toUpperCase()}</div>
		</div>
	{/if}
</div>

<style>
	.loading {
		display: flex;
		justify-content: center;
		align-items: center;
		padding: 2rem;
		font-size: 1.1rem;
		color: var(--text-secondary);
		flex-direction: column;
		gap: 1rem;
	}

	.spinner {
		width: 24px;
		height: 24px;
		border: 3px solid var(--border-color);
		border-top: 3px solid var(--accent-color);
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		0% { transform: rotate(0deg); }
		100% { transform: rotate(360deg); }
	}
	
	.error-message {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 1.5rem;
		background-color: #fef2f2;
		border: 1px solid #fecaca;
		border-radius: 8px;
		color: #991b1b;
		margin: 1rem 0;
	}
	
	.dark-theme .error-message {
		background-color: #431a1a;
		border-color: #7f2020;
		color: #fca5a5;
	}
	
	.error-icon {
		font-size: 1.2rem;
		flex-shrink: 0;
	}
	
	.error-text {
		flex: 1;
	}
	
	.error-text strong {
		display: block;
		margin-bottom: 0.5rem;
		font-weight: 600;
	}
	
	.error-details {
		font-size: 0.9rem;
		opacity: 0.8;
	}
	
	.price-widget {
		text-align: center;
		padding: 1rem;
	}
	
	.price-value {
		font-size: 2rem;
		font-weight: 700;
		color: var(--text-primary);
		margin-bottom: 0.5rem;
	}
	
	.price-change {
		font-size: 1.1rem;
		font-weight: 600;
		margin-bottom: 0.5rem;
	}
	
	.price-change.positive {
		color: var(--success-color);
	}
	
	.price-change.negative {
		color: var(--danger-color);
	}
	
	.price-symbol {
		font-size: 0.9rem;
		color: var(--text-secondary);
		font-weight: 500;
	}
</style> 