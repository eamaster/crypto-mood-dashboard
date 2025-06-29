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
    
    // Rate limiting - max 1 request per endpoint per 3 seconds (more reasonable for dashboard)
    const RATE_LIMIT_MS = 3000;
    
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
        
        // Skip rate limiting if this is the first fetch (initial load)
        const lastFetch = state.lastFetchTimes[endpoint] || 0;
        if (lastFetch === 0) {
            return false; // Allow initial fetch
        }
        
        const now = Date.now();
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
            console.log('Price fetch rate limited, using cached data if available');
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
        
        // Mobile responsive settings
        const isMobile = window.innerWidth <= 768;
        const isSmallMobile = window.innerWidth <= 480;
        
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
                        borderWidth: isMobile ? 1.5 : 2,
                        fill: true,
                        tension: 0.1,
                        yAxisID: 'price',
                        pointRadius: isMobile ? 1 : 2,
                        pointHoverRadius: isMobile ? 4 : 6
                    },
                    {
                        label: 'Today\'s Sentiment',
                        data: sentimentBarData,
                        type: 'bar',
                        backgroundColor: sentimentColor,
                        borderColor: sentimentColor.replace('0.8', '1'),
                        borderWidth: 1,
                        yAxisID: 'sentiment',
                        barThickness: isMobile ? 20 : 30
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                resizeDelay: 100,
                devicePixelRatio: window.devicePixelRatio || 1,
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
                                day: isSmallMobile ? 'M/d' : 'MMM dd'
                            }
                        },
                        title: {
                            display: !isSmallMobile,
                            text: 'Date',
                            font: {
                                size: isMobile ? 10 : 12
                            }
                        },
                        ticks: {
                            maxTicksLimit: isSmallMobile ? 3 : isMobile ? 5 : 7,
                            font: {
                                size: isSmallMobile ? 9 : isMobile ? 10 : 11
                            }
                        }
                    },
                    price: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: {
                            display: !isSmallMobile,
                            text: isMobile ? 'Price' : 'Price (USD)',
                            font: {
                                size: isMobile ? 10 : 12
                            }
                        },
                        ticks: {
                            callback: function(value) {
                                return isMobile ? `$${(value/1000).toFixed(0)}k` : formatCurrency(value);
                            },
                            font: {
                                size: isSmallMobile ? 9 : isMobile ? 10 : 11
                            },
                            maxTicksLimit: isMobile ? 5 : 7
                        }
                    },
                    sentiment: {
                        type: 'linear',
                        display: !isSmallMobile,
                        position: 'right',
                        title: {
                            display: !isSmallMobile,
                            text: 'Sentiment',
                            font: {
                                size: isMobile ? 10 : 12
                            }
                        },
                        min: -5,
                        max: 5,
                        grid: {
                            drawOnChartArea: false,
                        },
                        ticks: {
                            callback: function(value) {
                                if (isMobile) {
                                    return value > 1 ? '+' : value < -1 ? '-' : '0';
                                }
                                if (value > 1) return `${value} (Bullish)`;
                                if (value < -1) return `${value} (Bearish)`;
                                return `${value} (Neutral)`;
                            },
                            font: {
                                size: isSmallMobile ? 9 : isMobile ? 10 : 11
                            },
                            maxTicksLimit: isMobile ? 3 : 5
                        }
                    }
                },
                plugins: {
                    title: {
                        display: true,
                        text: isSmallMobile ? `${symbol} Chart` : `${symbol} Price vs Market Sentiment`,
                        font: {
                            size: isSmallMobile ? 12 : isMobile ? 14 : 16,
                            weight: 'bold'
                        }
                    },
                    legend: {
                        display: !isSmallMobile,
                        position: isMobile ? 'bottom' : 'top',
                        labels: {
                            font: {
                                size: isMobile ? 10 : 12
                            },
                            padding: isMobile ? 10 : 20,
                            usePointStyle: true,
                            boxWidth: isMobile ? 12 : 20
                        }
                    },
                    tooltip: {
                        enabled: true,
                        mode: 'index',
                        intersect: false,
                        titleFont: {
                            size: isMobile ? 11 : 13
                        },
                        bodyFont: {
                            size: isMobile ? 10 : 12
                        },
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
                },
                // Mobile-specific optimizations
                animation: {
                    duration: isMobile ? 200 : 500
                },
                elements: {
                    point: {
                        radius: isMobile ? 1 : 2,
                        hoverRadius: isMobile ? 4 : 6
                    },
                    line: {
                        borderWidth: isMobile ? 1.5 : 2
                    }
                }
            }
        });
        
        // Enhanced chart initialization and visibility handling
        debouncedChartInit(() => {
            if (state.chartInstance) {
                // Ensure chart visibility and proper sizing
                ensureChartVisibility(state.chartInstance, 'mainChart');
                
                // Force resize for responsive behavior
                setTimeout(() => {
                    if (state.chartInstance) {
                        try {
                            state.chartInstance.resize();
                            state.chartInstance.update('none');
                            console.log('📊 Main dashboard chart initialized and resized');
                        } catch (error) {
                            console.error('Error during chart initialization:', error);
                        }
                    }
                }, isMobile ? 200 : 100);
            }
        }, isMobile ? 300 : 150);
        
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
            
            // First, add popular coins in the correct order
            popularCoins.forEach(popularCoinId => {
                const coin = coins.find(c => c.id === popularCoinId);
                if (coin) {
                    const option = document.createElement('option');
                    option.value = coin.id;
                    option.textContent = `${coin.name} (${coin.symbol.toUpperCase()})`;
                    elements.coinSelect.appendChild(option);
                }
            });
            
            // Then add remaining coins
            coins.forEach(coin => {
                if (!popularCoins.includes(coin.id)) {
                    const option = document.createElement('option');
                    option.value = coin.id;
                    option.textContent = `${coin.name} (${coin.symbol.toUpperCase()})`;
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
        console.log('📊 Rate limit status:', {
            price: isRateLimited('price'),
            chart: isRateLimited('chart'), 
            news: isRateLimited('news'),
            lastFetchTimes: state.lastFetchTimes
        });
        
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
                    console.error('News fetch failed:', err.message);
                    showError(elements.moodError, `News unavailable: ${err.message}`);
                    return [];
                })
            ]);
            
            // Analyze sentiment from headlines
            console.log(`📰 Analyzing sentiment for ${headlines.length} headlines...`);
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
        console.log('🚀 Initializing Crypto Mood Dashboard...');
        console.log('🔗 Worker URL:', WORKER_URL);
        console.log('⏱️  Rate limit:', RATE_LIMIT_MS, 'ms');
        
        try {
            // No need to initialize sentiment analyzer - handled by worker
            console.log('🔄 Dashboard initializing with Cloudflare Worker backend');
            
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
            console.log('📋 Populating coin selector...');
            await populateCoinSelect();
            
            // Initial dashboard update  
            console.log('🔄 Performing initial dashboard update...');
            await updateDashboard();
            
            console.log('✅ Dashboard initialization complete');
            
        } catch (error) {
            console.error('❌ Error initializing dashboard:', error);
            // Show error in UI for better visibility
            showError(elements.priceError, 'Dashboard initialization failed');
            showError(elements.moodError, 'Dashboard initialization failed');
            showError(elements.chartError, 'Dashboard initialization failed');
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
    
    // Enhanced Mobile responsive handlers with TA chart support
    function handleResize() {
        // Debounce resize events for better performance
        clearTimeout(window.resizeTimeout);
        window.resizeTimeout = setTimeout(() => {
            console.log('🔄 Handling window resize for responsive charts...');
            
            // Resize main dashboard chart if it exists
            if (state.chartInstance) {
                try {
                    state.chartInstance.resize();
                    console.log('📊 Main chart resized successfully');
                } catch (error) {
                    console.error('Error resizing main chart:', error);
                }
            }
            
            // Resize Technical Analysis charts if they exist (window scope)
            if (typeof window.chartInstance !== 'undefined' && window.chartInstance) {
                try {
                    window.chartInstance.resize();
                    console.log('📈 TA primary chart resized successfully');
                } catch (error) {
                    console.error('Error resizing TA primary chart:', error);
                }
            }
            
            if (typeof window.candleChartInstance !== 'undefined' && window.candleChartInstance) {
                try {
                    window.candleChartInstance.resize();
                    console.log('🕯️ TA candlestick chart resized successfully');
                } catch (error) {
                    console.error('Error resizing TA candlestick chart:', error);
                }
            }
            
            // Force refresh on mobile orientation change
            if (window.innerWidth <= 768) {
                console.log('📱 Mobile resize detected, optimizing layout...');
                
                // Small delay to ensure DOM has settled
                setTimeout(() => {
                    // Re-render main dashboard chart
                    if (state.chartInstance) {
                        try {
                            state.chartInstance.update('none'); // Update without animation
                            state.chartInstance.resize();
                        } catch (error) {
                            console.error('Error updating main chart on mobile:', error);
                        }
                    }
                    
                    // Re-render TA charts
                    if (typeof window.chartInstance !== 'undefined' && window.chartInstance) {
                        try {
                            window.chartInstance.update('none');
                            window.chartInstance.resize();
                        } catch (error) {
                            console.error('Error updating TA primary chart on mobile:', error);
                        }
                    }
                    
                    if (typeof window.candleChartInstance !== 'undefined' && window.candleChartInstance) {
                        try {
                            window.candleChartInstance.update('none');
                            window.candleChartInstance.resize();
                        } catch (error) {
                            console.error('Error updating TA candlestick chart on mobile:', error);
                        }
                    }
                    
                    console.log('✅ Mobile chart optimizations complete');
                }, 150);
            }
        }, 250);
    }
    
    // Enhanced chart resize utilities
    function ensureChartVisibility(chartInstance, canvasId) {
        const canvas = document.getElementById(canvasId);
        if (!canvas || !chartInstance) return false;
        
        // Check if canvas container is visible
        const container = canvas.closest('.chart-container, .ta-responsive-chart-container');
        if (!container) return false;
        
        const containerRect = container.getBoundingClientRect();
        const isVisible = containerRect.width > 0 && containerRect.height > 0;
        
        if (isVisible && (canvas.clientWidth === 0 || canvas.clientHeight === 0)) {
            console.log(`🔧 Fixing visibility for chart: ${canvasId}`);
            
            // Force visibility
            canvas.style.display = 'block';
            canvas.style.visibility = 'visible';
            canvas.style.opacity = '1';
            
            // Trigger resize
            setTimeout(() => {
                if (chartInstance) {
                    chartInstance.resize();
                    chartInstance.update('none');
                }
            }, 100);
            
            return true;
        }
        
        return isVisible;
    }
    
    // Debounced chart initialization helper
    function debouncedChartInit(callback, delay = 300) {
        clearTimeout(window.chartInitTimeout);
        window.chartInitTimeout = setTimeout(() => {
            if (typeof callback === 'function') {
                callback();
            }
        }, delay);
    }
    
    // Add resize listener for responsive updates
    window.addEventListener('resize', handleResize);
    
    // Handle orientation change specifically for mobile devices
    window.addEventListener('orientationchange', () => {
        setTimeout(() => {
            handleResize();
            // Force a dashboard refresh to ensure proper mobile layout
            if (window.innerWidth <= 768 && state.selectedCoin) {
                console.log('🔄 Orientation change detected, refreshing dashboard...');
                updateDashboard(state.selectedCoin);
            }
        }, 500); // Delay to allow orientation change to complete
    });
    
    // Global Technical Analysis chart resize support
    // This ensures TA charts resize properly even when loaded on different pages
    window.addEventListener('load', () => {
        // Check if we're on the TA module page
        if (window.location.pathname.includes('technical-analysis') || 
            document.querySelector('#taChart, #candleChart')) {
            
            console.log('🔧 TA module detected, enabling enhanced chart resize support');
            
            // Additional resize handler specifically for TA charts
            const taResizeHandler = () => {
                clearTimeout(window.taResizeTimeout);
                window.taResizeTimeout = setTimeout(() => {
                    // Resize TA charts if they exist
                    if (typeof window.chartInstance !== 'undefined' && window.chartInstance) {
                        try {
                            window.chartInstance.resize();
                            console.log('📈 TA primary chart resized via global handler');
                        } catch (error) {
                            console.error('Error resizing TA primary chart:', error);
                        }
                    }
                    
                    if (typeof window.candleChartInstance !== 'undefined' && window.candleChartInstance) {
                        try {
                            window.candleChartInstance.resize();
                            console.log('🕯️ TA candlestick chart resized via global handler');
                        } catch (error) {
                            console.error('Error resizing TA candlestick chart:', error);
                        }
                    }
                }, 200);
            };
            
            // Add dedicated TA resize listener
            window.addEventListener('resize', taResizeHandler);
            
            // Also handle orientation changes for TA charts
            window.addEventListener('orientationchange', () => {
                setTimeout(taResizeHandler, 600);
            });
        }
    });
    
    // Prevent zoom on double-tap for better mobile UX
    let lastTouchEnd = 0;
    document.addEventListener('touchend', function (event) {
        const now = (new Date()).getTime();
        if (now - lastTouchEnd <= 300) {
            event.preventDefault();
        }
        lastTouchEnd = now;
    }, false);
    
    // Wait for DOM and external libraries to load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeDashboard);
    } else {
        // DOM already loaded, wait a bit for external scripts
        setTimeout(initializeDashboard, 100);
    }
    
})();
