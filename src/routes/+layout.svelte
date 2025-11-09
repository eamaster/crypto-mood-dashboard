<script>
	import '../app.css';
	import { onMount } from 'svelte';

	let darkTheme = false;

	onMount(() => {
		// Check for saved theme preference or default to light mode
		const savedTheme = localStorage.getItem('theme');
		if (savedTheme) {
			darkTheme = savedTheme === 'dark';
		} else {
			// Check system preference
			darkTheme = window.matchMedia('(prefers-color-scheme: dark)').matches;
		}
		
		// Apply theme
		updateTheme();
	});

	function toggleTheme() {
		darkTheme = !darkTheme;
		updateTheme();
		localStorage.setItem('theme', darkTheme ? 'dark' : 'light');
	}

	function updateTheme() {
		if (darkTheme) {
			document.body.classList.add('dark-theme');
		} else {
			document.body.classList.remove('dark-theme');
		}
	}
</script>

<header>
	<div class="header-content">
		<h1><a href="https://hesam.me/crypto-mood-dashboard/" class="logo-link">📊 Crypto Mood Dashboard</a></h1>
		<button class="theme-toggle" on:click={toggleTheme}>
			{darkTheme ? '☀️' : '🌙'}
		</button>
	</div>
</header>

<main>
	<slot />
</main>

<footer>
	<p>
		Data from <a href="https://pro.coincap.io/" target="_blank" rel="noopener">CoinCap</a> & 
		<a href="https://newsapi.org/" target="_blank" rel="noopener">NewsAPI.org</a> • 
		AI by Cohere • Built with Chart.js & Cloudflare Workers
	</p>
	<p>
		<a href="modules">📦 View all modules</a> • 
		<a href="technical-analysis">🔍 Technical Analysis</a>
	</p>
</footer> 