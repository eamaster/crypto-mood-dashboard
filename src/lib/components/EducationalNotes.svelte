<script>
	export let priceDataLength = 0;
	export let indicatorsLength = 0;
	export let candlePatternsLength = 0;
	export let compact = false;
</script>

<div id="educational-notes" class="educational-card">
	<div class="card">
		<h3>📚 Educational Notes</h3>
		<div class="educational-content">
			<strong>• Adaptive Indicators:</strong> Period lengths automatically adjust based on available data ({priceDataLength} points)
			<br><strong>• Technical Indicators:</strong> 
			{#if indicatorsLength > 0}
				RSI, SMA, and Bollinger Bands with adaptive periods provide quantitative analysis
			{:else}
				RSI, SMA, and Bollinger Bands provide quantitative analysis
			{/if}
			<br><strong>• Pattern Analysis:</strong> 
			{#if candlePatternsLength > 0}
				{candlePatternsLength} patterns detected for market psychology insights
			{:else}
				Visual patterns reveal market psychology and sentiment
			{/if}
			<br><strong>• Combined Analysis:</strong> Both technical indicators and price patterns work together for comprehensive market analysis
			<br><strong>• Pattern Recognition:</strong> Doji = indecision, Hammer = potential reversal, Strong candles = momentum, Continuation = trend persistence
			<br><strong>• AI Enhancement:</strong> Machine learning analyzes all signals together for improved accuracy and market mood classification
			<br><strong>• Data Quality:</strong> 
			{#if priceDataLength >= 50}
				Optimal data quality (50+ points) - Highly reliable indicators
			{:else if priceDataLength >= 20}
				Reliable data quality (20+ points) - Good indicator accuracy
			{:else if priceDataLength >= 10}
				Sufficient data quality (10+ points) - Moderate indicator reliability
			{:else}
				Limited data quality (&lt;10 points) - Use with caution, consider longer timeframe
			{/if}
		</div>
	</div>
</div>

<style>
	.educational-card {
		width: 100%;
		box-sizing: border-box;
		min-height: 0;
		margin-bottom: 0;
	}

	.educational-card .card {
		background: var(--bg-secondary);
		padding: 1.5rem;
		padding-bottom: 1rem;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		margin-bottom: 0;
		box-sizing: border-box;
	}

	.educational-card .card h3 {
		color: var(--text-primary);
		margin: 0 0 0.75rem 0;
		font-size: 1.3rem;
		font-weight: 600;
	}

	.educational-content {
		font-size: 0.9rem;
		color: var(--text-secondary);
		line-height: 1.6;
	}

	.educational-content strong {
		color: var(--text-primary);
	}

	@media (max-width: 768px) {
		.educational-card .card {
			padding: 1rem;
			padding-bottom: 0.75rem;
		}

		.educational-card .card h3 {
			font-size: 1.1rem;
			margin-bottom: 0.5rem;
		}

		.educational-content {
			font-size: 0.85rem;
		}
	}
</style>

