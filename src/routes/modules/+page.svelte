<script>
	import { goto } from '$app/navigation';

	const modules = [
		{
			id: 'technical-analysis',
			title: '🔍 Technical Analysis',
			description: 'Professional crypto technical indicators and signals with AI-powered analysis',
			features: ['RSI, SMA, Bollinger Bands', 'Pattern Recognition', 'AI Market Analysis', 'Interactive Charts'],
			path: '../technical-analysis'
		},
		{
			id: 'price-fetcher',
			title: '🚀 Price Fetcher',
			description: 'Fetch real-time cryptocurrency prices with 24h change data',
			features: ['Real-time Prices', 'CoinGecko Integration', '24h Change Data', 'Multi-coin Support'],
			path: '../price-fetcher'
		},
		{
			id: 'coin-news',
			title: '📰 Coin News',
			description: 'Get the latest cryptocurrency news articles powered by NewsAPI.org',
			features: ['Latest Headlines', 'News Analysis', 'Multiple Sources', 'Real-time Updates'],
			path: '../coin-news'
		},
		{
			id: 'price-chart',
			title: '📈 Price Chart',
			description: 'Interactive 7-day price history charts for any cryptocurrency',
			features: ['7-day History', 'Interactive Charts', 'Time-based Analysis', 'Chart.js Integration'],
			path: '../price-chart'
		},
		{
			id: 'sentiment-analyzer',
			title: '🧠 Sentiment Analyzer',
			description: 'AI-powered sentiment analysis of cryptocurrency news headlines',
			features: ['AI Analysis', 'Confidence Scoring', 'Bullish/Bearish Detection', 'Enhanced Metrics'],
			path: '../sentiment-analyzer'
		},
		{
			id: 'mood-impact-chart',
			title: '📊 Mood Impact Chart',
			description: 'Combines price data with sentiment analysis for comprehensive market view',
			features: ['Price vs Sentiment', 'Dual-axis Charts', 'Impact Analysis', 'Combined Visualization'],
			path: '../mood-impact-chart'
		},
		{
			id: 'coming-soon-1',
			title: '📊 Portfolio Tracker',
			description: 'Track your crypto portfolio with real-time updates',
			features: ['Portfolio Overview', 'P&L Tracking', 'Asset Allocation', 'Performance Analytics'],
			path: '#',
			comingSoon: true
		},
		{
			id: 'coming-soon-2',
			title: '🚨 Price Alerts',
			description: 'Set up intelligent price alerts and notifications',
			features: ['Custom Alerts', 'Email Notifications', 'Technical Triggers', 'Multi-Exchange Support'],
			path: '#',
			comingSoon: true
		}
	];

	function navigateToModule(module) {
		if (module.comingSoon) {
			alert('This module is coming soon! Stay tuned for updates.');
			return;
		}
		goto(module.path);
	}

	function goBackToDashboard() {
		goto('../');
	}
</script>

<svelte:head>
	<title>📦 Modules - Crypto Mood Dashboard</title>
</svelte:head>

