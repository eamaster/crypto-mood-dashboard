# 📊 Crypto Mood Dashboard

A full-stack cryptocurrency dashboard that combines real-time prices, 7-day charts, and AI-powered sentiment analysis. Built with a Cloudflare Worker backend and vanilla JavaScript frontend, powered by enterprise APIs.

![Crypto Mood Dashboard](assets/screenshot-placeholder.png)
*Screenshot placeholder - Dashboard showing Bitcoin price, AI sentiment analysis, and combined charts*

## ✨ Features

- **📈 Real-time Price Data**: Current prices and on-chain stats from Blockchair API
- **📊 7-Day Price Charts**: Interactive line charts showing recent price history
- **🧠 AI Sentiment Analysis**: Advanced sentiment scoring powered by Cohere AI v2
- **📰 News Headlines**: Latest cryptocurrency news from NewsData.io
- **📱 Responsive Design**: Works perfectly on desktop, tablet, and mobile devices
- **🌙 Dark/Light Theme**: Toggle between themes with preference persistence
- **🔒 Secure API Keys**: All API keys stored securely in Cloudflare Worker environment
- **⚡ Serverless Backend**: Fast, scalable Cloudflare Worker handles all API calls

## 🚀 Quick Start

### Local Development
1. **Clone this repository**
2. **Start the Worker**: `cd crypto-mood-dashboard && wrangler dev`
3. **Update Worker URL**: Edit the `WORKER_URL` in `script.js` and module files
4. **Open `index.html`** in your browser

### Production Deployment
1. **Deploy Worker**: `wrangler publish`
2. **Update Frontend**: Set your worker URL in all files
3. **Deploy Frontend**: Push to GitHub Pages or Hugging Face Spaces

## 🏗️ Project Structure

```
crypto-mood-dashboard/
│
├── modules/                          # Standalone demo modules
│   ├── price-fetcher.html           # Demo: Current price fetching
│   ├── price-chart.html             # Demo: 7-day price charts
│   ├── coin-news.html               # Demo: NewsData.io fetching
│   ├── sentiment-analyzer.html      # Demo: Cohere AI sentiment
│   └── mood-impact-chart.html       # Demo: Combined price + sentiment
│
├── worker/                           # Cloudflare Worker (serverless backend)
│   └── index.js                     # API routes & external service calls
│
├── index.html                       # Main dashboard application
├── style.css                        # Responsive styles with theme support
├── script.js                        # Frontend logic (calls Worker)
├── wrangler.toml                    # Worker configuration
├── assets/                          # Images and static assets
└── README.md                        # This file
```

## 🔧 Technology Stack

