# 📊 Crypto Mood Dashboard

The Crypto Mood Dashboard is a web application that provides real-time price, news, and sentiment analysis for various cryptocurrencies. It is built with SvelteKit and uses a Cloudflare Worker to fetch data from various third-party APIs. The dashboard displays the current price, 24-hour change, and a 7-day price history chart for the selected cryptocurrency. It also fetches the latest news headlines and uses Cohere to perform sentiment analysis on them, providing a "market mood" score.

## 🚀 Getting Started

To get a local copy up and running, follow these simple steps.

### Prerequisites

*   [Node.js](https://nodejs.org/) (v18 or later)
*   [npm](https://www.npmjs.com/)

### Installation

1.  Clone the repo
    ```sh
    git clone https://github.com/your_username/crypto-mood-dashboard.git
    ```
2.  Install NPM packages
    ```sh
    npm install
    ```
3.  Start the development server
    ```sh
    npm run dev
    ```
    The application will be available at `http://localhost:5173`.

## 🏗️ Project Structure

The project is structured as follows:

*   `.svelte-kit/`: SvelteKit's generated files.
*   `src/`: The application's source code.
    *   `lib/`: Reusable components, stores, and configuration.
        *   `components/`: Svelte components used throughout the application.
        *   `stores.js`: The main Svelte store for managing application state.
        *   `config.js`: Configuration file, including the worker URL.
    *   `routes/`: The application's pages and API routes.
    *   `app.html`: The main HTML template.
*   `static/`: Static assets, such as images and the worker script.
*   `worker/`: The source code for the Cloudflare Worker.
*   `package.json`: Project dependencies and scripts.
*   `svelte.config.js`: SvelteKit configuration.
*   `vite.config.js`: Vite configuration.

## 📊 Data Sources

The Crypto Mood Dashboard uses a Cloudflare Worker to fetch data from the following sources:

*   **CoinGecko**: Used to fetch cryptocurrency prices, historical data, and coin information.
*   **NewsAPI.org**: Used to fetch the latest news headlines for the selected cryptocurrency.
*   **Cohere**: Used to perform sentiment analysis on the news headlines and to provide natural language explanations of technical analysis patterns.

## ✨ Features

*   **Real-time Price Data**: Get the latest price and 24-hour change for a variety of cryptocurrencies.
*   **Historical Price Chart**: View a 7-day price history chart for the selected cryptocurrency.
*   **Market Mood Analysis**: See the current market sentiment based on an analysis of the latest news headlines.
*   **Latest News**: Read the most recent news headlines for the selected cryptocurrency.
*   **Real-time Updates**: Enable real-time updates to get the latest data every 5 minutes.
*   **Dark Mode**: Toggle between light and dark themes for a comfortable viewing experience.
*   **Technical Analysis**: View technical analysis indicators such as RSI, SMA, and Bollinger Bands.
*   **AI-Powered Explanations**: Get natural language explanations of the technical analysis patterns from Cohere.
