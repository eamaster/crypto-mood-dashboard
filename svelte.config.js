import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter({
			// Generate static files for GitHub Pages
			pages: 'build',
			assets: 'build',
			fallback: 'index.html',
			precompress: false,
			strict: true
		}),
		// Add base path for deployment at subdirectory
		paths: {
			base: '/crypto-mood-dashboard'
		}
	}
};

export default config; 