<div class="modules-container">
	<div class="modules-header">
		<h1>📦 Dashboard Modules</h1>
		<p class="subtitle">Explore additional tools and features for crypto analysis</p>
	</div>

	<div class="modules-grid">
		{#each modules as module}
			<div class="module-card" class:coming-soon={module.comingSoon}>
				<div class="module-header">
					<h2>{module.title}</h2>
					{#if module.comingSoon}
						<span class="coming-soon-badge">Coming Soon</span>
					{/if}
				</div>
				
				<p class="module-description">{module.description}</p>
				
				<div class="module-features">
					<h3>Features:</h3>
					<ul>
						{#each module.features as feature}
							<li>{feature}</li>
						{/each}
					</ul>
				</div>
				
				<div class="module-actions">
					<button 
						class="module-button" 
						class:disabled={module.comingSoon}
						on:click={() => navigateToModule(module)}
					>
						{module.comingSoon ? '🔒 Coming Soon' : '🚀 Launch Module'}
					</button>
				</div>
			</div>
		{/each}
	</div>

	<div class="modules-footer">
		<button class="back-button" on:click={goBackToDashboard}>
			🏠 Back to Dashboard
		</button>
	</div>
</div>

<style>
	.modules-container {
		max-width: 1200px;
		margin: 0 auto;
		padding: 2rem 1rem;
	}

	.modules-header {
		text-align: center;
		margin-bottom: 3rem;
	}

	.modules-header h1 {
		color: var(--accent-color);
		font-size: 2.5rem;
		margin-bottom: 0.5rem;
	}

	.subtitle {
		color: var(--text-secondary);
		font-size: 1.2rem;
		max-width: 600px;
		margin: 0 auto;
	}

	.modules-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: 2rem;
		margin-bottom: 3rem;
	}

	.module-card {
		background: var(--bg-primary);
		border-radius: 16px;
		padding: 2rem;
		box-shadow: var(--shadow);
		transition: all 0.3s ease;
		border: 2px solid transparent;
	}

	.module-card:hover {
		box-shadow: var(--shadow-hover);
		transform: translateY(-4px);
		border-color: var(--accent-color);
	}

	.module-card.coming-soon {
		opacity: 0.7;
		border-color: var(--border-color);
	}

	.module-card.coming-soon:hover {
		transform: translateY(-2px);
		border-color: var(--warning-color);
	}

	.module-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1rem;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.module-header h2 {
		color: var(--text-primary);
		font-size: 1.4rem;
		margin: 0;
	}

	.coming-soon-badge {
		background: var(--warning-color);
		color: #856404;
		padding: 0.25rem 0.75rem;
		border-radius: 20px;
		font-size: 0.8rem;
		font-weight: 600;
		text-transform: uppercase;
	}

	.module-description {
		color: var(--text-secondary);
		line-height: 1.6;
		margin-bottom: 1.5rem;
		font-size: 1rem;
	}

	.module-features {
		margin-bottom: 2rem;
	}

	.module-features h3 {
		color: var(--text-primary);
		font-size: 1rem;
		margin-bottom: 0.75rem;
		font-weight: 600;
	}

	.module-features ul {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.module-features li {
		color: var(--text-secondary);
		padding: 0.25rem 0;
		position: relative;
		padding-left: 1.5rem;
		font-size: 0.9rem;
	}

	.module-features li::before {
		content: '✓';
		position: absolute;
		left: 0;
		color: var(--success-color);
		font-weight: bold;
	}

	.module-actions {
		margin-top: auto;
	}

	.module-button {
		width: 100%;
		background: var(--accent-color);
		color: white;
		border: none;
		padding: 0.75rem 1.5rem;
		border-radius: 8px;
		font-size: 1rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.3s ease;
	}

	.module-button:hover:not(.disabled) {
		background: var(--accent-hover);
		transform: translateY(-1px);
	}

	.module-button.disabled {
		background: var(--bg-tertiary);
		color: var(--text-secondary);
		cursor: not-allowed;
		border: 1px solid var(--border-color);
	}

	.modules-footer {
		text-align: center;
	}

	.back-button {
		background: var(--bg-primary);
		color: var(--text-primary);
		border: 2px solid var(--accent-color);
		padding: 1rem 2rem;
		border-radius: 8px;
		font-size: 1rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.3s ease;
	}

	.back-button:hover {
		background: var(--accent-color);
		color: white;
		transform: translateY(-1px);
	}

	@media (max-width: 768px) {
		.modules-container {
			padding: 1rem;
		}

		.modules-header h1 {
			font-size: 2rem;
		}

		.modules-grid {
			grid-template-columns: 1fr;
			gap: 1.5rem;
		}

		.module-card {
			padding: 1.5rem;
		}

		.module-header {
			flex-direction: column;
			align-items: flex-start;
		}
	}
</style> 