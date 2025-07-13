<script>
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';

	// Worker URL
	const WORKER_URL = 'https://crypto-mood-dashboard-production.smah0085.workers.dev';

	// Reactive variables
	let coinName = 'bitcoin';
	let loading = false;
	let error = null;
	let newsArticles = [];

	onMount(() => {
		// Auto-fetch on page load
		fetchNews();
	});

	async function fetchNews() {
		const coin = coinName.trim().toLowerCase() || 'bitcoin';
		loading = true;
		error = null;
		newsArticles = [];

		try {
			const response = await fetch(`${WORKER_URL}/news?coin=${coin}`);
			
			if (!response.ok) {
				throw new Error(`Failed to fetch news for ${coin}. HTTP status: ${response.status}`);
			}
			
			const data = await response.json();
			
			if (data.error) {
				throw new Error(data.error);
			}
			
			if (!data.headlines || data.headlines.length === 0) {
				throw new Error(`No news found for ${coin}`);
			}
			
			newsArticles = data.headlines;
			
		} catch (err) {
			console.error('Error fetching news:', err);
			error = err.message;
		} finally {
			loading = false;
		}
	}

	function handleKeyPress(event) {
		if (event.key === 'Enter') {
			fetchNews();
		}
	}

	function goBack() {
		goto('/modules');
	}

	function escapeHtml(text) {
		const div = document.createElement('div');
		div.textContent = text;
		return div.innerHTML;
	}

	function getTimeAgo(date) {
		const now = new Date();
		const diffMs = now - date;
		const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
		const diffDays = Math.floor(diffHours / 24);
		
		if (diffDays > 0) {
			return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
		} else if (diffHours > 0) {
			return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
		} else {
			const diffMins = Math.floor(diffMs / (1000 * 60));
			return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
		}
	}
</script>

<svelte:head>
	<title>📰 Coin News - Crypto Mood Dashboard</title>
	<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📰</text></svg>">
</svelte:head>

<div class="container">
	<div class="header">
		<h1>📰 Cryptocurrency News</h1>
		<button class="back-button" on:click={goBack}>← Back to Modules</button>
	</div>
	
	<p>Get the latest cryptocurrency news articles powered by <a href="https://newsapi.org/" target="_blank" rel="noopener">NewsAPI.org</a>. Enter any cryptocurrency name to see recent headlines and insights.</p>
	
	<div class="input-group">
		<input 
			type="text" 
			bind:value={coinName}
			placeholder="bitcoin"
			on:keypress={handleKeyPress}
			disabled={loading}
		>
		<button on:click={fetchNews} disabled={loading}>
			{loading ? '⏳ Loading...' : 'Fetch News'}
		</button>
	</div>
	
	{#if loading}
		<div class="loading">⏳ Loading news headlines...</div>
	{:else if error}
		<div class="error">
			<strong>❌ Error: {error}</strong><br>
			<small>Try using a different coin name or check if the subreddit exists.</small>
		</div>
	{:else if newsArticles.length > 0}
		<div class="news-container">
			<div class="news-info">
				📡 Powered by <strong><a href="https://newsapi.org/" target="_blank" rel="noopener">NewsAPI.org</a></strong> • 
				{newsArticles.length} articles found • 
				Search: "{coinName} cryptocurrency"
			</div>
			
			<ul class="news-list">
				{#each newsArticles as article, index}
					<li class="news-item">
						<div class="news-title">
							{index + 1}. {article.title}
						</div>
						<div class="news-meta">
							📰 {article.source || 'Unknown'} • 
							{#if article.author}✍️ {article.author} • {/if}
							⏰ {getTimeAgo(new Date(article.published))} • 
							<a href={article.url} target="_blank" rel="noopener">
								Read Article
							</a>
						</div>
						{#if article.description}
							<div class="news-description">
								{article.description.substring(0, 200)}{#if article.description.length > 200}...{/if}
							</div>
						{/if}
						{#if article.urlToImage}
							<div class="news-image">
								<img 
									src={article.urlToImage} 
									alt="Article image" 
									loading="lazy"
									on:error={(e) => e.target.style.display = 'none'}
								>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		</div>
	{/if}
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

	p a {
		color: var(--accent-color);
		text-decoration: none;
	}

	p a:hover {
		text-decoration: underline;
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
		margin-top: 2rem;
		font-size: 1.2rem;
		color: var(--text-secondary);
	}

	.error {
		color: var(--danger-color);
		margin-top: 1.5rem;
		padding: 1rem;
		background: #f8d7da;
		border-radius: 6px;
		text-align: center;
	}

	.news-container {
		margin-top: 1.5rem;
	}

	.news-info {
		background: var(--bg-tertiary);
		padding: 0.75rem;
		border-radius: 6px;
		margin-bottom: 1rem;
		font-size: 0.9rem;
		color: var(--text-secondary);
	}

	.news-info a {
		color: var(--accent-color);
		text-decoration: none;
	}

	.news-info a:hover {
		text-decoration: underline;
	}

	.news-list {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.news-item {
		background: var(--bg-secondary);
		margin: 1rem 0;
		padding: 1rem;
		border-radius: 8px;
		border-left: 4px solid var(--accent-color);
		transition: all 0.3s ease;
	}

	.news-item:hover {
		box-shadow: var(--shadow);
		transform: translateY(-1px);
	}

	.news-title {
		font-weight: 600;
		margin-bottom: 0.5rem;
		color: var(--text-primary);
		line-height: 1.4;
	}

	.news-meta {
		font-size: 0.85rem;
		color: var(--text-secondary);
		margin-bottom: 0.75rem;
		line-height: 1.3;
	}

	.news-meta a {
		color: var(--accent-color);
		text-decoration: none;
	}

	.news-meta a:hover {
		text-decoration: underline;
	}

	.news-description {
		margin-top: 0.5rem;
		font-size: 0.9rem;
		color: var(--text-secondary);
		line-height: 1.4;
	}

	.news-image {
		margin-top: 0.75rem;
	}

	.news-image img {
		max-width: 100%;
		height: auto;
		border-radius: 6px;
		max-height: 150px;
		object-fit: cover;
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

		.news-item {
			padding: 0.75rem;
		}
	}
</style> 