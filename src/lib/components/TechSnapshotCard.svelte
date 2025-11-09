<script>
	import DataCard from './DataCard.svelte';
	import { cryptoStore } from '../stores.js';
	import { WORKER_URL } from '../config.js';
	import { sma, rsiWilder, bollinger } from '../ta/indicators';

	// Reactive store subscriptions
	$: selectedCoin = $cryptoStore.selectedCoin;
	$: historyData = $cryptoStore.historyData || [];
	$: storeLoading = $cryptoStore.loading;
	$: storeError = $cryptoStore.error;

	let ohlcData = null;
	let ohlcLoading = false;
	let ohlcError = null;
	let lastFetchedCoin = null;

	// Extract close prices from historyData
	$: closes = historyData.map(d => d.y);

	// Determine if we need OHLC data
	$: needsOHLC = closes.length < 50 && selectedCoin && !storeLoading;

	// Fetch OHLC data when needed
	$: if (needsOHLC && selectedCoin !== lastFetchedCoin && !ohlcLoading) {
		fetchOHLCData(selectedCoin);
	}

	// Reset data when coin changes
	$: if (selectedCoin && selectedCoin !== lastFetchedCoin && lastFetchedCoin !== null) {
		ohlcData = null;
		ohlcError = null;
	}

	async function fetchOHLCData(coinId) {
		if (!coinId || ohlcLoading) return;
		lastFetchedCoin = coinId;
		ohlcLoading = true;
		ohlcError = null;
		try {
			// Fetch 60 days of OHLC data to ensure we have enough points for SMA50 (50 points),
			// RSI14 (15 points), and Bollinger Bands (20 points). The worker uses daily bars
			// when days >= 7, which is perfect for technical analysis indicators.
			const url = `${WORKER_URL}/ohlc?coin=${encodeURIComponent(coinId)}&days=60&_=${Date.now()}`;
			const res = await fetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = await res.json();
			if (!data || !Array.isArray(data.ohlc)) {
				throw new Error('Invalid OHLC payload');
			}
			// Only update if we're still on the same coin
			if (selectedCoin === coinId) {
				ohlcData = data.ohlc.map(candle => candle.close);
			}
		} catch (err) {
			console.error('Error fetching OHLC:', err);
			if (selectedCoin === coinId) {
				ohlcError = err.message;
			}
			lastFetchedCoin = null; // Allow retry
		} finally {
			if (selectedCoin === coinId) {
				ohlcLoading = false;
			}
		}
	}

	// Combine historyData closes with OHLC data if available
	$: allCloses = ohlcData && ohlcData.length > closes.length 
		? ohlcData 
		: closes;

	// Combine loading and error states
	$: loading = storeLoading || ohlcLoading;
	$: error = storeError || ohlcError;

	// Compute indicators
	$: rsi = allCloses.length >= 15 ? rsiWilder(allCloses, 14) : null;
	$: sma20 = allCloses.length >= 20 ? sma(allCloses, 20) : null;
	$: sma50 = allCloses.length >= 50 ? sma(allCloses, 50) : null;
	$: bb = allCloses.length >= 20 ? bollinger(allCloses, 20, 2) : null;

	// Determine RSI status
	$: rsiStatus = rsi === null 
		? null 
		: rsi >= 70 
			? 'overbought' 
			: rsi <= 30 
				? 'oversold' 
				: 'neutral';

	// Determine SMA crossover state (ε = 0.05% of price to reduce churn)
	$: maState = (() => {
		if (sma20 === null || sma50 === null) return null;
		const lastPrice = allCloses[allCloses.length - 1];
		const epsilon = lastPrice * 0.0005; // 0.05%
		if (sma20 > sma50 + epsilon) return 'bullish';
		if (sma20 < sma50 - epsilon) return 'bearish';
		return 'flat';
	})();

	// Format percentage
	function formatPercent(value) {
		if (value === null || value === undefined) return 'n/a';
		return value >= 0 ? `+${value.toFixed(1)}%` : `${value.toFixed(1)}%`;
	}

	// Format RSI value
	function formatRSI(value) {
		if (value === null || value === undefined) return 'n/a';
		return value.toFixed(1);
	}
