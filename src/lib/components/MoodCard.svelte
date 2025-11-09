<script>
	import DataCard from './DataCard.svelte';
	// Props for mood data (canonical format)
	export let badge = '😐 Neutral';
	export let score = 0;
	export let source = 'Based on 0 headlines';
	export let newsItems = [];
	export let error = null;
	export let loading = false;
	export let category = 'neutral';
	export let sentimentSource = null; // 'cohere' | 'rule-based'
	export let timestamp = null; // ISO timestamp
	export let isStale = false; // true if X-Cache-Status is 'stale-if-error'
	
	// Format score with fallback
	function formatScore(score) {
		if (typeof score !== 'number' || isNaN(score)) return '0.50';
		return score.toFixed(2);
	}
	
	// Truncate news title for better display
	function truncateTitle(title, maxLength = 80) {
		if (!title || typeof title !== 'string') return '';
		return title.length > maxLength ? title.substring(0, maxLength) + '...' : title;
	}
	
	// Format timestamp as "X minutes ago" or "Just now"
	function formatTimeAgo(timestamp) {
		if (!timestamp) return '';
		try {
			const ts = new Date(timestamp);
			const now = new Date();
			const diffMs = now - ts;
			const diffMins = Math.floor(diffMs / 60000);
			if (diffMins < 1) return 'Just now';
			if (diffMins === 1) return '1 minute ago';
			if (diffMins < 60) return `${diffMins} minutes ago`;
			const diffHours = Math.floor(diffMins / 60);
			if (diffHours === 1) return '1 hour ago';
			if (diffHours < 24) return `${diffHours} hours ago`;
			const diffDays = Math.floor(diffHours / 24);
			if (diffDays === 1) return '1 day ago';
			return `${diffDays} days ago`;
		} catch (e) {
			return '';
		}
	}
	
	// Get source badge text
	function getSourceBadge(source) {
		if (source === 'cohere') return '🤖 Cohere AI';
		if (source === 'rule-based') return '📊 Rule-based';
		return '';
	}
</script>

<DataCard title="🧠 Market Mood" {loading} {error}>
	<div class="mood-widget">
		<div class="mood-header">
			<div class="mood-badge {category}">{badge}</div>
			{#if isStale}
				<div class="stale-badge">⚠️ Stale</div>
			{/if}
		</div>
		<div class="mood-score">Score: {formatScore(score)}</div>
		<div class="mood-source">{source}</div>
		<div class="mood-meta">
			{#if sentimentSource}
				<span class="source-badge">{getSourceBadge(sentimentSource)}</span>
			{/if}
			{#if timestamp}
				<span class="timestamp">Last updated: {formatTimeAgo(timestamp)}</span>
			{/if}
		</div>
	</div>

	{#if newsItems.length > 0}
		<div class="news-container">
			<h3>Recent Headlines</h3>
			{#each newsItems.slice(0, 5) as newsItem}
				<div class="news-item">
					<div class="news-title">{truncateTitle(newsItem.title)}</div>
					{#if newsItem.publishedAt}
						<div class="news-date">
							{new Date(newsItem.publishedAt).toLocaleDateString()}
						</div>
					{/if}
				</div>
			{/each}
			{#if newsItems.length > 5}
				<div class="news-more">
					+{newsItems.length - 5} more headlines analyzed
				</div>
			{/if}
		</div>
	{:else}
		<div class="no-news">
			📰 No recent headlines available
		</div>
	{/if}
</DataCard>

<style>
	.mood-widget {
		text-align: center;
		padding: 1rem;
	}
	
	.mood-badge {
		display: inline-block;
		padding: 0.5rem 1rem;
		border-radius: 20px;
		font-weight: 600;
		font-size: 1.1rem;
		margin-bottom: 1rem;
	}
	
	.mood-badge.bullish {
		background: #d4edda;
		color: #155724;
	}
	
	.mood-badge.neutral {
		background: #e9ecef;
		color: #495057;
	}
	
	.mood-badge.bearish {
		background: #f8d7da;
		color: #721c24;
	}
	
	.dark-theme .mood-badge.bullish {
		background: #2d5a2d;
		color: #90ee90;
	}
	
	.dark-theme .mood-badge.neutral {
		background: #404040;
		color: #d0d0d0;
	}
	
	.dark-theme .mood-badge.bearish {
		background: #5a2d2d;
		color: #ffb3b3;
	}
	
	.mood-score {
		font-size: 1rem;
		font-weight: 600;
		color: var(--text-primary);
		margin-bottom: 0.5rem;
	}
	
	.mood-source {
		font-size: 0.9rem;
		color: var(--text-secondary);
		margin-bottom: 0.5rem;
	}
	
	.mood-header {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}
	
	.stale-badge {
		display: inline-block;
		padding: 0.25rem 0.5rem;
		border-radius: 12px;
		font-size: 0.75rem;
		font-weight: 600;
		background: #fff3cd;
		color: #856404;
		border: 1px solid #ffc107;
	}
	
	.dark-theme .stale-badge {
		background: #3e2f1f;
		color: #ffc107;
		border-color: #856404;
	}
	
	.mood-meta {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		margin-top: 0.5rem;
		flex-wrap: wrap;
	}
	
	.source-badge {
		font-size: 0.8rem;
		color: var(--text-secondary);
		font-weight: 500;
	}
	
	.timestamp {
		font-size: 0.75rem;
		color: var(--text-secondary);
		font-style: italic;
	}
	
	.news-container {
		margin-top: 1.5rem;
		padding: 1rem;
		background: var(--bg-secondary);
		border-radius: 8px;
		border: 1px solid var(--border-color);
	}
	
	.news-container h3 {
		margin: 0 0 1rem 0;
		font-size: 1rem;
		color: var(--text-primary);
		font-weight: 600;
	}
	
	.news-item {
		margin-bottom: 0.75rem;
		padding: 0.75rem;
		background: var(--bg-primary);
		border-radius: 6px;
		border: 1px solid var(--border-color);
	}
	
	.news-title {
		font-size: 0.9rem;
		color: var(--text-primary);
		line-height: 1.4;
		margin-bottom: 0.25rem;
	}
	
	.news-date {
		font-size: 0.8rem;
		color: var(--text-secondary);
	}
	
	.news-more {
		text-align: center;
		margin-top: 1rem;
		padding: 0.5rem;
		font-size: 0.9rem;
		color: var(--text-secondary);
		font-style: italic;
	}
	
	.no-news {
		text-align: center;
		padding: 2rem;
		color: var(--text-secondary);
		font-size: 1rem;
	}
</style> 