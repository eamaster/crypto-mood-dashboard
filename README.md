# 📊 Crypto Mood Dashboard

A full-stack cryptocurrency dashboard that combines real-time prices, 7-day charts, and AI-powered sentiment analysis. Built with a Cloudflare Worker backend and vanilla JavaScript frontend, powered by enterprise APIs.

![Crypto Mood Dashboard](assets/screenshot-placeholder.png)
*Screenshot placeholder - Dashboard showing Bitcoin price, AI sentiment analysis, and combined charts*

## ✨ Features

- **📈 Real-time Price Data**: Current prices and on-chain stats from Blockchair API
- **📊 7-Day Price Charts**: Interactive line charts with consistent daily patterns
- **🧠 AI Sentiment Analysis**: Advanced sentiment scoring powered by Cohere AI Chat API
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
1. **Deploy Worker**: `wrangler deploy`
2. **Update Frontend**: Set your worker URL in all files
3. **Deploy Frontend**: Push to GitHub Pages or your preferred hosting platform

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
  - [Cohere AI](https://cohere.ai/) - Advanced sentiment analysis via Chat API

## 🌐 Data Sources & APIs

### Cryptocurrency Data (Blockchair API)
- `/stats` - Current prices and market data for supported cryptocurrencies
- Deterministic price history generation for consistent 7-day charts
- Supports major cryptocurrencies: Bitcoin, Ethereum, Litecoin, Dogecoin, etc.

### News Data (NewsData.io)
- `/api/1/news` - Real-time cryptocurrency news articles
- Professional news sources with search and filtering
- Fetches up to 10 headlines, analyzes top 5 for sentiment

### Sentiment Analysis (Cohere AI)
- `/v2/chat` - Chat API for prompt-based sentiment analysis
- Analyzes up to 5 headlines per request for cost efficiency
- Returns positive/negative/neutral classifications with confidence scores

## 🔐 Environment Setup

### Required API Keys
You'll need to obtain your own API keys from these services:

1. **Blockchair API**: [https://blockchair.com/api/requests](https://blockchair.com/api/requests)
2. **NewsData.io**: [https://newsdata.io/](https://newsdata.io/)
3. **Cohere AI**: [https://dashboard.cohere.ai/](https://dashboard.cohere.ai/)

Set these as Cloudflare Worker secrets:

```bash
wrangler secret put BLOCKCHAIR_API_KEY
# Enter your Blockchair API key

wrangler secret put NEWSDATA_API_KEY  
# Enter your NewsData.io API key

wrangler secret put COHERE_API_KEY
# Enter your Cohere API key
```

### Rate Limits & Quotas
- **Blockchair**: 30 requests/minute (free tier)
- **NewsData.io**: 200 requests/day (free tier)  
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

2. **Deploy your Worker**:
```bash
cd crypto-mood-dashboard
wrangler deploy --env=""
```

3. **Configure environment variables**:
```bash
wrangler secret put BLOCKCHAIR_API_KEY --env=""
wrangler secret put NEWSDATA_API_KEY --env=""
wrangler secret put COHERE_API_KEY --env=""
```

4. **Note your Worker URL**: `https://crypto-mood-dashboard.your-subdomain.workers.dev`

### Step 2: Deploy Frontend

#### Option A: GitHub Pages (Free)
1. Update `WORKER_URL` in `script.js` to your deployed worker URL
2. Push to GitHub repository
3. Enable GitHub Pages in Settings → Pages
4. Access at: `https://yourusername.github.io/crypto-mood-dashboard`

#### Option B: Other Platforms
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
    // Add more supported coins (must be supported by Blockchair)
};
```

### Modifying Rate Limits

Adjust API call frequency in `script.js`:

```javascript
// Current: 1 request per endpoint per 10 seconds
const RATE_LIMIT_MS = 10000;
```

### Customizing Sentiment Analysis

Modify the prompt in `worker/index.js` to adjust AI behavior:

```javascript
const prompt = `Analyze the sentiment of these cryptocurrency news headlines...
// Customize criteria and examples here
`;
```

## 🎯 Module Demos

Each module in the `/modules/` directory is a standalone demo:

- **price-fetcher.html**: Test Blockchair price fetching
- **price-chart.html**: Interactive 7-day charts with deterministic data
- **coin-news.html**: NewsData.io headlines fetching
- **sentiment-analyzer.html**: Cohere AI Chat API sentiment analysis
- **mood-impact-chart.html**: Combined price + sentiment visualization

## 🔮 Recent Updates

### v2.0 (Current)
- ✅ **Fixed Cohere Integration**: Switched from deprecated `/classify` to `/v2/chat` API
- ✅ **Improved Price Charts**: Deterministic historical data for consistent visualization
- ✅ **Enhanced Sentiment Analysis**: Now uses AI conversation for better accuracy
- ✅ **Better Error Handling**: Graceful fallback to keyword-based sentiment analysis
- ✅ **Accurate Metrics**: Display shows actual headlines analyzed vs total fetched

### Known Limitations
- **Historical Data**: 7-day price charts use simulated data patterns (Blockchair doesn't provide easy historical access)
- **API Costs**: Sentiment analysis limited to 5 headlines per request to manage costs
- **Rate Limits**: Free tier APIs have request limitations that may affect real-time updates

## 🛠️ Troubleshooting

### Common Issues

1. **"Sentiment analysis using keyword fallback"**
   - Check if Cohere API key is properly set: `wrangler secret list`
   - Verify API key is valid in Cohere dashboard
   - Check worker logs: `wrangler tail --format pretty`

2. **Price data not loading**
   - Verify Blockchair API key is configured
   - Check browser console for CORS or network errors
   - Ensure worker is deployed successfully

3. **News not appearing**
   - Confirm NewsData.io API key is active
   - Check API quotas in NewsData.io dashboard
   - Verify worker endpoint responses

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

**🔑 Security Note**: Never commit API keys to version control. Always use environment variables or secret management systems for production deployments. 