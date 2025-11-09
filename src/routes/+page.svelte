<script>
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import PriceCard from '$lib/components/PriceCard.svelte';
	import MoodCard from '$lib/components/MoodCard.svelte';
	import ChartCard from '$lib/components/ChartCard.svelte';
	import { cryptoStore } from '$lib/stores.js';

	let selectedCoin = $cryptoStore.selectedCoin;
	let realTimeActive = false;
	let realTimeStatus = { icon: '🔴', text: 'Real-time updates stopped' };
	let realTimeInterval;
	let isRefreshing = false;

	onMount(() => {
		cryptoStore.initStore().catch(error => {
			console.error('❌ Failed to initialize store:', error);
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

	async function handleCoinChange(event) {
		const newCoin = event.target.value;
		if (newCoin === $cryptoStore.selectedCoin) return;
		
		isRefreshing = true;
		selectedCoin = newCoin;
		try {
			await cryptoStore.setCoin(newCoin);
		} catch (error) {
			console.error('❌ Failed to change coin:', error);
		} finally {
			isRefreshing = false;
		}
	}

	async function handleRefresh() {
		isRefreshing = true;
		try {
		await cryptoStore.setCoin($cryptoStore.selectedCoin);
		} catch (error) {
			console.error('❌ Failed to refresh data:', error);
		} finally {
		isRefreshing = false;
		}
	}

	function toggleRealTime() {
		realTimeActive = !realTimeActive;
		
		if (realTimeActive) {
			realTimeStatus = { icon: '🟢', text: 'Real-time updates active (every 5 min)' };
			// Start real-time updates every 5 minutes
			realTimeInterval = setInterval(async () => {
				realTimeStatus = { icon: '🔄', text: 'Updating...' };
				await cryptoStore.setCoin($cryptoStore.selectedCoin);
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

	$: priceData = $cryptoStore.priceData ? {
		price: $cryptoStore.priceData.price,
		change: $cryptoStore.priceData.change24h,
		symbol: $cryptoStore.priceData.symbol
	} : null; // null instead of default values - let PriceCard handle loading/error state

	$: moodData = $cryptoStore.newsData?.sentiment ? {
		badge: getMoodBadge($cryptoStore.newsData.sentiment.category),
		score: $cryptoStore.newsData.sentiment.score,
		source: `Based on ${$cryptoStore.newsData.headlines?.length || 0} headlines`
	} : { badge: '😐 Neutral', score: 0, source: 'Based on 0 headlines' };

	$: newsItems = $cryptoStore.newsData?.headlines || [];
	$: historyData = $cryptoStore.historyData || [];
	$: sentimentData = $cryptoStore.newsData?.sentiment || null;
</script>

<section class="controls">
	<div class="controls-layout">
		<div class="controls-row">
			<div class="controls-left">
				<div class="coin-selector">
					<label for="coinSelect">Select Cryptocurrency:</label>
					<select id="coinSelect" bind:value={selectedCoin} on:change={handleCoinChange} disabled={$cryptoStore.loading || isRefreshing}>
						{#each $cryptoStore.coins as coin}
							<option value={coin.id}>{coin.name} ({coin.symbol.toUpperCase()})</option>
						{/each}
					</select>
				</div>
				<div class="button-group">
					<button on:click={handleRefresh} disabled={$cryptoStore.loading || isRefreshing}>
						{#if $cryptoStore.loading || isRefreshing}
							🔄 Refreshing...
						{:else}
							🔄 Refresh
						{/if}
					</button>
					<button on:click={toggleRealTime} data-active={realTimeActive} disabled={$cryptoStore.loading || isRefreshing}>
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
						Last updated: <span>{new Date().toLocaleString('en-US', { timeZone: 'UTC', timeZoneName: 'short' })}</span>
					</div>
					{#if realTimeActive}
						<div class="real-time-status" data-status={realTimeStatus.icon === '🟢' ? 'active' : realTimeStatus.icon === '🔄' ? 'updating' : 'error'}>
							<span>{realTimeStatus.icon}</span> <span>{realTimeStatus.text}</span>
						</div>
					{/if}
					{#if $cryptoStore.error}
						<div class="error-message">
							❌ Refresh failed: {$cryptoStore.error}
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
		price={priceData?.price || 0} 
		change={priceData?.change || 0} 
		symbol={priceData?.symbol || 'BTC'}
		loading={$cryptoStore.loading}
		error={$cryptoStore.error || (!$cryptoStore.loading && !priceData ? 'Price data unavailable' : null)}
	/>

	<!-- Mood Card -->
	<MoodCard 
		badge={moodData.badge}
		score={moodData.score}
		source={moodData.source}
		newsItems={newsItems}
		category={sentimentData?.category || 'neutral'}
		loading={$cryptoStore.loading}
		error={$cryptoStore.error}
	/>

	<!-- Chart Card -->
	<ChartCard 
		historyData={historyData}
		sentimentData={sentimentData}
		coinId={$cryptoStore.selectedCoin}
		loading={$cryptoStore.loading}
		error={$cryptoStore.error}
	/>
</section>