- **Frontend**: Pure HTML5, CSS3, Vanilla JavaScript (ES6+)
- **Backend**: [Cloudflare Workers](https://workers.cloudflare.com/) (serverless edge runtime)
- **Charts**: [Chart.js v4](https://www.chartjs.org/) for interactive visualizations
- **APIs Used**:
  - [Blockchair API](https://blockchair.com/api) - Cryptocurrency price & on-chain data
  - [NewsData.io](https://newsdata.io/) - Real-time cryptocurrency news
  - [Cohere AI v2](https://cohere.ai/) - Advanced sentiment analysis

## 🌐 Data Sources & APIs

### Cryptocurrency Data (Blockchair API)
- `/stats` - Current prices and market data
- `/charts/market-price` - Historical price charts
- Supports major cryptocurrencies: Bitcoin, Ethereum, Litecoin, etc.

### News Data (NewsData.io)
- `/api/1/news` - Real-time cryptocurrency news articles
- Professional news sources with search and filtering
- Rate limit: 200 requests/day (free tier)

### Sentiment Analysis (Cohere AI v2)
- `/v2/classify` - Advanced text classification
- Trained on financial and cryptocurrency content
- High-accuracy sentiment scoring with confidence levels

## 🔐 Environment Setup

### Required API Keys
Set these as Cloudflare Worker secrets:

```bash
wrangler secret put BLOCKCHAIR_KEY
# Enter: G___S4J16vrkR7eK5wn5ykSAhQiExJNB

wrangler secret put NEWSDATA_KEY  
# Enter: pub_0a6ac26df9e94ac1aa0eda7f80b2f44f

wrangler secret put COHERE_KEY
# Enter: 8v2ZrEf2NHbhqfKtHKmKmTbh695Nlnhsq6cdHnwH
```

### Rate Limits & Quotas
- **Blockchair**: ≤ 144 requests/minute (free tier)
- **NewsData.io**: ≤ 200 requests/day (free tier)  
- **Cohere**: 1000 API calls/month (trial tier)

## 📱 Browser Compatibility

- ✅ Chrome 60+
- ✅ Firefox 55+
- ✅ Safari 12+
- ✅ Edge 79+
- ✅ Mobile browsers (iOS Safari, Chrome Mobile)

## 🚀 Deployment Guide

### Step 1: Deploy Cloudflare Worker

1. **Install Wrangler CLI**:
```bash
npm install -g wrangler
wrangler login
```

2. **Set up your Worker**:
```bash
cd crypto-mood-dashboard
wrangler publish
```

3. **Configure environment variables**:
```bash
wrangler secret put BLOCKCHAIR_KEY
wrangler secret put NEWSDATA_KEY
wrangler secret put COHERE_KEY
```

4. **Note your Worker URL**: `https://crypto-mood-dashboard.your-subdomain.workers.dev`

### Step 2: Deploy Frontend

#### Option A: GitHub Pages (Free)
1. Update `WORKER_URL` in all JavaScript files
2. Push to GitHub repository
3. Enable GitHub Pages in Settings → Pages
4. Access at: `https://yourusername.github.io/crypto-mood-dashboard`

#### Option B: Hugging Face Spaces (Free)
1. Create new Static Space on [huggingface.co](https://huggingface.co/spaces)
2. Upload files with updated Worker URLs
3. Access at: `https://huggingface.co/spaces/yourusername/crypto-mood-dashboard`

#### Option C: Other Platforms
- **Netlify**: Drag & drop to [netlify.com/drop](https://app.netlify.com/drop)
- **Vercel**: Import repository at [vercel.com](https://vercel.com)
- **Cloudflare Pages**: Connect to your GitHub repo

## 🔧 Customization

### Adding New Cryptocurrencies

Edit the `SUPPORTED_COINS` mapping in `worker/index.js`:

```javascript
const SUPPORTED_COINS = {
    'bitcoin': { id: 'bitcoin', name: 'Bitcoin', symbol: 'BTC' },
    'your-coin': { id: 'your-coin', name: 'Your Coin', symbol: 'YC' },
    // Add more supported coins
};
```

### Modifying Rate Limits

Adjust API call frequency in `script.js`:

```javascript
// Current: 1 request per endpoint per 10 seconds
const RATE_LIMIT_MS = 10000;
```

### Customizing Worker Configuration

Edit `wrangler.toml` for advanced settings:

```toml
[env.production.limits]
cpu_ms = 50  # CPU time limit per request

[env.production.vars]
ENVIRONMENT = "production"
```

### Customizing Themes

Modify CSS variables in `style.css`:

```css
:root {
    --accent-color: #007bff;  /* Change primary color */
    --success-color: #28a745; /* Change positive indicators */
    /* Add your custom colors */
}
```

## 🎯 Module Demos

Each module in the `/modules/` directory is a standalone demo:

- **price-fetcher.html**: Test Blockchair price fetching
- **price-chart.html**: Interactive 7-day charts from Blockchair
- **coin-news.html**: NewsData.io headlines fetching
- **sentiment-analyzer.html**: Cohere AI sentiment analysis
- **mood-impact-chart.html**: Combined price + sentiment visualization

## 🔮 Advanced Features

### Worker Enhancements

The Cloudflare Worker can be extended with additional endpoints:

```javascript
// Add to worker/index.js
case '/summary':
  return await handleSummary(request, env);

async function handleSummary(request, env) {
  // Use Cohere /generate for news summarization
  const response = await fetch('https://api.cohere.ai/v2/generate', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.COHERE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'command',
      prompt: 'Summarize this cryptocurrency news...',
      max_tokens: 100
    })
  });
  
  return jsonResponse(await response.json());
}
```

### Caching & Performance

Add caching to the Worker for better performance:

```javascript
// Cache responses for 5 minutes
const cache = await caches.open('crypto-data');
const cacheKey = new Request(request.url);
let response = await cache.match(cacheKey);

if (!response) {
  response = await fetchFromAPI();
  const responseClone = response.clone();
  responseClone.headers.set('Cache-Control', 'max-age=300');
  await cache.put(cacheKey, responseClone);
}
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is open source and available under the [MIT License](LICENSE).

## 🙋‍♂️ Support

- **Issues**: Report bugs or request features via [GitHub Issues](../../issues)
- **Discussions**: Join the community in [GitHub Discussions](../../discussions)
- **Documentation**: Check the `/modules/` demos for usage examples

## 🌟 Acknowledgments

- [Blockchair](https://blockchair.com/) for reliable cryptocurrency API and on-chain data
- [NewsData.io](https://newsdata.io/) for professional-grade news API
- [Cohere AI](https://cohere.ai/) for advanced sentiment analysis capabilities
- [Cloudflare Workers](https://workers.cloudflare.com/) for serverless edge computing
- [Chart.js](https://www.chartjs.org/) for beautiful, responsive charts
- The cryptocurrency community for inspiration and feedback

---

**⚠️ Disclaimer**: This dashboard is for informational purposes only. Cryptocurrency investments are risky and past performance does not guarantee future results. Always do your own research before making investment decisions.

**🔑 API Keys**: The provided API keys are for demonstration purposes. For production use, obtain your own API keys from the respective services. 