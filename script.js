// =============================================================================
// Crypto Mood Dashboard - Main Script
// Integrates price fetching, chart display, news analysis, and sentiment scoring
// Now powered by Cloudflare Worker backend
// =============================================================================

(function() {
    'use strict';
    
    // =============================================================================
    // GLOBAL STATE & CONFIGURATION
    // =============================================================================
    
    const state = {
        selectedCoin: 'bitcoin',
        lastFetchTimes: {
            coinsList: 0,
            price: 0,
            chart: 0,
            news: 0
        },
        coins: [],
        chartInstance: null,
        realTime: {
            isActive: false,
            intervalId: null,
            updateFrequency: 300000, // 5 minutes
            lastUpdateTime: null,
            consecutiveErrors: 0,
            maxErrors: 3
        }
    };
    
    // Rate limiting - max 1 request per endpoint per 10 seconds
    const RATE_LIMIT_MS = 10000;
    
    // Cloudflare Worker endpoint
    // Update this to your deployed worker URL
    const WORKER_URL = 'https://crypto-mood-dashboard.smah0085.workers.dev';
    
    // =============================================================================
    // DOM ELEMENTS
    // =============================================================================
    
    const elements = {
        coinSelect: document.getElementById('coinSelect'),
        refreshBtn: document.getElementById('refreshBtn'),
        realTimeBtn: document.getElementById('realTimeBtn'),
        themeToggle: document.getElementById('themeToggle'),
        lastUpdated: document.getElementById('lastUpdated'),
        
        // Real-time status
        realTimeStatus: document.getElementById('realTimeStatus'),
        statusIcon: document.getElementById('statusIcon'),
        statusText: document.getElementById('statusText'),
        
        // Price widget
        priceWidget: document.getElementById('priceWidget'),
        priceError: document.getElementById('priceError'),
        
        // Mood widget  
        moodWidget: document.getElementById('moodWidget'),
        newsContainer: document.getElementById('newsContainer'),
        moodError: document.getElementById('moodError'),
        
        // Chart
        mainChart: document.getElementById('mainChart'),
        chartError: document.getElementById('chartError')
    };
    
    // =============================================================================
    // UTILITY FUNCTIONS
    // =============================================================================
    
    function isRateLimited(endpoint) {
        // Skip rate limiting during real-time updates for better responsiveness
        if (state.realTime.isActive) {
            return false;
        }
        
        const now = Date.now();
        const lastFetch = state.lastFetchTimes[endpoint] || 0;
        return (now - lastFetch) < RATE_LIMIT_MS;
    }
    
    function updateLastFetchTime(endpoint) {
        state.lastFetchTimes[endpoint] = Date.now();
    }
    
    function formatCurrency(amount) {
        return amount.toLocaleString('en-US', {
            style: 'currency',
            currency: 'USD'
        });
    }
    
    function formatPercentage(value) {
        const sign = value >= 0 ? '+' : '';
        return `${sign}${value.toFixed(2)}%`;
    }
    
    function updateTimestamp() {
        elements.lastUpdated.textContent = new Date().toLocaleString('en-US', {
            timeZone: 'UTC',
            timeZoneName: 'short'
        });
    }
    
    function showError(element, message) {
        element.style.display = 'block';
        element.textContent = `❌ ${message}`;
    }
    
    function hideError(element) {
        element.style.display = 'none';
    }
    
    // =============================================================================
    // REAL-TIME UPDATE FUNCTIONS
    // =============================================================================
    
    function toggleRealTime() {
        if (state.realTime.isActive) {
            stopRealTimeUpdates();
        } else {
            startRealTimeUpdates();
        }
    }
    
    function startRealTimeUpdates() {
        console.log('🔴 Starting real-time dashboard updates (5-minute intervals)...');
        
        state.realTime.isActive = true;
        state.realTime.consecutiveErrors = 0;
        
        // Update UI
        elements.realTimeBtn.textContent = '⏸️ Stop Real-Time';
        elements.realTimeBtn.setAttribute('data-active', 'true');
        elements.realTimeStatus.style.display = 'block';
        updateRealTimeStatus('🟢', 'Real-time updates active (every 5 min)');
        
        // Perform initial update
        performRealTimeUpdate();
        
        // Set up interval for continuous updates
        state.realTime.intervalId = setInterval(() => {
            performRealTimeUpdate();
        }, state.realTime.updateFrequency);
    }
    
    function stopRealTimeUpdates() {
        console.log('⏸️ Stopping real-time dashboard updates...');
        
        state.realTime.isActive = false;
        
        // Clear interval
        if (state.realTime.intervalId) {
            clearInterval(state.realTime.intervalId);
            state.realTime.intervalId = null;
        }
        
        // Update UI
        elements.realTimeBtn.textContent = '📡 Start Real-Time (5min)';
        elements.realTimeBtn.setAttribute('data-active', 'false');
        updateRealTimeStatus('🔴', 'Real-time updates stopped');
    }
    
    async function performRealTimeUpdate() {
        if (!state.realTime.isActive) return;
        
        try {
            console.log('📡 Performing real-time dashboard update (5-minute cycle)...');
            
            updateRealTimeStatus('🟡', 'Updating all data (price, chart, sentiment)...');
            
            // Force reset rate limiting to ensure fresh data on real-time updates
            state.lastFetchTimes = {
                coinsList: 0,
                price: 0,
                chart: 0,
                news: 0
            };
            
            // Update the dashboard with current coin - this ensures all components update consistently
            await updateDashboard(state.selectedCoin);
            
            // Update timestamp
            state.realTime.lastUpdateTime = new Date();
            state.realTime.consecutiveErrors = 0;
            
            updateRealTimeStatus('🟢', 'Real-time updates active (every 5 min)');
            
        } catch (error) {
            console.error('❌ Real-time update failed:', error);
            
            state.realTime.consecutiveErrors++;
            
            if (state.realTime.consecutiveErrors >= state.realTime.maxErrors) {
                console.log('⚠️ Too many consecutive errors, stopping real-time updates');
                stopRealTimeUpdates();
                updateRealTimeStatus('🔴', 'Real-time stopped (errors)');
            } else {
                updateRealTimeStatus('🟠', `Update failed, retrying... (${state.realTime.consecutiveErrors}/${state.realTime.maxErrors})`);
            }
        }
    }
    
    function updateRealTimeStatus(icon, text) {
        if (elements.statusIcon && elements.statusText && elements.realTimeStatus) {
            elements.statusIcon.textContent = icon;
            elements.statusText.textContent = text;
            
            // Update CSS data attributes for styling
            if (icon === '🟢') {
                elements.realTimeStatus.setAttribute('data-status', 'active');
            } else if (icon === '🟡') {
                elements.realTimeStatus.setAttribute('data-status', 'updating');
            } else if (icon === '🟠' || icon === '🔴') {
                elements.realTimeStatus.setAttribute('data-status', 'error');
            }
        }
    }
    
    // Clean up real-time updates when page unloads
    window.addEventListener('beforeunload', function() {
        if (state.realTime.isActive) {
            stopRealTimeUpdates();
        }
    });
    
    // =============================================================================
    // API FUNCTIONS
    // =============================================================================
    
    async function fetchCoinsList() {
        if (isRateLimited('coinsList')) {
            console.log('Coins list fetch rate limited');
            return state.coins;
        }
        
        try {
            updateLastFetchTime('coinsList');
            const response = await fetch(`${WORKER_URL}/coins`);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: Unable to fetch coins list`);
            }
            
            const coins = await response.json();
            state.coins = coins;
            return coins;
            
        } catch (error) {
            console.error('Error fetching coins list:', error);
            throw new Error('Failed to load cryptocurrency list');
        }
    }
    
    async function fetchCurrentPrice(coinId) {
        if (isRateLimited('price')) {
            console.log('Price fetch rate limited');
            return null;
        }
        
        try {
            updateLastFetchTime('price');
            const response = await fetch(`${WORKER_URL}/price?coin=${coinId}`);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: Unable to fetch price data`);
            }
            
            const data = await response.json();
            
            if (data.error) {
                throw new Error(data.error);
            }
            
            return {
                price: data.price,
                change24h: data.change24h || 0
            };
            
        } catch (error) {
            console.error('Error fetching price:', error);
            throw new Error('Failed to fetch current price');
        }
    }
    
    async function fetchPriceHistory(coinId) {
        if (isRateLimited('chart')) {
            console.log('Chart fetch rate limited');
            return null;
        }
        
        try {
            updateLastFetchTime('chart');
            const response = await fetch(`${WORKER_URL}/history?coin=${coinId}&days=7`);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: Unable to fetch price history`);
            }
            
            const data = await response.json();
            
            if (data.error) {
                throw new Error(data.error);
            }
            
            if (!data.prices || data.prices.length === 0) {
                throw new Error(`No price history found for ${coinId}`);
            }
            
            return data.prices.map(item => ({
                x: new Date(item.timestamp),
                y: item.price
            }));
            
        } catch (error) {
            console.error('Error fetching price history:', error);
            throw new Error('Failed to fetch price history');
        }
    }
    
    async function fetchCoinNews(coinId) {
        if (isRateLimited('news')) {
            console.log('News fetch rate limited');
            return [];
        }
        
        try {
            updateLastFetchTime('news');
            const response = await fetch(`${WORKER_URL}/news?coin=${coinId}`);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch news for ${coinId}`);
            }
            
            const data = await response.json();
            
            if (data.error) {
                console.error('News API error:', data.error);
                return [];
            }
            
            if (!data.headlines || data.headlines.length === 0) {
                return []; // Return empty array if no news
            }
            
            return data.headlines.map(article => ({
                title: article.title,
                description: article.description,
                url: article.url,
                source: article.source,
                published: new Date(article.published)
            }));
            
        } catch (error) {
            console.error('Error fetching news:', error);
            return []; // Return empty array on error
        }
    }
    
    // =============================================================================
    // SENTIMENT ANALYSIS
    // =============================================================================
    
    async function analyzeSentiment(headlines) {
        if (!headlines || headlines.length === 0) {
            return { score: 0, category: 'neutral', emoji: '😐', count: 0 };
        }
        
        try {
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
                throw new Error(`Sentiment analysis failed: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.error) {
                throw new Error(data.error);
            }
            
            let emoji;
            if (data.category === 'bullish') {
                emoji = '🐂';
            } else if (data.category === 'bearish') {
                emoji = '🐻';
            } else {
                emoji = '😐';
            }
            
            return {
                score: data.score,
                category: data.category,
                emoji: emoji,
                count: data.analyzed || data.total,
                confidence: data.confidence,
                breakdown: data.breakdown,
                method: data.method
            };
            
        } catch (error) {
            console.error('Error analyzing sentiment:', error);
            return { score: 0, category: 'neutral', emoji: '😐', count: headlines.length };
        }
    }
    
    // Add sentiment debugging function
    function logSentimentDebug(sentimentData, headlines) {
        console.log('📊 Sentiment Analysis Debug:');
        console.log('  Headlines analyzed:', headlines.length);
        console.log('  Sentiment score:', sentimentData.score);
        console.log('  Category:', sentimentData.category);
        console.log('  Confidence:', sentimentData.confidence);
        console.log('  Method:', sentimentData.method);
        if (sentimentData.breakdown) {
            console.log('  Breakdown:', sentimentData.breakdown);
        }
    }
    
    // =============================================================================
    // UI UPDATE FUNCTIONS
    // =============================================================================
    
    function updatePriceWidget(priceData, coinId) {
        if (!priceData) return;
        
        const { price, change24h } = priceData;
        
        // Get coin symbol from coins list
        const coin = state.coins.find(c => c.id === coinId);
        const symbol = coin ? coin.symbol.toUpperCase() : coinId.toUpperCase();
        
        const priceValueEl = elements.priceWidget.querySelector('.price-value');
        const priceChangeEl = elements.priceWidget.querySelector('.price-change');
        const priceSymbolEl = elements.priceWidget.querySelector('.price-symbol');
        
        priceValueEl.textContent = formatCurrency(price);
        priceChangeEl.textContent = formatPercentage(change24h);
        priceSymbolEl.textContent = symbol;
        
        // Update change color
        priceChangeEl.className = 'price-change';
        if (change24h > 0) {
            priceChangeEl.classList.add('positive');
        } else if (change24h < 0) {
            priceChangeEl.classList.add('negative');
        }
        
        hideError(elements.priceError);
    }
    
    function updateMoodWidget(sentimentData, headlines) {
        const moodBadgeEl = elements.moodWidget.querySelector('.mood-badge');
        const moodScoreEl = elements.moodWidget.querySelector('.mood-score');
        const moodSourceEl = elements.moodWidget.querySelector('.mood-source');
        
        moodBadgeEl.textContent = `${sentimentData.emoji} ${sentimentData.category.charAt(0).toUpperCase() + sentimentData.category.slice(1)}`;
        moodBadgeEl.className = `mood-badge ${sentimentData.category}`;
        
        // Enhanced score display with breakdown
        let scoreText = `Score: ${sentimentData.score.toFixed(2)}`;
        if (sentimentData.breakdown) {
            scoreText += ` (${sentimentData.breakdown.positive}+ ${sentimentData.breakdown.negative}- ${sentimentData.breakdown.neutral}=)`;
        }
        moodScoreEl.textContent = scoreText;
        
        let sourceText = `Based on ${sentimentData.count} headlines`;
        if (sentimentData.method) {
            sourceText += ` • ${sentimentData.method === 'cohere-chat-api' ? 'AI Analysis' : 'Keyword Analysis'}`;
        }
        if (sentimentData.confidence) {
            sourceText += ` • ${(sentimentData.confidence * 100).toFixed(0)}% confidence`;
        }
        moodSourceEl.textContent = sourceText;
        
        // Update news container
        if (headlines && headlines.length > 0) {
            elements.newsContainer.innerHTML = headlines.slice(0, 5).map((item, index) => `
                <div class="news-item">
                    <strong>${index + 1}.</strong> ${escapeHtml(item.title)}
                </div>
            `).join('');
        } else {
            elements.newsContainer.innerHTML = '<div class="news-item">No recent headlines found</div>';
        }
        
        hideError(elements.moodError);
    }
    
    function updateChart(priceHistory, sentimentData, coinId) {
        if (!priceHistory || priceHistory.length === 0) return;
        
        // Destroy existing chart
        if (state.chartInstance) {
            state.chartInstance.destroy();
            state.chartInstance = null;
        }
        
        const ctx = elements.mainChart.getContext('2d');
        
        // Prepare sentiment bar data for last day
        const lastDate = priceHistory[priceHistory.length - 1].x;
        const sentimentBarData = [{
            x: lastDate,
            y: sentimentData.score
        }];
        
        // Determine sentiment bar color
        let sentimentColor;
        if (sentimentData.category === 'bullish') {
            sentimentColor = 'rgba(40, 167, 69, 0.8)';
        } else if (sentimentData.category === 'bearish') {
            sentimentColor = 'rgba(220, 53, 69, 0.8)';
        } else {
            sentimentColor = 'rgba(108, 117, 125, 0.8)';
        }
        
        const coin = state.coins.find(c => c.id === coinId);
        const symbol = coin ? coin.symbol.toUpperCase() : coinId.toUpperCase();
        
        state.chartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [
                    {
                        label: `${symbol} Price (USD)`,
                        data: priceHistory,
                        borderColor: '#007bff',
                        backgroundColor: 'rgba(0, 123, 255, 0.1)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.1,
                        yAxisID: 'price'
                    },
                    {
                        label: 'Today\'s Sentiment',
                        data: sentimentBarData,
                        type: 'bar',
                        backgroundColor: sentimentColor,
                        borderColor: sentimentColor.replace('0.8', '1'),
                        borderWidth: 1,
                        yAxisID: 'sentiment',
                        barThickness: 30
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                scales: {
                    x: {
                        type: 'time',
                        time: {
                            unit: 'day',
                            displayFormats: {
                                day: 'MMM dd'
                            }
                        },
                        title: {
                            display: true,
                            text: 'Date'
                        }
                    },
                    price: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: {
                            display: true,
                            text: 'Price (USD)'
                        },
                        ticks: {
                            callback: function(value) {
                                return formatCurrency(value);
                            }
                        }
                    },
                    sentiment: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        title: {
                            display: true,
                            text: 'Sentiment Score'
                        },
                        min: -5,
                        max: 5,
                        grid: {
                            drawOnChartArea: false,
                        },
                        ticks: {
                            callback: function(value) {
                                if (value > 1) return `${value} (Bullish)`;
                                if (value < -1) return `${value} (Bearish)`;
                                return `${value} (Neutral)`;
                            }
                        }
                    }
                },
                plugins: {
                    title: {
                        display: true,
                        text: `${symbol} Price vs Market Sentiment`,
                        font: {
                            size: 16
                        }
                    },
                    legend: {
                        display: true
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                if (context.dataset.label.includes('Price')) {
                                    return `Price: ${formatCurrency(context.parsed.y)}`;
                                } else {
                                    return `Sentiment: ${context.parsed.y.toFixed(2)} (${sentimentData.category})`;
                                }
                            }
                        }
                    }
                }
            }
        });
        
        hideError(elements.chartError);
    }
    
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    // =============================================================================
    // MAIN DASHBOARD FUNCTIONS
    // =============================================================================
    
    async function populateCoinSelect() {
        try {
            elements.coinSelect.innerHTML = '<option value="">Loading coins...</option>';
            
            const coins = await fetchCoinsList();
            
            // Clear and populate dropdown
            elements.coinSelect.innerHTML = '';
            
            // Add popular coins first - ensuring all user-specified coins are prioritized
            const popularCoins = ['bitcoin', 'ethereum', 'dogecoin', 'cardano', 'solana', 'litecoin', 'bitcoin-cash', 'ripple', 'polkadot', 'chainlink', 'stellar', 'monero', 'tezos', 'eos', 'zcash', 'dash'];
            
            coins.forEach(coin => {
                const option = document.createElement('option');
                option.value = coin.id;
                option.textContent = `${coin.name} (${coin.symbol.toUpperCase()})`;
                
                // Add popular coins to top
                if (popularCoins.includes(coin.id)) {
                    elements.coinSelect.insertBefore(option, elements.coinSelect.firstChild);
                } else {
                    elements.coinSelect.appendChild(option);
                }
            });
            
            // Set default selection
            elements.coinSelect.value = state.selectedCoin;
            
        } catch (error) {
            console.error('Error populating coin select:', error);
            elements.coinSelect.innerHTML = '<option value="bitcoin">Bitcoin (BTC)</option>';
        }
    }
    
    async function updateDashboard(coinId = state.selectedCoin) {
        console.log(`🔄 Updating complete dashboard for ${coinId}`);
        
        try {
            // Fetch all data in parallel for consistent snapshot
            const [priceData, priceHistory, headlines] = await Promise.all([
                fetchCurrentPrice(coinId).catch(err => {
                    console.error('Price fetch error:', err);
                    showError(elements.priceError, err.message);
                    return null;
                }),
                fetchPriceHistory(coinId).catch(err => {
                    console.error('Chart data fetch error:', err);
                    showError(elements.chartError, err.message);
                    return null;
                }),
                fetchCoinNews(coinId).catch(err => {
                    console.log('News fetch failed:', err.message);
                    return [];
                })
            ]);
            
            // Analyze sentiment from headlines
            const sentimentData = await analyzeSentiment(headlines);
            logSentimentDebug(sentimentData, headlines);
            
            // Update all UI components in sequence to ensure consistency
            console.log('📊 Updating all dashboard components...');
            
            if (priceData) {
                updatePriceWidget(priceData, coinId);
                console.log(`💰 Price updated: ${formatCurrency(priceData.price)} (${formatPercentage(priceData.change24h)})`);
            }
            
            updateMoodWidget(sentimentData, headlines);
            console.log(`🧠 Sentiment updated: ${sentimentData.category} (${sentimentData.score.toFixed(2)})`);
            
            if (priceHistory && priceData) {
                updateChart(priceHistory, sentimentData, coinId);
                console.log(`📈 Chart updated with ${priceHistory.length} price points`);
            }
            
            updateTimestamp();
            console.log('✅ Dashboard update complete - all components synchronized');
            
        } catch (error) {
            console.error('❌ Error updating dashboard:', error);
        }
    }
    
    // =============================================================================
    // EVENT HANDLERS
    // =============================================================================
    
    function handleCoinChange(event) {
        const newCoinId = event.target.value;
        if (newCoinId && newCoinId !== state.selectedCoin) {
            state.selectedCoin = newCoinId;
            updateDashboard(newCoinId);
        }
    }
    
    function handleRefresh() {
        // Reset rate limiting for immediate refresh
        state.lastFetchTimes = {
            coinsList: 0,
            price: 0,
            chart: 0,
            news: 0
        };
        
        updateDashboard();
    }
    
    function handleThemeToggle() {
        document.body.classList.toggle('dark-theme');
        const isDark = document.body.classList.contains('dark-theme');
        
        elements.themeToggle.textContent = isDark ? '☀️' : '🌙';
        
        // Save theme preference
        localStorage.setItem('cryptoDashboardTheme', isDark ? 'dark' : 'light');
    }
    
    // =============================================================================
    // INITIALIZATION
    // =============================================================================
    
    async function initializeDashboard() {
        console.log('Initializing Crypto Mood Dashboard...');
        
        try {
            // No need to initialize sentiment analyzer - handled by worker
            console.log('Dashboard initializing with Cloudflare Worker backend');
            
            // Load theme preference
            const savedTheme = localStorage.getItem('cryptoDashboardTheme');
            if (savedTheme === 'dark') {
                document.body.classList.add('dark-theme');
                elements.themeToggle.textContent = '☀️';
            }
            
            // Set up event listeners
            elements.coinSelect.addEventListener('change', handleCoinChange);
            elements.refreshBtn.addEventListener('click', handleRefresh);
            elements.realTimeBtn.addEventListener('click', toggleRealTime);
            elements.themeToggle.addEventListener('click', handleThemeToggle);
            
            // Populate coin selector
            await populateCoinSelect();
            
            // Initial dashboard update
            await updateDashboard();
            
            console.log('Dashboard initialization complete');
            
        } catch (error) {
            console.error('Error initializing dashboard:', error);
        }
    }
    
    // =============================================================================
    // START APPLICATION
    // =============================================================================
    
    // Add global error handler to prevent extension errors from polluting console
    window.addEventListener('error', function(event) {
        // Filter out extension-related errors
        if (event.message && (
            event.message.includes('Extension context invalidated') ||
            event.message.includes('message channel closed') ||
            event.message.includes('Receiving end does not exist')
        )) {
            event.preventDefault();
            return false;
        }
    });
    
    // Add unhandled promise rejection handler
    window.addEventListener('unhandledrejection', function(event) {
        // Filter out extension-related promise rejections
        if (event.reason && event.reason.message && (
            event.reason.message.includes('Extension context invalidated') ||
            event.reason.message.includes('message channel closed') ||
            event.reason.message.includes('Receiving end does not exist')
        )) {
            event.preventDefault();
            return false;
        }
        console.warn('Unhandled promise rejection:', event.reason);
    });
    
    // Wait for DOM and external libraries to load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeDashboard);
    } else {
        // DOM already loaded, wait a bit for external scripts
        setTimeout(initializeDashboard, 100);
    }
    
})();
