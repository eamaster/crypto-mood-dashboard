<script>
	import { onMount, onDestroy } from "svelte";
	import { goto } from "$app/navigation";
	import PriceCard from "$lib/components/PriceCard.svelte";
	import MoodCard from "$lib/components/MoodCard.svelte";
	import TechSnapshotCard from "$lib/components/TechSnapshotCard.svelte";
	import ChartCard from "$lib/components/ChartCard.svelte";
	import { cryptoStore } from "$lib/stores.js";

	let selectedCoin = $cryptoStore.selectedCoin;
	let realTimeActive = false;
	let realTimeStatus = { icon: "🔴", text: "Real-time updates stopped" };
	let realTimeInterval;
	let isRefreshing = false;
	let mobileMenuOpen = false;

	onMount(() => {
		cryptoStore.initStore().catch((error) => {
			console.error("❌ Failed to initialize store:", error);
		});

		// Click outside handler for mobile menu
		document.addEventListener("click", handleClickOutside);
		document.addEventListener("keydown", handleEscapeKey);
	});

	onDestroy(() => {
		if (realTimeInterval) {
			clearInterval(realTimeInterval);
		}
		document.removeEventListener("click", handleClickOutside);
		document.removeEventListener("keydown", handleEscapeKey);
	});

	function handleClickOutside(event) {
		if (
			mobileMenuOpen &&
			!event.target.closest(".mobile-more-menu") &&
			!event.target.closest(".mobile-more-button")
		) {
			mobileMenuOpen = false;
		}
	}

	function handleEscapeKey(event) {
		if (event.key === "Escape" && mobileMenuOpen) {
			mobileMenuOpen = false;
		}
	}

	function toggleMobileMenu() {
		mobileMenuOpen = !mobileMenuOpen;
	}

	function getMoodBadge(category) {
		switch (category) {
			case "bullish":
				return "🐂 Bullish";
			case "bearish":
				return "🐻 Bearish";
			default:
				return "😐 Neutral";
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
			console.error("❌ Failed to change coin:", error);
		} finally {
			isRefreshing = false;
		}
	}

	async function handleRefresh() {
		isRefreshing = true;
		try {
			await cryptoStore.setCoin($cryptoStore.selectedCoin);
		} catch (error) {
			console.error("❌ Failed to refresh data:", error);
		} finally {
			isRefreshing = false;
		}
	}

	function toggleRealTime() {
		realTimeActive = !realTimeActive;

		if (realTimeActive) {
			realTimeStatus = {
				icon: "🟢",
				text: "Real-time updates active (every 5 min)",
			};
			// Start real-time updates every 5 minutes
			realTimeInterval = setInterval(
				async () => {
					realTimeStatus = { icon: "🔄", text: "Updating..." };
					await cryptoStore.setCoin($cryptoStore.selectedCoin);
					realTimeStatus = {
						icon: "🟢",
						text: "Real-time updates active (every 5 min)",
					};
				},
				5 * 60 * 1000,
			); // 5 minutes
		} else {
			realTimeStatus = { icon: "🔴", text: "Real-time updates stopped" };
			if (realTimeInterval) {
				clearInterval(realTimeInterval);
				realTimeInterval = null;
			}
		}
	}

	function navigateToTechnicalAnalysis() {
		goto("technical-analysis");
		mobileMenuOpen = false; // Close menu on mobile
	}

	function navigateToModules() {
		goto("modules");
		mobileMenuOpen = false; // Close menu on mobile
	}

	$: priceData = $cryptoStore.priceData
		? {
				price: $cryptoStore.priceData.price,
				change: $cryptoStore.priceData.change24h,
				symbol: $cryptoStore.priceData.symbol,
				source: $cryptoStore.priceData.source || null,
			}
		: null; // null instead of default values - let PriceCard handle loading/error state

	$: moodData = $cryptoStore.newsData?.sentiment
		? {
				badge: getMoodBadge(
					$cryptoStore.newsData.sentiment.category ||
						$cryptoStore.newsData.sentiment.label?.toLowerCase() ||
						"neutral",
				),
				score: $cryptoStore.newsData.sentiment.score || 0.5,
				source: `Based on ${$cryptoStore.newsData.sentiment.count || $cryptoStore.newsData.headlines?.length || 0} headlines`,
				category:
					$cryptoStore.newsData.sentiment.category ||
					$cryptoStore.newsData.sentiment.label?.toLowerCase() ||
					"neutral",
				sentimentSource: $cryptoStore.newsData.sentiment.source || null,
				timestamp: $cryptoStore.newsData.sentiment.timestamp || null,
				isStale: false, // TODO: Extract from response headers if available
			}
		: {
				badge: "😐 Neutral",
				score: 0.5,
				source: "Based on 0 headlines",
				category: "neutral",
				sentimentSource: null,
				timestamp: null,
				isStale: false,
			};

	$: newsItems = $cryptoStore.newsData?.headlines || [];
	$: historyData = $cryptoStore.historyData || [];
	$: sentimentData = $cryptoStore.newsData?.sentiment || null;
	$: largePatch = $cryptoStore.largePatch || null;
</script>

