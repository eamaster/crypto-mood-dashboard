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
		paths: {
			// Configure base path for GitHub Pages subpath deployment
			base: process.env.NODE_ENV === 'production' ? '/crypto-mood-dashboard' : ''
		}
	}
};

export default config; 