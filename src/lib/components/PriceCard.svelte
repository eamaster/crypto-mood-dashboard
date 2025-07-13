<script>
	import DataCard from './DataCard.svelte';
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

<DataCard title="💰 Current Price" {loading} {error}>
	<div class="price-widget">
		<div class="price-value">{formatPrice(price)}</div>
		<div class="price-change" class:positive={change >= 0} class:negative={change < 0}>
			{change >= 0 ? '+' : ''}{formatChange(change)}%
		</div>
		<div class="price-symbol">{symbol.toUpperCase()}</div>
	</div>
</DataCard>

<style>
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