# 📊 Crypto Mood Dashboard

A real-time cryptocurrency dashboard providing price tracking, market sentiment analysis, and technical indicators. Built with SvelteKit and Cloudflare Workers.

## ✨ Features

- **Real-time Price Data**: Live prices and 24h changes for 15+ cryptocurrencies
- **Market Sentiment Analysis**: AI-powered sentiment analysis using Cohere
- **Technical Analysis**: RSI, SMA, Bollinger Bands with AI explanations
- **News Integration**: Latest cryptocurrency news from NewsAPI
- **Interactive Charts**: 7-day price history with Chart.js
- **Dark Mode**: Toggle between light and dark themes
- **Performance Optimized**: Parallel API fetching, request timeouts, smart caching

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- [npm](https://www.npmjs.com/)
- API keys (see [SECRETS_SETUP.md](./SECRETS_SETUP.md))

### Installation

```bash
# Clone repository
git clone https://github.com/eamaster/crypto-mood-dashboard.git
cd crypto-mood-dashboard

# Install dependencies
npm install

# Set up API keys (see SECRETS_SETUP.md)
cp .env.example .env
# Edit .env with your API keys

# Start development server
npm run dev
```

Visit `http://localhost:5173` to see the application.

### Available Scripts

```bash
npm run dev      # Start development server
npm run build    # Build for production
npm run preview  # Preview production build
npm run check    # Type checking
```

## 📖 Documentation

- **[SECRETS_SETUP.md](./SECRETS_SETUP.md)**: API keys configuration guide
- **[DEPLOYMENT.md](./DEPLOYMENT.md)**: Production deployment instructions
- **[DEVELOPER.md](./DEVELOPER.md)**: Development and testing guide

## 🏗️ Architecture

- **Frontend**: SvelteKit (static site)
- **Backend**: Cloudflare Worker (API proxy)
- **APIs**: CoinGecko, NewsAPI, Cohere AI
- **Deployment**: GitHub Pages (frontend) + Cloudflare Workers (backend)

## 🎯 Supported Cryptocurrencies

Bitcoin, Ethereum, Litecoin, Bitcoin Cash, Cardano, Ripple, Dogecoin, Polkadot, Chainlink, Stellar, Monero, Tezos, EOS, Zcash, Dash, Solana

## 📊 Data Sources

- **CoinCap Pro**: Cryptocurrency prices and historical data (500 rpm)
- **NewsAPI.org**: Latest cryptocurrency news
- **Cohere AI**: Sentiment analysis and market mood classification

## 🧩 Modules

- **Dashboard**: Main dashboard with price, sentiment, and charts
- **Technical Analysis**: RSI, SMA, Bollinger Bands with AI explanations
- **Coin News**: Latest news articles for selected cryptocurrency
- **Price Chart**: Interactive 7-day price history
- **Sentiment Analyzer**: AI-powered sentiment analysis tool
- **Mood Impact Chart**: Visualize sentiment vs price correlation
- **Price Fetcher**: Simple price lookup tool

## 🛠️ Technologies

- **Frontend**: SvelteKit, Chart.js, date-fns
- **Backend**: Cloudflare Workers, KV Storage
- **APIs**: CoinGecko, NewsAPI, Cohere AI
- **Deployment**: GitHub Pages, Cloudflare Workers

## 📝 License

This project is open source and available under the MIT License.

## 🤝 Contributing

Contributions are welcome! Please see [DEVELOPER.md](./DEVELOPER.md) for development guidelines.

## 🔗 Links

- **Live Demo**: https://hesam.me/crypto-mood-dashboard/
- **GitHub Repository**: https://github.com/eamaster/crypto-mood-dashboard
- **Worker URL**: https://crypto-mood-dashboard-production.smah0085.workers.dev

---

**Status**: ✅ Production Ready  
**Last Updated**: November 2025