</script>

<DataCard title="🧪 Technical Snapshot" {loading} {error}>
	<div class="tech-snapshot">
		<!-- RSI Row -->
		<div class="indicator-row">
			<div class="indicator-label">RSI(14):</div>
			<div class="indicator-value" class:dimmed={rsi === null}>
				{formatRSI(rsi)}
			</div>
			{#if rsiStatus}
				<span class="status-badge rsi-{rsiStatus}">
					{#if rsiStatus === 'overbought'}
						Overbought
					{:else if rsiStatus === 'oversold'}
						Oversold
					{:else}
						Neutral
					{/if}
				</span>
			{:else}
				<span class="status-badge dimmed">n/a</span>
			{/if}
		</div>

		<!-- SMA Crossover Row -->
		<div class="indicator-row">
			<div class="indicator-label">SMA20 vs SMA50:</div>
			<div class="indicator-value" class:dimmed={maState === null}>
				{#if maState === 'bullish'}
					<span class="ma-icon">▲</span> Bullish (20&gt;50)
				{:else if maState === 'bearish'}
					<span class="ma-icon">▼</span> Bearish (20&lt;50)
				{:else if maState === 'flat'}
					<span class="ma-icon">─</span> Flat
				{:else}
					n/a
				{/if}
			</div>
		</div>

		<!-- Bollinger Bands Row -->
		<div class="indicator-row">
			<div class="indicator-label">Bands:</div>
			<div class="indicator-value" class:dimmed={bb === null}>
				{#if bb}
					{#if bb.position === 'above'}
						Above upper
					{:else if bb.position === 'below'}
						Below lower
					{:else}
						Inside
					{/if}
					<span class="bands-distance">
						• {formatPercent(((allCloses[allCloses.length - 1] - bb.middle) / bb.middle) * 100)} from middle
					</span>
				{:else}
					n/a
				{/if}
			</div>
		</div>
	</div>
</DataCard>

<style>
	.tech-snapshot {
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.indicator-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.95rem;
		flex-wrap: wrap;
	}

	.indicator-label {
		font-weight: 600;
		color: var(--text-primary);
		min-width: 120px;
	}

	.indicator-value {
		flex: 1;
		color: var(--text-primary);
		font-weight: 500;
	}

	.indicator-value.dimmed {
		color: var(--text-secondary);
		opacity: 0.6;
	}

	.status-badge {
		display: inline-block;
		padding: 0.25rem 0.75rem;
		border-radius: 12px;
		font-size: 0.85rem;
		font-weight: 600;
		white-space: nowrap;
	}

	.status-badge.dimmed {
		background: var(--bg-secondary);
		color: var(--text-secondary);
		opacity: 0.6;
	}

	/* RSI badge colors: Overbought (≥70) = green, Neutral (30-70) = gray, Oversold (≤30) = red
	   Note: This mirrors MoodCard badge classes per requirements, though it's counterintuitive
	   from a trading perspective (typically overbought=red/bearish, oversold=green/bullish) */
	.status-badge.rsi-overbought {
		background: #d4edda;
		color: #155724;
	}

	.status-badge.rsi-neutral {
		background: #e9ecef;
		color: #495057;
	}

	.status-badge.rsi-oversold {
		background: #f8d7da;
		color: #721c24;
	}

	.dark-theme .status-badge.rsi-overbought {
		background: #2d5a2d;
		color: #90ee90;
	}

	.dark-theme .status-badge.rsi-neutral {
		background: #404040;
		color: #d0d0d0;
	}

	.dark-theme .status-badge.rsi-oversold {
		background: #5a2d2d;
		color: #ffb3b3;
	}

	.ma-icon {
		font-size: 0.9rem;
		margin-right: 0.25rem;
	}

	.bands-distance {
		color: var(--text-secondary);
		font-size: 0.9rem;
		margin-left: 0.5rem;
	}
</style>