<section class="controls">
	<div class="controls-card">
		<!-- Desktop: Single row with coin selector + buttons + last updated -->
		<div class="controls-row-main desktop-controls">
			<select
				id="coinSelect"
				class="coin-select-pill"
				bind:value={selectedCoin}
				on:change={handleCoinChange}
				disabled={$cryptoStore.loading || isRefreshing}
			>
				{#each $cryptoStore.coins as coin}
					<option value={coin.id}
						>{coin.name} ({coin.symbol.toUpperCase()})</option
					>
				{/each}
			</select>
			<button
				class="btn-icon-refresh"
				on:click={handleRefresh}
				disabled={$cryptoStore.loading || isRefreshing}
				title="Refresh data"
			>
				<span class="icon"
					>{#if $cryptoStore.loading || isRefreshing}🔄{:else}🔄{/if}</span
				>
				<span class="label">Refresh</span>
			</button>
			<button
				class="btn-primary"
				class:active={realTimeActive}
				on:click={toggleRealTime}
				data-active={realTimeActive}
				disabled={$cryptoStore.loading || isRefreshing}
			>
				{#if realTimeActive}
					<span class="icon">{realTimeStatus.icon}</span>
					{realTimeStatus.text}
				{:else}
					<span class="icon">📡</span>
					Start Real-Time (5min)
				{/if}
			</button>
			<button
				class="btn-secondary"
				on:click={navigateToTechnicalAnalysis}
			>
				<span class="icon">🔍</span>
				Technical Analysis
			</button>
			<button class="btn-secondary" on:click={navigateToModules}>
				<span class="icon">📊</span>
				View all modules
			</button>
		</div>

		<!-- Mobile: Coin selector on top, buttons below -->
		<div class="mobile-controls">
			<select
				id="coinSelectMobile"
				class="coin-select-pill"
				bind:value={selectedCoin}
				on:change={handleCoinChange}
				disabled={$cryptoStore.loading || isRefreshing}
			>
				{#each $cryptoStore.coins as coin}
					<option value={coin.id}
						>{coin.name} ({coin.symbol.toUpperCase()})</option
					>
				{/each}
			</select>
			<div class="mobile-buttons-row">
				<button
					class="btn-icon-mobile"
					on:click={handleRefresh}
					disabled={$cryptoStore.loading || isRefreshing}
					title="Refresh"
					aria-label="Refresh data"
				>
					🔄
				</button>
				<button
					class="btn-primary-mobile"
					class:active={realTimeActive}
					on:click={toggleRealTime}
					data-active={realTimeActive}
					disabled={$cryptoStore.loading || isRefreshing}
				>
					{#if realTimeActive}
						<span class="icon">{realTimeStatus.icon}</span>
						{realTimeStatus.text}
					{:else}
						<span class="icon">📡</span>
						Start Real-Time (5min)
					{/if}
				</button>
				<button
					class="btn-icon-mobile"
					title="Search"
					aria-label="Search"
				>
					🔍
				</button>
				<button
					class="btn-icon-mobile mobile-more-button"
					on:click={toggleMobileMenu}
					title="More actions"
					aria-label="More actions"
					aria-expanded={mobileMenuOpen}
					aria-controls="mobile-menu"
				>
					⋯
				</button>
			</div>
		</div>

		<!-- Mobile "More Actions" Menu -->
		{#if mobileMenuOpen}
			<div class="mobile-more-menu" id="mobile-menu" role="menu">
				<div class="menu-title">More actions</div>
				<button
					class="menu-item"
					on:click={navigateToTechnicalAnalysis}
					role="menuitem"
				>
					<span class="icon">🔍</span>
					Technical Analysis
				</button>
				<button
					class="menu-item"
					on:click={navigateToModules}
					role="menuitem"
				>
					<span class="icon">📊</span>
					View all modules
				</button>
			</div>
		{/if}

		{#if $cryptoStore.error}
			<div class="error-wrapper">
				<div class="error-message">
					❌ Refresh failed: {$cryptoStore.error}
				</div>
			</div>
		{/if}
	</div>
</section>

<section class="dashboard-grid">
	<!-- Price Card -->
	<PriceCard
		price={priceData?.price || 0}
		change={priceData?.change || 0}
		symbol={priceData?.symbol || "BTC"}
		priceSource={priceData?.source || null}
		loading={$cryptoStore.loading}
		error={$cryptoStore.error ||
			(!$cryptoStore.loading && !priceData
				? "Price data unavailable"
				: null)}
	/>

	<!-- Mood Card -->
	<MoodCard
		badge={moodData.badge}
		score={moodData.score}
		source={moodData.source}
		{newsItems}
		category={moodData.category}
		sentimentSource={moodData.sentimentSource}
		timestamp={moodData.timestamp}
		isStale={moodData.isStale}
		loading={$cryptoStore.loading}
		error={$cryptoStore.error}
	/>

	<!-- Technical Snapshot Card -->
	<TechSnapshotCard />

	<!-- Chart Card -->
	<ChartCard
		{historyData}
		{sentimentData}
		coinId={$cryptoStore.selectedCoin}
		loading={$cryptoStore.loading}
		error={$cryptoStore.error}
	/>
</section>
