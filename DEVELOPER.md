# 👨‍💻 Developer Guide

Guide for developers working on the Crypto Mood Dashboard.

## 🚀 Getting Started

### Prerequisites

- Node.js v18 or later
- npm or yarn
- Git
- Code editor (VS Code recommended)

### Setup

```bash
# Clone repository
git clone https://github.com/eamaster/crypto-mood-dashboard.git
cd crypto-mood-dashboard

# Install dependencies
npm install

# Set up environment variables (see SECRETS_SETUP.md)
cp .env.example .env
# Edit .env with your API keys

# Start development server
npm run dev
```

Visit `http://localhost:5173` to see the application.

## 🏗️ Project Structure

```
crypto-mood-dashboard/
├── src/
│   ├── lib/
│   │   ├── components/     # Reusable Svelte components
│   │   ├── stores.js       # State management
│   │   └── config.js       # Configuration (worker URL)
│   ├── routes/             # SvelteKit routes
│   │   ├── +page.svelte    # Main dashboard
│   │   └── modules/        # Module pages
│   ├── app.html            # HTML template
│   └── app.css             # Global styles
├── worker/                 # Cloudflare Worker source
│   └── index.js            # Worker main file
├── static/                 # Static assets
├── build/                  # Production build output
└── package.json            # Dependencies
```

## 🧪 Testing

### Manual Testing

1. **Test Coin Switching**
   - Select different cryptocurrencies
   - Verify prices load correctly
   - Check for console errors

2. **Test API Endpoints**
   - Open DevTools → Network tab
   - Verify requests have unique timestamps
   - Check response headers

3. **Test Error Handling**
   - Disconnect internet
   - Verify error messages display
   - Reconnect and verify recovery

### Browser Testing

Test on multiple browsers:
- Chrome/Edge
- Firefox
- Safari (if available)

### Performance Testing

```bash
# Build for production
npm run build

# Preview production build
npm run preview

# Check bundle size
npm run build -- --analyze
```

## 🐛 Debugging

### Frontend Debugging

```javascript
// Add console logs in stores.js
console.log('🔍 Fetching price for', coinId);

// Check response headers
console.log('Response headers:', {
    cache: response.headers.get('cache-control'),
    xcache: response.headers.get('X-Cache-Status')
});
```

### Worker Debugging

```bash
# Monitor worker logs in real-time
npx wrangler tail

# Test worker locally
npx wrangler dev

# Check worker configuration
cat wrangler.toml
```

### Common Issues

**Issue**: Prices not updating
- Check browser cache
- Verify API keys are set
- Check worker logs for errors

**Issue**: CORS errors
- Verify worker CORS headers
- Check worker URL in config.js
- Ensure worker is deployed

**Issue**: Build errors
- Clear node_modules: `rm -rf node_modules && npm install`
- Clear .svelte-kit: `rm -rf .svelte-kit`
- Rebuild: `npm run build`

## 📝 Code Style

### Svelte Components

```svelte
<script>
  // Import statements
  import { onMount } from 'svelte';
  
  // Props
  export let coin = 'bitcoin';
  
  // State
  let loading = true;
  
  // Functions
  async function fetchData() {
    // ...
  }
</script>

<!-- Template -->
<div class="container">
  {#if loading}
    <p>Loading...</p>
  {:else}
    <!-- Content -->
  {/if}
</div>

<style>
  .container {
    /* Styles */
  }
</style>
```

### JavaScript

- Use async/await for promises
- Add error handling with try/catch
- Use descriptive variable names
- Add JSDoc comments for functions

### Error Handling

```javascript
try {
  const data = await fetchData();
  // Process data
} catch (error) {
  console.error('Error:', error);
  // Show user-friendly error message
}
```

## 🔧 Development Workflow

### Making Changes

1. Create a feature branch
   ```bash
   git checkout -b feature/your-feature
   ```

2. Make changes and test locally
   ```bash
   npm run dev
   ```

3. Build and test production build
   ```bash
   npm run build
   npm run preview
   ```

4. Commit changes
   ```bash
   git add .
   git commit -m "feat: Add new feature"
   git push origin feature/your-feature
   ```

5. Create pull request on GitHub

### Code Review Checklist

- [ ] Code follows project style guidelines
- [ ] Error handling is implemented
- [ ] Console logs are removed or appropriate
- [ ] No hardcoded API keys or secrets
- [ ] Tests pass (if applicable)
- [ ] Documentation updated (if needed)

## 🚀 Performance Optimization

### Frontend Optimizations

- **Parallel API calls**: Use `Promise.all()` for independent requests
- **Request timeouts**: Prevent hanging requests
- **Cache control**: Use appropriate cache headers
- **Lazy loading**: Load components on demand

### Worker Optimizations

- **Caching**: Use KV storage for frequently accessed data
- **Rate limiting**: Respect API rate limits
- **Error handling**: Graceful fallbacks
- **Logging**: Comprehensive error logs

## 📚 Key Technologies

- **SvelteKit**: Frontend framework
- **Cloudflare Workers**: Backend API
- **Chart.js**: Data visualization
- **Cohere AI**: Sentiment analysis
- **CoinCap Pro API**: Cryptocurrency data
- **NewsAPI**: News articles

## 🔗 Resources

- [SvelteKit Documentation](https://kit.svelte.dev/)
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Chart.js Documentation](https://www.chartjs.org/)
- [Cohere API Docs](https://docs.cohere.com/)

## 🆘 Getting Help

1. Check existing documentation
2. Search GitHub issues
3. Review code comments
4. Ask in GitHub Discussions

## 📝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

---

**Last Updated**: November 2025

