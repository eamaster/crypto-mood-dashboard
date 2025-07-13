<script>
	// Props for mood data
	export let badge = '😐 Neutral';
	export let score = 0;
	export let source = 'Based on 0 headlines';
	export let newsItems = [];
	export let error = null;
	export let loading = false;
	export let category = 'neutral';
	
	// Format score with fallback
	function formatScore(score) {
		if (typeof score !== 'number' || isNaN(score)) return '0.00';
		return score.toFixed(2);
	}
	
	// Truncate news title for better display
	function truncateTitle(title, maxLength = 80) {
		if (!title || typeof title !== 'string') return '';
		return title.length > maxLength ? title.substring(0, maxLength) + '...' : title;
	}
</script>

<div class="card mood-card">
	<h2>🧠 Market Mood</h2>
	
	{#if loading}
		<div class="loading">
			<div class="spinner"></div>
			Loading sentiment data...
		</div>
	{:else if error}
		<div class="error-message">
			<div class="error-icon">⚠️</div>
			<div class="error-text">
				<strong>Sentiment data unavailable</strong>
				<div class="error-details">
					{#if error.includes('NewsAPI key')}
						News service temporarily unavailable. Using fallback analysis.
					{:else if error.includes('429')}
						Rate limit exceeded. Please try again in a few minutes.
					{:else if error.includes('fetch')}
						Network error. Please check your internet connection.
					{:else}
						{error}
					{/if}
				</div>
			</div>
		</div>
	{:else}
		<div class="mood-widget">
			<div class="mood-badge {category}">{badge}</div>
			<div class="mood-score">Score: {formatScore(score)}</div>
			<div class="mood-source">{source}</div>
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