<script>
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { WORKER_URL } from '../../lib/config.js';

	// Reactive variables
	let textInput = `Bitcoin price soars to new all-time high
Cryptocurrency adoption accelerates globally
Major institutions embrace digital assets
Market shows strong bullish momentum
Positive regulatory developments worldwide`;
	let loading = false;
	let error = null;
	let sentimentResult = null;
	let headlines = [];

	// Sample data for different sentiment types
	const samples = {
		bullish: [
			"Bitcoin price soars to new all-time high",
			"Cryptocurrency adoption accelerates globally", 
			"Major institutions embrace digital assets",
			"Market shows strong bullish momentum",
			"Positive regulatory developments worldwide"
		],
		bearish: [
			"Cryptocurrency market crashes amid regulatory fears",
			"Bitcoin price plummets to yearly lows",
			"Major exchange hack causes widespread panic",
			"Government bans cryptocurrency trading",
			"Market sentiment turns extremely negative"
		],
		neutral: [
			"Bitcoin price remains stable today",
			"Cryptocurrency market shows mixed signals",
			"Trading volume stays within normal range", 
			"No major news affecting crypto prices",
			"Market consolidation continues"
		],
		mixed: [
			"Bitcoin surges while altcoins struggle",
			"Positive news overshadowed by regulatory concerns",
			"Strong institutional adoption but retail fear",
			"Bull market signs amid bearish sentiment",
			"Great technology but volatile prices"
		]
	};

	onMount(() => {
		// Auto-analyze on page load
		analyzeSentiment();
	});

	function loadSample(type) {
		textInput = samples[type].join('\n');
	}

	async function analyzeSentiment() {
		const text = textInput.trim();
		
		if (!text) {
			error = 'Please enter some text to analyze.';
			return;
		}
		
		// Split text into lines (headlines) and validate
		headlines = text.split('\n').filter(line => line.trim());
		
		if (headlines.length === 0) {
			error = 'Please enter some headlines to analyze.';
			return;
		}
		
		// Validate headlines
		if (!validateHeadlines(headlines)) {
			error = 'Please ensure all headlines are valid text strings.';
			return;
		}
		
		loading = true;
		error = null;
		sentimentResult = null;
		
		try {
			console.log(`🧠 Analyzing ${headlines.length} headlines with enhanced backend...`);
			
			// Call enhanced worker for sentiment analysis
			const response = await fetch(`${WORKER_URL}/sentiment`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					headlines: headlines
				})
			});
			
			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}
			
			const data = await response.json();
			console.log('🧠 Enhanced sentiment analysis response:', data);
			
			if (data.error) {
				throw new Error(data.error);
			}
			
			// Validate response data
			if (!validateSentimentResponse(data)) {
				throw new Error('Invalid sentiment analysis response received');
			}
			
			sentimentResult = data;
			
		} catch (err) {
			console.error('Error analyzing sentiment:', err);
			error = err.message;
		} finally {
			loading = false;
		}
	}

	function validateSentimentResponse(data) {
		if (!data || typeof data !== 'object') return false;
		if (typeof data.score !== 'number' || data.score < -5 || data.score > 5) return false;
		if (!data.category || !['bullish', 'bearish', 'neutral'].includes(data.category)) return false;
		if (typeof data.confidence !== 'number' || data.confidence < 0 || data.confidence > 1) return false;
		return true;
	}

	function validateHeadlines(headlines) {
		if (!headlines || !Array.isArray(headlines)) return false;
		return headlines.every(headline => 
			typeof headline === 'string' && headline.trim().length > 0
		);
	}

	function getSentimentEmoji(category) {
		switch (category) {
			case 'bullish': return '🐂';
			case 'bearish': return '🐻';
			default: return '😐';
		}
	}

	function getMethodDisplay(method) {
		switch(method) {
			case 'cohere-chat-api': return 'Cohere AI v2 (Advanced NLP)';
			case 'keyword-analysis': return 'Enhanced Keyword Analysis';
			case 'no-data': return 'No Data Available';
			case 'error': return 'Analysis Error';
			default: return 'Automatic Selection';
		}
	}

	function getMethodNote(method) {
		switch(method) {
			case 'cohere-chat-api': return 'Advanced AI classification with confidence levels and context understanding';
			case 'keyword-analysis': return 'Enhanced keyword matching with improved sentiment scoring and confidence metrics';
			case 'no-data': return 'No headlines available for analysis';
			case 'error': return 'Error occurred during analysis';
			default: return 'System automatically selected the best available analysis method';
		}
	}

	function goBack() {
		goto('modules');
	}
</script>

<svelte:head>
	<title>🧠 Sentiment Analyzer - Crypto Mood Dashboard</title>
</svelte:head>

<div class="container">
	<div class="header">
		<h1>🧠 Sentiment Analyzer Demo</h1>
		<button class="back-button" on:click={goBack}>← Back to Modules</button>
	</div>
	
	<p>Enter headlines or text to analyze sentiment using AI-powered analysis:</p>
	
	<div class="sample-buttons">
		<button on:click={() => loadSample('bullish')}>Load Bullish Sample</button>
		<button on:click={() => loadSample('neutral')}>Load Neutral Sample</button>
		<button on:click={() => loadSample('bearish')}>Load Bearish Sample</button>
		<button on:click={() => loadSample('mixed')}>Load Mixed Sample</button>
	</div>
	
	<textarea 
		bind:value={textInput}
		placeholder="Enter headlines, one per line..."
		disabled={loading}
	></textarea>
	
	<div class="analyze-section">
		<button class="analyze-button" on:click={analyzeSentiment} disabled={loading}>
			{loading ? '⏳ Analyzing...' : 'Analyze Sentiment'}
		</button>
	</div>
	
	<div class="results">
		{#if loading}
			<div class="sentiment-card">⏳ Analyzing sentiment with enhanced AI...</div>
		{:else if error}
			<div class="sentiment-card bearish">
				<div class="sentiment-score">❌ Error</div>
				<div class="sentiment-label">Analysis Failed</div>
				<div class="sentiment-details">{error}</div>
			</div>
		{:else if sentimentResult}
			<div class="sentiment-card {sentimentResult.category}">
				<div class="sentiment-score">{getSentimentEmoji(sentimentResult.category)} {sentimentResult.score.toFixed(2)}</div>
				<div class="sentiment-label">{sentimentResult.category.charAt(0).toUpperCase() + sentimentResult.category.slice(1)} Sentiment</div>
				<div class="sentiment-details">
					Average Score: {sentimentResult.score.toFixed(2)} • 
					Confidence: {(sentimentResult.confidence * 100).toFixed(1)}% • 
					{sentimentResult.total || sentimentResult.analyzed || headlines.length} headline{(sentimentResult.total || sentimentResult.analyzed || headlines.length) === 1 ? '' : 's'} analyzed
				</div>
			</div>
			
			<div class="headlines-analysis">
				<h3>Headlines Analyzed:</h3>
				{#each headlines as headline, index}
					<div class="headline-item">
						<strong>{index + 1}.</strong> {headline}
					</div>
				{/each}
			</div>
			
			<div class="headlines-analysis">
				<h3>Enhanced Analysis Breakdown:</h3>
				<div class="breakdown-grid">
					<div class="breakdown-item">
						<div class="breakdown-value positive">
							{sentimentResult.breakdown ? sentimentResult.breakdown.positive : 0}
						</div>
						<div class="breakdown-label">Positive</div>
					</div>
					<div class="breakdown-item">
						<div class="breakdown-value neutral">
							{sentimentResult.breakdown ? sentimentResult.breakdown.neutral : 0}
						</div>
						<div class="breakdown-label">Neutral</div>
					</div>
					<div class="breakdown-item">
						<div class="breakdown-value negative">
							{sentimentResult.breakdown ? sentimentResult.breakdown.negative : 0}
						</div>
						<div class="breakdown-label">Negative</div>
					</div>
				</div>
			</div>
			
			{#if sentimentResult.metrics}
				<div class="metrics-section">
					<strong>Advanced Metrics:</strong><br>
					Individual Confidence: {(sentimentResult.metrics.average_individual_confidence * 100).toFixed(1)}%<br>
					Sentiment Strength: {(sentimentResult.metrics.sentiment_strength * 100).toFixed(1)}%<br>
					Weighted Score: {sentimentResult.metrics.weighted_score.toFixed(2)}<br>
				</div>
			{/if}
			
			<div class="info-section">
				<strong>Enhanced Sentiment Scale:</strong><br>
				🐂 Bullish: Score &gt; +1 (Very Positive)<br>
				😐 Neutral: Score -1 to +1 (Balanced)<br>
				🐻 Bearish: Score &lt; -1 (Very Negative)<br><br>
				<strong>Analysis Method:</strong> {getMethodDisplay(sentimentResult.method)}<br>
				<strong>Data Source:</strong> Real-time analysis with {sentimentResult.method === 'cohere-chat-api' ? 'Cohere AI v2' : 'Enhanced Keyword Analysis'}<br>
				<strong>Note:</strong> {getMethodNote(sentimentResult.method)}. 
				Scores range from -5 (very bearish) to +5 (very bullish).
			</div>
		{/if}
	</div>
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

	.sample-buttons {
		margin: 1rem 0;
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.sample-buttons button {
		background: var(--bg-tertiary);
		color: var(--text-primary);
		border: 1px solid var(--border-color);
		padding: 0.5rem 1rem;
		border-radius: 6px;
		cursor: pointer;
		font-size: 0.8rem;
		transition: all 0.3s ease;
	}

	.sample-buttons button:hover {
		background: var(--accent-color);
		color: white;
	}

	textarea {
		width: 100%;
		min-height: 120px;
		padding: 0.75rem;
		border: 1px solid var(--border-color);
		border-radius: 6px;
		background: var(--bg-secondary);
		color: var(--text-primary);
		font-size: 1rem;
		font-family: inherit;
		resize: vertical;
		box-sizing: border-box;
		margin-bottom: 1rem;
	}

	textarea:focus {
		outline: 2px solid var(--accent-color);
		outline-offset: 2px;
		border-color: var(--accent-color);
	}

	textarea:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.analyze-section {
		margin-bottom: 1.5rem;
	}

	.analyze-button {
		background: var(--accent-color);
		color: white;
		border: none;
		padding: 0.75rem 1.5rem;
		border-radius: 6px;
		cursor: pointer;
		font-size: 1rem;
		font-weight: 600;
		transition: all 0.3s ease;
	}

	.analyze-button:hover:not(:disabled) {
		background: var(--accent-hover);
		transform: translateY(-1px);
	}

	.analyze-button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
		transform: none;
	}

	.results {
		margin-top: 1.5rem;
	}

	.sentiment-card {
		background: var(--bg-secondary);
		padding: 1.5rem;
		border-radius: 10px;
		margin: 1rem 0;
		text-align: center;
		border-left: 5px solid var(--border-color);
	}

	.sentiment-card.bullish {
		background: linear-gradient(135deg, #d4edda, #c3e6cb);
		border-left-color: var(--success-color);
	}

	.sentiment-card.neutral {
		background: linear-gradient(135deg, var(--bg-secondary), var(--bg-tertiary));
		border-left-color: var(--text-secondary);
	}

	.sentiment-card.bearish {
		background: linear-gradient(135deg, #f8d7da, #f5c6cb);
		border-left-color: var(--danger-color);
	}

	.sentiment-score {
		font-size: 2.25rem;
		font-weight: 700;
		margin: 0.5rem 0;
		color: var(--text-primary);
	}

	.sentiment-label {
		font-size: 1.25rem;
		font-weight: 600;
		margin: 0.5rem 0;
		color: var(--text-primary);
	}

	.sentiment-details {
		font-size: 0.9rem;
		color: var(--text-secondary);
		margin-top: 1rem;
	}

	.headlines-analysis {
		margin-top: 1.5rem;
	}

	.headlines-analysis h3 {
		color: var(--text-primary);
		margin-bottom: 1rem;
		font-size: 1.1rem;
	}

	.headline-item {
		padding: 0.75rem;
		margin: 0.5rem 0;
		background: var(--bg-secondary);
		border-radius: 6px;
		border-left: 3px solid var(--accent-color);
		color: var(--text-primary);
	}

	.breakdown-grid {
		display: flex;
		gap: 1.5rem;
		justify-content: center;
		margin: 1rem 0;
		flex-wrap: wrap;
	}

	.breakdown-item {
		text-align: center;
	}

	.breakdown-value {
		font-size: 1.5rem;
		font-weight: 700;
		margin-bottom: 0.25rem;
	}

	.breakdown-value.positive {
		color: var(--success-color);
	}

	.breakdown-value.neutral {
		color: var(--text-secondary);
	}

	.breakdown-value.negative {
		color: var(--danger-color);
	}

	.breakdown-label {
		font-size: 0.8rem;
		color: var(--text-secondary);
	}

	.metrics-section {
		margin-top: 1.5rem;
		padding: 1rem;
		background: var(--bg-secondary);
		border-radius: 6px;
		font-size: 0.9rem;
		color: var(--text-primary);
	}

	.info-section {
		margin-top: 1.5rem;
		padding: 1rem;
		background: var(--bg-tertiary);
		border-radius: 6px;
		font-size: 0.9rem;
		color: var(--text-primary);
		line-height: 1.5;
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

		.sample-buttons {
			flex-direction: column;
		}

		.breakdown-grid {
			flex-direction: column;
			gap: 1rem;
		}

		.sentiment-score {
			font-size: 1.8rem;
		}

		.sentiment-label {
			font-size: 1.1rem;
		}
	}
</style> 