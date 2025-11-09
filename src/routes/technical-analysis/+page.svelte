<script>
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import Chart from 'chart.js/auto';
	import 'chartjs-adapter-date-fns';
	import { format } from 'date-fns';
	import { WORKER_URL } from '../../lib/config.js';

	let selectedCoin = 'bitcoin';
	let timeframe = 7;
	let loading = false;
	let candleLoading = false;
	let error = null;
	let candleError = null;
	
	// Chart instances
	let priceChartCanvas;
	let priceChartInstance = null;
	let candleChartCanvas;
	let candleChartInstance = null;
	
	// Analysis data
	let priceData = [];
	let ohlcData = [];
	let indicators = [];
	let traditionalSignals = [];
	let candlePatterns = [];
	let overallSignal = null;
	let aiAnalysis = null;
	let currentAnalysisData = null;
	
	// UI states
	let aiExplanationData = null;
	
	// Available coins - fetch from worker API (same as main page)
	let coins = [];
	let coinsLoading = true;

	// Fetch coins list from worker (same as main page)
	async function fetchCoins() {
		try {
			const response = await fetch(`${WORKER_URL}/coins`);
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const data = await response.json();
			if (Array.isArray(data) && data.length > 0) {
				coins = data;
				// Ensure bitcoin is selected if available
				if (!selectedCoin || !coins.find(c => c.id === selectedCoin)) {
					selectedCoin = coins.find(c => c.id === 'bitcoin') ? 'bitcoin' : coins[0]?.id || 'bitcoin';
				}
			} else {
				// Fallback to default list if API fails
				coins = [
					{ id: 'bitcoin', name: 'Bitcoin', symbol: 'BTC' },
					{ id: 'ethereum', name: 'Ethereum', symbol: 'ETH' },
					{ id: 'litecoin', name: 'Litecoin', symbol: 'LTC' },
					{ id: 'bitcoin-cash', name: 'Bitcoin Cash', symbol: 'BCH' },
					{ id: 'cardano', name: 'Cardano', symbol: 'ADA' },
					{ id: 'ripple', name: 'Ripple', symbol: 'XRP' },
					{ id: 'dogecoin', name: 'Dogecoin', symbol: 'DOGE' },
					{ id: 'polkadot', name: 'Polkadot', symbol: 'DOT' },
					{ id: 'chainlink', name: 'Chainlink', symbol: 'LINK' },
					{ id: 'stellar', name: 'Stellar', symbol: 'XLM' },
					{ id: 'monero', name: 'Monero', symbol: 'XMR' },
					{ id: 'tezos', name: 'Tezos', symbol: 'XTZ' },
					{ id: 'eos', name: 'EOS', symbol: 'EOS' },
					{ id: 'zcash', name: 'Zcash', symbol: 'ZEC' },
					{ id: 'dash', name: 'Dash', symbol: 'DASH' },
					{ id: 'solana', name: 'Solana', symbol: 'SOL' }
				];
			}
		} catch (err) {
			console.error('Failed to fetch coins, using fallback:', err);
			// Fallback to default list
			coins = [
				{ id: 'bitcoin', name: 'Bitcoin', symbol: 'BTC' },
				{ id: 'ethereum', name: 'Ethereum', symbol: 'ETH' },
				{ id: 'litecoin', name: 'Litecoin', symbol: 'LTC' },
				{ id: 'bitcoin-cash', name: 'Bitcoin Cash', symbol: 'BCH' },
				{ id: 'cardano', name: 'Cardano', symbol: 'ADA' },
				{ id: 'ripple', name: 'Ripple', symbol: 'XRP' },
				{ id: 'dogecoin', name: 'Dogecoin', symbol: 'DOGE' },
				{ id: 'polkadot', name: 'Polkadot', symbol: 'DOT' },
				{ id: 'chainlink', name: 'Chainlink', symbol: 'LINK' },
				{ id: 'stellar', name: 'Stellar', symbol: 'XLM' },
				{ id: 'monero', name: 'Monero', symbol: 'XMR' },
				{ id: 'tezos', name: 'Tezos', symbol: 'XTZ' },
				{ id: 'eos', name: 'EOS', symbol: 'EOS' },
				{ id: 'zcash', name: 'Zcash', symbol: 'ZEC' },
				{ id: 'dash', name: 'Dash', symbol: 'DASH' },
				{ id: 'solana', name: 'Solana', symbol: 'SOL' }
			];
		} finally {
			coinsLoading = false;
		}
	}

	onMount(async () => {
		// Fetch coins first, then auto-analyze Bitcoin
		await fetchCoins();
		// Defer analysis to next tick to allow UI to render first
		setTimeout(() => {
			analyzeTA();
		}, 100);
	});

	onDestroy(() => {
		// Clean up charts
		if (priceChartInstance) {
			priceChartInstance.destroy();
		}
		if (candleChartInstance) {
			candleChartInstance.destroy();
		}
	});

	async function analyzeTA() {
		if (!browser) return;
		
		loading = true;
		candleLoading = true;
		error = null;
		candleError = null;
		aiAnalysis = null;

		
		try {
			console.log(`Starting comprehensive analysis for ${selectedCoin} over ${timeframe} days`);
			
			// Fetch canonical price first (single source of truth)
			console.log(`📊 Fetching canonical price for ${selectedCoin}...`);
			let canonicalPrice = null;
			try {
				const priceResponse = await fetch(`${WORKER_URL}/price?coin=${selectedCoin}&_=${Date.now()}`);
				if (priceResponse.ok) {
					const priceData = await priceResponse.json();
					canonicalPrice = Number(priceData.price);
					console.log(`✅ Canonical price: $${canonicalPrice.toFixed(2)} (source: ${priceData.source || 'unknown'})`);
				}
			} catch (err) {
				console.warn(`⚠️ Failed to fetch canonical price:`, err.message);
			}
			
			// Fetch price data first, then OHLC data with fallback
			console.log(`📊 Fetching price data for ${selectedCoin} (${timeframe} days)...`);
			const fetchedPriceData = await fetchPriceData(selectedCoin, timeframe);
			priceData = fetchedPriceData;
			
			console.log(`📊 Fetching OHLC data for ${selectedCoin}...`);
			let fetchedOhlcData;
			let ohlcLastClosePrice = null;
			try {
				const ohlcResponse = await fetch(`${WORKER_URL}/ohlc?coin=${selectedCoin}&days=${timeframe}&_=${Date.now()}`);
				if (ohlcResponse.ok) {
					const ohlcData = await ohlcResponse.json();
					ohlcLastClosePrice = ohlcData.lastClosePrice ? Number(ohlcData.lastClosePrice) : null;
					fetchedOhlcData = ohlcData.ohlc.map(item => ({
						x: new Date(item.timestamp),
						o: parseFloat(item.open),
						h: parseFloat(item.high),
						l: parseFloat(item.low),
						c: parseFloat(item.close)
					}));
					console.log(`✅ Fetched ${fetchedOhlcData.length} OHLC data points, lastClosePrice=${ohlcData.lastClosePrice}`);
				} else {
					throw new Error(`OHLC endpoint returned ${ohlcResponse.status}`);
				}
			} catch (err) {
				console.warn(`⚠️ OHLC endpoint failed, using fallback:`, err.message);
				fetchedOhlcData = await fetchOHLCData(selectedCoin, timeframe, fetchedPriceData);
			}
			ohlcData = fetchedOhlcData;
			
			// Check price consistency: canonical price vs chart last point vs OHLC lastClosePrice
			if (canonicalPrice && priceData.length > 0) {
				const chartLastPrice = priceData[priceData.length - 1].y;
				const canonicalPriceFormatted = Number(canonicalPrice.toFixed(2));
				const chartLastPriceFormatted = Number(chartLastPrice.toFixed(2));
				const priceDiff = Math.abs(canonicalPriceFormatted - chartLastPriceFormatted);
				
				if (priceDiff > 0.01) {
					console.warn(`⚠️ Price mismatch detected: canonical=$${canonicalPriceFormatted}, chart=$${chartLastPriceFormatted}, diff=$${priceDiff.toFixed(2)}`);
					// Update chart last point to canonical price
					priceData[priceData.length - 1].y = canonicalPrice;
					console.log(`✅ Updated chart last point to canonical price: $${canonicalPrice.toFixed(2)}`);
				}
				
				// Check OHLC lastClosePrice consistency
				if (ohlcLastClosePrice !== null) {
					const ohlcPriceFormatted = Number(ohlcLastClosePrice.toFixed(2));
					const ohlcDiff = Math.abs(canonicalPriceFormatted - ohlcPriceFormatted);
					if (ohlcDiff > 0.01) {
						console.warn(`⚠️ OHLC price mismatch: canonical=$${canonicalPriceFormatted}, ohlc=$${ohlcPriceFormatted}, diff=$${ohlcDiff.toFixed(2)}`);
						// Update OHLC last candle close to canonical price
						if (ohlcData.length > 0) {
							ohlcData[ohlcData.length - 1].c = canonicalPrice;
							console.log(`✅ Updated OHLC last candle close to canonical price: $${canonicalPrice.toFixed(2)}`);
						}
					}
				}
			}
			
			// Calculate technical indicators with improved adaptive periods
			const dataLength = priceData.length;
			
			// ✅ IMPROVED: Better adaptive period calculation for reliability
			// Ensure minimum periods for reliable calculations while adapting to available data
			const minSMAPeriod = Math.max(3, Math.min(5, Math.floor(dataLength / 2)));
			const maxSMAPeriod = Math.min(20, Math.floor(dataLength * 0.8)); // Use up to 80% of data
			const smaPeriod = Math.max(minSMAPeriod, Math.min(maxSMAPeriod, Math.floor(dataLength * 0.6)));
			
			const minRSIPeriod = Math.max(3, Math.min(7, Math.floor(dataLength / 3)));
			const maxRSIPeriod = Math.min(14, Math.floor(dataLength * 0.7));
			const rsiPeriod = Math.max(minRSIPeriod, Math.min(maxRSIPeriod, Math.floor(dataLength * 0.5)));
			
			const bbPeriod = smaPeriod; // BB uses same period as SMA for consistency
			
			// ✅ ADDED: Data quality validation and warnings
			const dataQuality = {
				sufficient: dataLength >= 10,
				reliable: dataLength >= 20,
				optimal: dataLength >= 50
			};
			
			let qualityLabel;
			if (dataQuality.optimal) {
				qualityLabel = 'Optimal (50+)';
			} else if (dataQuality.reliable) {
				qualityLabel = 'Reliable (20+)';
			} else if (dataQuality.sufficient) {
				qualityLabel = 'Sufficient (10+)';
			} else {
				qualityLabel = 'Limited (<10)';
			}
			
			console.log(`📊 Data Quality Assessment:`, {
				points: dataLength,
				quality: qualityLabel,
				adaptivePeriods: { SMA: smaPeriod, RSI: rsiPeriod, BB: bbPeriod }
			});
			
			// Show data quality warning if needed
			if (!dataQuality.reliable) {
				console.warn(`⚠️ LIMITED DATA WARNING: Only ${dataLength} data points available. Indicators may be less reliable. Consider using a longer timeframe.`);
			}
			
			console.log(`📊 Calculating indicators with adaptive periods: SMA=${smaPeriod}, RSI=${rsiPeriod}, BB=${bbPeriod} from ${dataLength} data points`);
			
			const sma = calculateSMA(priceData, smaPeriod);
			const rsi = calculateRSI(priceData, rsiPeriod);
			const bb = calculateBollingerBands(priceData, bbPeriod);
			
			// Validate indicator calculations
			console.log(`✅ Indicators calculated successfully:`, {
				SMA: `${sma.length} points`,
				RSI: `${rsi.length} points`,
				BB: `${bb.upper.length} points`,
				PriceRange: `$${Math.min(...priceData.map(p => p.y)).toLocaleString()} - $${Math.max(...priceData.map(p => p.y)).toLocaleString()}`
			});
			
			// Analyze patterns
			console.log('Analyzing patterns...');
			candlePatterns = ohlcData.length > 0 ? 
				analyzeCandlestickPatterns(ohlcData) : 
				analyzePriceMovementPatterns(priceData);
			
			// Generate trading signals
			traditionalSignals = generateTradingSignals(priceData, rsi, sma, bb);
			const allSignals = [...traditionalSignals, ...candlePatterns];
			overallSignal = calculateOverallSignal(allSignals);
			
			// Prepare indicators for display
			prepareIndicatorsDisplay(rsi, sma, bb, smaPeriod, rsiPeriod, bbPeriod);
			
			// Create charts with synchronized time scales
			console.log(`📊 Creating synchronized charts...`);
			await Promise.all([
				createPriceChart(priceData, sma, bb, smaPeriod),
				createCandlestickChart(ohlcData, priceData)
			]);
			
			// Store analysis data for AI
			currentAnalysisData = {
				priceData, rsi, sma, bb, 
				signals: allSignals,
				candlePatterns,
				coin: selectedCoin,
				timeframe
			};
			
			// Mark loading as complete first (non-blocking)
			loading = false;
			candleLoading = false;
			
			// Perform AI analysis in background (non-blocking, doesn't delay UI)
			performAIAnalysis(priceData, rsi, sma, bb, traditionalSignals, candlePatterns)
				.catch(err => {
					console.warn('AI analysis failed (non-critical):', err);
					// AI analysis failure doesn't affect the page
				});
			
		} catch (err) {
			console.error('Technical analysis error:', err);
			error = err.message;
			loading = false;
			candleLoading = false;
		}
	}

	async function fetchPriceData(coinId, days) {
		// Add timeout to prevent hanging
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout
		
		try {
			const response = await fetch(`${WORKER_URL}/history?coin=${coinId}&days=${days}`, {
				signal: controller.signal
			});
			clearTimeout(timeoutId);
			
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			
			const data = await response.json();
			if (data.error) throw new Error(data.error);
			if (!data.prices || data.prices.length === 0) {
				throw new Error(`No price history found for ${coinId}`);
			}
			
			return data.prices.map(item => ({
				x: new Date(item.timestamp),
				y: item.price
			}));
		} catch (err) {
			clearTimeout(timeoutId);
			if (err.name === 'AbortError') {
				throw new Error('Request timeout - please try again');
			}
			throw err;
		}
	}

	async function fetchOHLCData(coinId, days, fallbackPriceData = null) {
		try {
			// Try OHLC endpoint first (with timeout)
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout for OHLC
			
			try {
				const response = await fetch(`${WORKER_URL}/ohlc?coin=${coinId}&days=${days}`, {
					signal: controller.signal
				});
				clearTimeout(timeoutId);
				
				if (response.ok) {
					const data = await response.json();
					console.log(`✅ Fetched ${data.ohlc.length} OHLC data points from API`);
					return data.ohlc.map(item => ({
						x: new Date(item.timestamp),
						o: parseFloat(item.open),
						h: parseFloat(item.high),
						l: parseFloat(item.low),
						c: parseFloat(item.close)
					}));
				}
			} catch (fetchError) {
				clearTimeout(timeoutId);
				if (fetchError.name === 'AbortError') {
					console.log('🔄 OHLC endpoint timeout, simulating from price data...');
				} else {
					throw fetchError;
				}
			}
		} catch (error) {
			console.log('🔄 OHLC endpoint not available, simulating from price data...');
		}
		
		// Fallback: simulate OHLC from price data (must have fallbackPriceData)
		if (!fallbackPriceData || fallbackPriceData.length < 2) {
			console.warn('⚠️ No price data available for OHLC simulation');
			return [];
		}
		
		// Create meaningful OHLC periods based on available data
		const targetCandles = Math.min(20, Math.max(5, Math.floor(fallbackPriceData.length / 2)));
		const periodSize = Math.max(1, Math.floor(fallbackPriceData.length / targetCandles));
		const ohlcData = [];
		
		console.log(`📊 Simulating ${targetCandles} OHLC candles from ${fallbackPriceData.length} price points (period=${periodSize})`);
		
		for (let i = 0; i < fallbackPriceData.length; i += periodSize) {
			const periodData = fallbackPriceData.slice(i, Math.min(i + periodSize, fallbackPriceData.length));
			if (periodData.length === 0) continue;
			
			const open = periodData[0].y;
			const close = periodData[periodData.length - 1].y;
			const high = Math.max(...periodData.map(p => p.y));
			const low = Math.min(...periodData.map(p => p.y));
			
			// Validate OHLC data integrity
			if (high >= Math.max(open, close) && low <= Math.min(open, close)) {
				ohlcData.push({
					x: periodData[Math.floor(periodData.length / 2)].x,
					o: parseFloat(open.toFixed(2)),
					h: parseFloat(high.toFixed(2)),
					l: parseFloat(low.toFixed(2)),
					c: parseFloat(close.toFixed(2))
				});
			}
		}
		
		console.log(`✅ Generated ${ohlcData.length} valid OHLC candles`);
		return ohlcData;
	}

	// Technical Analysis Functions - Improved for accuracy
	function calculateSMA(data, period) {
		if (data.length < period) {
			console.warn(`⚠️ Insufficient data for SMA: ${data.length} < ${period}`);
			return [];
		}
		
		const sma = [];
		for (let i = period - 1; i < data.length; i++) {
			const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b.y, 0);
			sma.push({ x: data[i].x, y: sum / period });
		}
		
		console.log(`📊 Calculated SMA: ${sma.length} points with period ${period}`);
		return sma;
	}

	function calculateRSI(data, period = 14) {
		if (data.length < period + 1) {
			console.warn(`⚠️ Insufficient data for RSI: ${data.length} < ${period + 1}`);
			return [];
		}
		
		// Calculate price changes
		const changes = [];
		for (let i = 1; i < data.length; i++) {
			changes.push(data[i].y - data[i - 1].y);
		}

		// Calculate initial average gain and loss using Simple Moving Average
		let avgGain = 0, avgLoss = 0;
		for (let i = 0; i < period; i++) {
			if (changes[i] > 0) avgGain += changes[i];
			else avgLoss += Math.abs(changes[i]);
		}
		avgGain /= period;
		avgLoss /= period;

		const rsi = [];
		
		// ✅ IMPROVED: Better calculation with edge case handling
		// Calculate first RSI value with validation
		if (avgLoss === 0) {
			// Handle division by zero - price only went up
			rsi.push({ x: data[period].x, y: 100 });
		} else {
			let rs = avgGain / avgLoss;
			let rsiValue = 100 - (100 / (1 + rs));
			rsi.push({ x: data[period].x, y: Math.max(0, Math.min(100, rsiValue)) });
		}

		// Calculate subsequent RSI values using Wilder's smoothing method
		for (let i = period; i < changes.length; i++) {
			// Wilder's smoothing: (Previous Average * (period-1) + Current Value) / period
			if (changes[i] > 0) {
				avgGain = (avgGain * (period - 1) + changes[i]) / period;
				avgLoss = (avgLoss * (period - 1)) / period;
			} else {
				avgGain = (avgGain * (period - 1)) / period;
				avgLoss = (avgLoss * (period - 1) + Math.abs(changes[i])) / period;
			}

			// ✅ IMPROVED: Enhanced edge case handling and bounds validation
			let rsiValue;
			if (avgLoss === 0) {
				// All recent changes were positive
				rsiValue = 100;
			} else if (avgGain === 0) {
				// All recent changes were negative
				rsiValue = 0;
			} else {
				let rs = avgGain / avgLoss;
				rsiValue = 100 - (100 / (1 + rs));
			}
			
			// Ensure RSI stays within valid bounds [0, 100]
			rsiValue = Math.max(0, Math.min(100, rsiValue));
			
			// Validate the result is a finite number
			if (isNaN(rsiValue) || !isFinite(rsiValue)) {
				console.warn(`⚠️ Invalid RSI value at index ${i}, using previous value`);
				rsiValue = rsi.length > 0 ? rsi[rsi.length - 1].y : 50;
			}
			
			rsi.push({ x: data[i + 1].x, y: rsiValue });
		}
		
		console.log(`📈 Calculated RSI: ${rsi.length} points with period ${period}, range: ${Math.min(...rsi.map(r => r.y)).toFixed(1)} - ${Math.max(...rsi.map(r => r.y)).toFixed(1)}`);
		return rsi;
	}

	function calculateBollingerBands(data, period = 20, stdDev = 2) {
		if (data.length < period) {
			console.warn(`⚠️ Insufficient data for Bollinger Bands: ${data.length} < ${period}`);
			return { upper: [], middle: [], lower: [] };
		}
		
		const bands = { upper: [], middle: [], lower: [] };
		
		// Calculate Bollinger Bands with corrected sample variance formula
		for (let i = period - 1; i < data.length; i++) {
			// Get the correct data slice: from (i - period + 1) to i (inclusive)
			const dataSlice = data.slice(i - period + 1, i + 1);
			
			// Calculate the mean (SMA) for this period
			const mean = dataSlice.reduce((sum, point) => sum + point.y, 0) / period;
			
			// ✅ FIXED: Use sample variance (divide by N-1) for financial calculations
			const variance = dataSlice.reduce((sum, point) => sum + Math.pow(point.y - mean, 2), 0) / (period - 1);
			const standardDeviation = Math.sqrt(variance);
			
			// Validate standard deviation to prevent NaN
			if (!isNaN(standardDeviation) && isFinite(standardDeviation)) {
				const timestamp = data[i].x;
				const upperBand = mean + (standardDeviation * stdDev);
				const lowerBand = mean - (standardDeviation * stdDev);
				
				bands.middle.push({ x: timestamp, y: mean });
				bands.upper.push({ x: timestamp, y: upperBand });
				bands.lower.push({ x: timestamp, y: lowerBand });
			}
		}
		
		console.log(`📏 Calculated Bollinger Bands: ${bands.upper.length} points with period ${period}, std dev: ${stdDev}`);
		return bands;
	}

	function generateTradingSignals(price, rsi, sma, bb) {
		const signals = [];
		
		if (price.length === 0) {
			console.warn('⚠️ No price data available for signal generation');
			return signals;
		}
		
		const currentPrice = price[price.length - 1].y;
		const currentRSI = rsi.length > 0 ? rsi[rsi.length - 1].y : null;
		const currentSMA = sma.length > 0 ? sma[sma.length - 1].y : null;
		const currentBBUpper = bb.upper.length > 0 ? bb.upper[bb.upper.length - 1].y : null;
		const currentBBLower = bb.lower.length > 0 ? bb.lower[bb.lower.length - 1].y : null;

		console.log(`🎯 Generating signals - Price: $${currentPrice.toLocaleString()}, RSI: ${currentRSI?.toFixed(1) || 'N/A'}`);

		// Enhanced RSI signals with more precise thresholds
		if (currentRSI !== null) {
			if (currentRSI < 20) {
				signals.push({ type: 'RSI', signal: 'BUY', strength: 'Strong', reason: `Extremely oversold (RSI ${currentRSI.toFixed(1)} < 20)` });
			} else if (currentRSI < 30) {
				signals.push({ type: 'RSI', signal: 'BUY', strength: 'Medium', reason: `Oversold (RSI ${currentRSI.toFixed(1)} < 30)` });
			} else if (currentRSI > 80) {
				signals.push({ type: 'RSI', signal: 'SELL', strength: 'Strong', reason: `Extremely overbought (RSI ${currentRSI.toFixed(1)} > 80)` });
			} else if (currentRSI > 70) {
				signals.push({ type: 'RSI', signal: 'SELL', strength: 'Medium', reason: `Overbought (RSI ${currentRSI.toFixed(1)} > 70)` });
			} else {
				signals.push({ type: 'RSI', signal: 'NEUTRAL', strength: 'Weak', reason: `Normal range (RSI ${currentRSI.toFixed(1)})` });
			}
		} else {
			signals.push({ type: 'RSI', signal: 'NEUTRAL', strength: 'Weak', reason: 'RSI calculation pending (insufficient data)' });
		}

		// Enhanced SMA signals with percentage-based thresholds
		if (currentSMA !== null) {
			const priceVsSMA = ((currentPrice - currentSMA) / currentSMA) * 100;
			if (priceVsSMA > 3) {
				signals.push({ type: 'SMA', signal: 'BUY', strength: 'Strong', reason: `Price ${priceVsSMA.toFixed(1)}% above SMA` });
			} else if (priceVsSMA > 1) {
				signals.push({ type: 'SMA', signal: 'BUY', strength: 'Medium', reason: `Price ${priceVsSMA.toFixed(1)}% above SMA` });
			} else if (priceVsSMA < -3) {
				signals.push({ type: 'SMA', signal: 'SELL', strength: 'Strong', reason: `Price ${Math.abs(priceVsSMA).toFixed(1)}% below SMA` });
			} else if (priceVsSMA < -1) {
				signals.push({ type: 'SMA', signal: 'SELL', strength: 'Medium', reason: `Price ${Math.abs(priceVsSMA).toFixed(1)}% below SMA` });
			} else {
				signals.push({ type: 'SMA', signal: 'NEUTRAL', strength: 'Weak', reason: `Price near SMA (${priceVsSMA.toFixed(1)}% difference)` });
			}
		} else {
			signals.push({ type: 'SMA', signal: 'NEUTRAL', strength: 'Weak', reason: 'SMA calculation pending (insufficient data)' });
		}

		// Enhanced Bollinger Bands signals with distance calculation
		if (currentBBUpper !== null && currentBBLower !== null) {
			const bandWidth = currentBBUpper - currentBBLower;
			const distanceToUpper = ((currentBBUpper - currentPrice) / bandWidth) * 100;
			const distanceToLower = ((currentPrice - currentBBLower) / bandWidth) * 100;
			
			if (currentPrice < currentBBLower) {
				const overshoot = Math.abs(distanceToLower);
				signals.push({ type: 'BB', signal: 'BUY', strength: overshoot > 5 ? 'Strong' : 'Medium', 
					reason: `Price below lower band (${overshoot.toFixed(1)}% overshoot)` });
			} else if (currentPrice > currentBBUpper) {
				const overshoot = Math.abs(distanceToUpper);
				signals.push({ type: 'BB', signal: 'SELL', strength: overshoot > 5 ? 'Strong' : 'Medium', 
					reason: `Price above upper band (${overshoot.toFixed(1)}% overshoot)` });
			} else {
				const position = ((currentPrice - currentBBLower) / bandWidth) * 100;
				signals.push({ type: 'BB', signal: 'NEUTRAL', strength: 'Weak', 
					reason: `Within bands (${position.toFixed(1)}% from lower)` });
			}
		} else {
			signals.push({ type: 'BB', signal: 'NEUTRAL', strength: 'Weak', reason: 'Bollinger Bands calculation pending (insufficient data)' });
		}

		console.log(`✅ Generated ${signals.length} trading signals`);
		return signals;
	}

	function analyzeCandlestickPatterns(ohlcData) {
		const patterns = [];
		
		if (ohlcData.length < 2) {
			console.log('📊 Insufficient data for pattern analysis');
			return patterns;
		}
		
		console.log(`🔍 Analyzing patterns in ${ohlcData.length} OHLC periods...`);
		
		// Analyze all candles for patterns (not just last few) - matching original HTML
		for (let i = 1; i < ohlcData.length; i++) {
			const candle = ohlcData[i];
			const prevCandle = ohlcData[i - 1];
			
			// Calculate candle properties
			const body = Math.abs(candle.c - candle.o);
			const upperShadow = candle.h - Math.max(candle.c, candle.o);
			const lowerShadow = Math.min(candle.c, candle.o) - candle.l;
			const totalRange = candle.h - candle.l;
			const isBullish = candle.c > candle.o;
			
			// More lenient thresholds for pattern detection (matching original HTML)
			const avgPrice = (candle.h + candle.l + candle.c + candle.o) / 4;
			const significantMove = avgPrice * 0.01; // 1% move is significant
			
			// 1. Doji pattern (small body relative to total range) - matching original HTML
			if (totalRange > 0 && body < totalRange * 0.3 && totalRange > significantMove) {
				patterns.push({
					type: 'Doji',
					signal: 'NEUTRAL',
					strength: 'Medium',
					reason: `Doji pattern shows market indecision (body: $${body.toFixed(2)}, range: $${totalRange.toFixed(2)})`,
					timestamp: candle.x
				});
			}
			
			// 2. Strong bullish/bearish candles - matching original HTML
			if (body > totalRange * 0.6 && totalRange > significantMove) {
				const patternType = isBullish ? 'Strong Bullish Candle' : 'Strong Bearish Candle';
				const signal = isBullish ? 'BUY' : 'SELL';
				patterns.push({
					type: patternType,
					signal: signal,
					strength: 'Medium',
					reason: `${patternType} with large body indicates strong ${isBullish ? 'buying' : 'selling'} pressure`,
					timestamp: candle.x
				});
			}
			
			// 3. Hammer-like patterns (longer lower shadow) - matching original HTML
			if (totalRange > 0 && lowerShadow > body && lowerShadow > totalRange * 0.4) {
				const patternName = 'Hammer-like';
				patterns.push({
					type: patternName,
					signal: 'BUY',
					strength: 'Medium',
					reason: `${patternName} pattern with long lower shadow suggests potential support`,
					timestamp: candle.x
				});
			}
			
			// 4. Shooting Star-like patterns (longer upper shadow) - matching original HTML
			if (totalRange > 0 && upperShadow > body && upperShadow > totalRange * 0.4) {
				const patternName = 'Shooting Star-like';
				patterns.push({
					type: patternName,
					signal: 'SELL',
					strength: 'Medium',
					reason: `${patternName} pattern with long upper shadow suggests potential resistance`,
					timestamp: candle.x
				});
			}
			
			// 5. Trend continuation patterns - matching original HTML
			const prevBody = Math.abs(prevCandle.c - prevCandle.o);
			const prevIsBullish = prevCandle.c > prevCandle.o;
			
			// Two consecutive bullish candles
			if (isBullish && prevIsBullish && body > significantMove && prevBody > significantMove) {
				patterns.push({
					type: 'Bullish Continuation',
					signal: 'BUY',
					strength: 'Medium',
					reason: 'Two consecutive bullish periods suggest upward momentum',
					timestamp: candle.x
				});
			}
			
			// Two consecutive bearish candles
			if (!isBullish && !prevIsBullish && body > significantMove && prevBody > significantMove) {
				patterns.push({
					type: 'Bearish Continuation',
					signal: 'SELL',
					strength: 'Medium',
					reason: 'Two consecutive bearish periods suggest downward momentum',
					timestamp: candle.x
				});
			}
			
			// 6. Reversal patterns (direction change) - matching original HTML
			if (prevIsBullish && !isBullish && body > prevBody * 0.8) {
				patterns.push({
					type: 'Bearish Reversal',
					signal: 'SELL',
					strength: 'Strong',
					reason: 'Strong bearish candle after bullish period suggests trend reversal',
					timestamp: candle.x
				});
			}
			
			if (!prevIsBullish && isBullish && body > prevBody * 0.8) {
				patterns.push({
					type: 'Bullish Reversal',
					signal: 'BUY',
					strength: 'Strong',
					reason: 'Strong bullish candle after bearish period suggests trend reversal',
					timestamp: candle.x
				});
			}
		}
		
		console.log(`🔍 Found ${patterns.length} candlestick patterns:`, patterns.map(p => p.type));
		return patterns;
	}

	function analyzePriceMovementPatterns(priceData) {
		const patterns = [];
		
		if (priceData.length < 3) {
			console.log('📊 Insufficient price data for pattern analysis');
			return patterns;
		}
		
		console.log(`🔍 Analyzing price movement patterns in ${priceData.length} data points...`);
		
		// Calculate price movements and trends - matching original HTML
		const movements = [];
		for (let i = 1; i < priceData.length; i++) {
			const prevPrice = priceData[i - 1].y;
			const currentPrice = priceData[i].y;
			const change = currentPrice - prevPrice;
			const percentChange = (change / prevPrice) * 100;
			
			movements.push({
				x: priceData[i].x,
				price: currentPrice,
				change: change,
				percentChange: percentChange,
				isPositive: change >= 0,
				isSignificant: Math.abs(percentChange) > 1 // 1% change is significant
			});
		}
		
		// Look for consecutive patterns - matching original HTML
		for (let i = 1; i < movements.length; i++) {
			const currentMove = movements[i];
			const prevMove = movements[i - 1];
			
			// Strong upward movement
			if (currentMove.percentChange > 2) {
				patterns.push({
					type: 'Strong Price Increase',
					signal: 'BUY',
					strength: 'Medium',
					reason: `Strong upward movement of ${currentMove.percentChange.toFixed(2)}% suggests buying interest`,
					timestamp: currentMove.x
				});
			}
			
			// Strong downward movement
			if (currentMove.percentChange < -2) {
				patterns.push({
					type: 'Strong Price Decrease',
					signal: 'SELL',
					strength: 'Medium',
					reason: `Strong downward movement of ${currentMove.percentChange.toFixed(2)}% suggests selling pressure`,
					timestamp: currentMove.x
				});
			}
			
			// Trend continuation (two consecutive moves in same direction)
			if (currentMove.isPositive && prevMove.isPositive && 
				currentMove.isSignificant && prevMove.isSignificant) {
				patterns.push({
					type: 'Bullish Momentum',
					signal: 'BUY',
					strength: 'Medium',
					reason: 'Two consecutive positive price movements suggest upward momentum',
					timestamp: currentMove.x
				});
			}
			
			if (!currentMove.isPositive && !prevMove.isPositive && 
				currentMove.isSignificant && prevMove.isSignificant) {
				patterns.push({
					type: 'Bearish Momentum',
					signal: 'SELL',
					strength: 'Medium',
					reason: 'Two consecutive negative price movements suggest downward momentum',
					timestamp: currentMove.x
				});
			}
			
			// Reversal patterns (direction change)
			if (prevMove.isPositive && !currentMove.isPositive && 
				Math.abs(currentMove.percentChange) > Math.abs(prevMove.percentChange)) {
				patterns.push({
					type: 'Bearish Reversal',
					signal: 'SELL',
					strength: 'Strong',
					reason: 'Strong negative movement after positive suggests trend reversal',
					timestamp: currentMove.x
				});
			}
			
			if (!prevMove.isPositive && currentMove.isPositive && 
				Math.abs(currentMove.percentChange) > Math.abs(prevMove.percentChange)) {
				patterns.push({
					type: 'Bullish Reversal',
					signal: 'BUY',
					strength: 'Strong',
					reason: 'Strong positive movement after negative suggests trend reversal',
					timestamp: currentMove.x
				});
			}
		}
		
		// Look for consolidation patterns (small movements) - matching original HTML
		let consolidationCount = 0;
		for (let i = movements.length - 5; i < movements.length; i++) {
			if (i >= 0 && Math.abs(movements[i].percentChange) < 0.5) {
				consolidationCount++;
			}
		}
		
		if (consolidationCount >= 3) {
			patterns.push({
				type: 'Price Consolidation',
				signal: 'NEUTRAL',
				strength: 'Medium',
				reason: `Recent price movements show consolidation with ${consolidationCount} small changes`,
				timestamp: movements[movements.length - 1].x
			});
		}
		
		// Look for overall trend in recent movements - matching original HTML
		const recentMovements = movements.slice(-5);
		const positiveCount = recentMovements.filter(m => m.isPositive).length;
		const negativeCount = recentMovements.filter(m => !m.isPositive).length;
		
		if (positiveCount >= 4) {
			patterns.push({
				type: 'Strong Uptrend',
				signal: 'BUY',
				strength: 'Strong',
				reason: `${positiveCount} out of ${recentMovements.length} recent movements are positive`,
				timestamp: movements[movements.length - 1].x
			});
		} else if (negativeCount >= 4) {
			patterns.push({
				type: 'Strong Downtrend',
				signal: 'SELL',
				strength: 'Strong',
				reason: `${negativeCount} out of ${recentMovements.length} recent movements are negative`,
				timestamp: movements[movements.length - 1].x
			});
		}
		
		console.log(`🔍 Found ${patterns.length} price movement patterns:`, patterns.map(p => p.type));
		return patterns;
	}

	function calculateOverallSignal(signals) {
		console.log('📊 Calculating overall signal from signals:', signals.map(s => `${s.type}: ${s.signal} (${s.strength})`));
		
		let buyCount = 0;
		let sellCount = 0;
		let neutralCount = 0;
		let totalActionableStrength = 0; // Only BUY/SELL signals
		let totalStrength = 0; // All signals including NEUTRAL

		signals.forEach(signal => {
			const strengthValue = signal.strength === 'Strong' ? 3 : signal.strength === 'Medium' ? 2 : 1;
			totalStrength += strengthValue;

			if (signal.signal === 'BUY') {
				buyCount += strengthValue;
				totalActionableStrength += strengthValue;
			} else if (signal.signal === 'SELL') {
				sellCount += strengthValue;
				totalActionableStrength += strengthValue;
			} else if (signal.signal === 'NEUTRAL') {
				neutralCount += strengthValue;
			}
		});

		// Calculate percentages based on actionable signals only (ignore NEUTRAL for thresholds)
		let buyPercentage = 0;
		let sellPercentage = 0;
		let confidence = 50;
		
		if (totalActionableStrength > 0) {
			buyPercentage = (buyCount / totalActionableStrength) * 100;
			sellPercentage = (sellCount / totalActionableStrength) * 100;
		}
		
		// Enhanced decision logic with lower thresholds and RSI override - matching original HTML
		let signal;
		
		// Special case: Strong RSI signal (oversold/overbought) can override other signals
		const rsiSignal = signals.find(s => s.type === 'RSI');
		if (rsiSignal && rsiSignal.strength === 'Strong') {
			if (rsiSignal.signal === 'BUY' && buyCount >= sellCount) {
				signal = 'BUY';
				confidence = Math.min(85, 65 + (buyCount - sellCount) * 5);
			} else if (rsiSignal.signal === 'SELL' && sellCount >= buyCount) {
				signal = 'SELL';
				confidence = Math.min(85, 65 + (sellCount - buyCount) * 5);
			} else {
				// RSI signal conflicts with other indicators
				signal = 'HOLD';
				confidence = 55;
			}
		} else {
			// Normal logic with reduced thresholds
			if (buyPercentage >= 45) { // Reduced from 60% to 45%
				signal = 'BUY';
				confidence = Math.min(90, 50 + buyPercentage * 0.6);
			} else if (sellPercentage >= 45) { // Reduced from 60% to 45%
				signal = 'SELL';
				confidence = Math.min(90, 50 + sellPercentage * 0.6);
			} else {
				signal = 'HOLD';
				confidence = Math.max(45, 60 - Math.abs(buyPercentage - sellPercentage));
			}
		}
		
		const result = {
			signal: signal,
			confidence: Math.round(confidence),
			buyCount: buyCount,
			sellCount: sellCount,
			neutralCount: neutralCount,
			buyPercentage: buyPercentage.toFixed(1),
			sellPercentage: sellPercentage.toFixed(1)
		};
		
		console.log('📊 Overall signal calculation:', result);
		return result;
	}

	function prepareIndicatorsDisplay(rsi, sma, bb, smaPeriod, rsiPeriod, bbPeriod) {
		indicators = [];
		
		// RSI indicator
		const currentRSI = rsi.length > 0 ? rsi[rsi.length - 1].y : null;
		const rsiSignal = traditionalSignals.find(s => s.type === 'RSI');
		if (rsiSignal) {
			indicators.push({
				type: 'RSI',
				period: rsiPeriod,
				value: currentRSI ? currentRSI.toFixed(1) : 'N/A',
				signal: rsiSignal.signal,
				strength: rsiSignal.strength,
				reason: rsiSignal.reason
			});
		}
		
		// SMA indicator
		const smaSignal = traditionalSignals.find(s => s.type === 'SMA');
		if (smaSignal) {
			indicators.push({
				type: 'SMA',
				period: smaPeriod,
				value: 'Moving Average',
				signal: smaSignal.signal,
				strength: smaSignal.strength,
				reason: smaSignal.reason
			});
		}
		
		// Bollinger Bands
		const bbSignal = traditionalSignals.find(s => s.type === 'BB');
		if (bbSignal) {
			indicators.push({
				type: 'Bollinger Bands',
				period: bbPeriod,
				value: 'Volatility Bands',
				signal: bbSignal.signal,
				strength: bbSignal.strength,
				reason: bbSignal.reason
			});
		}
	}

	async function createPriceChart(data, sma, bb, smaPeriod) {
		if (!browser || data.length === 0) return;
		
		// Wait for canvas element to be available
		if (!priceChartCanvas) {
			setTimeout(() => createPriceChart(data, sma, bb, smaPeriod), 100);
			return;
		}
		
		// Destroy existing chart
		if (priceChartInstance) {
			priceChartInstance.destroy();
			priceChartInstance = null;
		}
		
		const datasets = [
			{
				label: `${selectedCoin.toUpperCase()} Price`,
				data: data,
				borderColor: '#007bff',
				backgroundColor: 'rgba(0, 123, 255, 0.1)',
				borderWidth: 2,
				fill: true,
				tension: 0.1,
				pointRadius: 1
			}
		];
		
		if (sma.length > 0) {
			datasets.push({
				label: `SMA ${smaPeriod}`,
				data: sma,
				borderColor: '#28a745',
				borderWidth: 2,
				fill: false,
				pointRadius: 0
			});
		}
		
		if (bb.upper.length > 0) {
			datasets.push(
				{
					label: 'BB Upper',
					data: bb.upper,
					borderColor: '#dc3545',
					borderWidth: 1,
					borderDash: [5, 5],
					fill: false,
					pointRadius: 0
				},
				{
					label: 'BB Lower',
					data: bb.lower,
					borderColor: '#dc3545',
					borderWidth: 1,
					borderDash: [5, 5],
					fill: false,
					pointRadius: 0
				}
			);
		}
		
		priceChartInstance = new Chart(priceChartCanvas, {
			type: 'line',
			data: { datasets },
			options: {
				responsive: true,
				maintainAspectRatio: false,
				scales: {
					x: {
						type: 'time',
						time: { unit: 'day' },
						title: { display: true, text: 'Date' }
					},
					y: {
						title: { display: true, text: 'Price (USD)' },
						ticks: {
							callback: function(value) {
								return '$' + value.toLocaleString();
							}
						}
					}
				},
				plugins: {
					title: {
						display: true,
						text: `${selectedCoin.toUpperCase()} Technical Analysis - ${data.length} data points`
					},
					legend: { display: true, position: 'top' },
					subtitle: {
						display: data.length < 20,
						text: `⚠️ Limited data (${data.length} points) - Indicators may be less reliable`,
						font: { size: 11, style: 'italic' },
						color: '#ffc107'
					}
				}
			}
		});
		
		// Force chart visibility and render
		setTimeout(() => {
			if (priceChartInstance && priceChartCanvas) {
				priceChartCanvas.style.display = 'block';
				priceChartCanvas.style.visibility = 'visible';
				priceChartInstance.update();
				priceChartInstance.resize();
				console.log('✅ Price chart rendered successfully');
			}
		}, 50);
	}

	async function createCandlestickChart(ohlcData, fallbackPriceData = null) {
		if (!browser) return;
		
		// Wait for canvas element to be available
		if (!candleChartCanvas) {
			setTimeout(() => createCandlestickChart(ohlcData, fallbackPriceData), 100);
			return;
		}
		
		// Destroy existing chart
		if (candleChartInstance) {
			candleChartInstance.destroy();
			candleChartInstance = null;
		}
		
		let datasets = [];
		let chartTitle = 'Price Movement Analysis';
		
		if (ohlcData.length > 0) {
			// Create proper OHLC/candlestick visualization matching original HTML
			console.log(`📊 Creating OHLC chart with ${ohlcData.length} candles`);
			
			const bullishCandles = ohlcData.filter(candle => candle.c >= candle.o);
			const bearishCandles = ohlcData.filter(candle => candle.c < candle.o);
			
			console.log(`📊 OHLC Analysis: ${bullishCandles.length} bullish, ${bearishCandles.length} bearish periods`);
			
			// 1. Bullish periods (close >= open) - Green bars at actual close price levels
			if (bullishCandles.length > 0) {
				datasets.push({
					label: `Bullish Periods (${bullishCandles.length})`,
					data: bullishCandles.map(candle => ({ x: candle.x, y: candle.c })),
					backgroundColor: '#10B98160',
					borderColor: '#10B981',
					borderWidth: 2,
					barThickness: 'flex',
					maxBarThickness: 20
				});
			}
			
			// 2. Bearish periods (close < open) - Red bars at actual close price levels
			if (bearishCandles.length > 0) {
				datasets.push({
					label: `Bearish Periods (${bearishCandles.length})`,
					data: bearishCandles.map(candle => ({ x: candle.x, y: candle.c })),
					backgroundColor: '#EF444460',
					borderColor: '#EF4444',
					borderWidth: 2,
					barThickness: 'flex',
					maxBarThickness: 20
				});
			}
			
			// 3. High-Low wicks for all periods (subtle indicators)
			datasets.push({
				label: 'High-Low Wicks',
				type: 'scatter',
				data: ohlcData.flatMap(candle => [
					{ x: candle.x, y: candle.h },
					{ x: candle.x, y: candle.l }
				]),
				borderColor: '#6B728050',
				backgroundColor: '#6B728050',
				pointRadius: 1,
				pointHoverRadius: 3,
				showLine: false
			});
			
			// 4. Overall price trend line
			datasets.push({
				label: 'Price Trend',
				type: 'line',
				data: ohlcData.map(candle => ({ x: candle.x, y: candle.c })),
				borderColor: '#3B82F6',
				backgroundColor: 'transparent',
				borderWidth: 2,
				pointRadius: 1,
				pointHoverRadius: 4,
				tension: 0.2,
				fill: false
			});
			
			chartTitle = 'OHLC Analysis';
			
		} else if (fallbackPriceData && fallbackPriceData.length >= 2) {
			// Create price movement analysis from price data (matching original HTML)
			console.log(`📊 Creating price movement chart with ${fallbackPriceData.length} data points`);
			
			// Calculate price changes between consecutive points
			const priceChanges = [];
			for (let i = 1; i < fallbackPriceData.length; i++) {
				const prevPrice = fallbackPriceData[i - 1].y;
				const currentPrice = fallbackPriceData[i].y;
				const change = currentPrice - prevPrice;
				
				priceChanges.push({
					x: fallbackPriceData[i].x,
					y: currentPrice,  // Use actual price level for bar height
					change: change,
					isPositive: change >= 0,
					percentChange: (change / prevPrice) * 100
				});
			}
			
			// Split into positive and negative movements (all movements, no filtering)
			const positiveChanges = priceChanges.filter(p => p.isPositive);
			const negativeChanges = priceChanges.filter(p => !p.isPositive);
			
			console.log(`📊 Price Analysis: ${positiveChanges.length} positive movements, ${negativeChanges.length} negative movements`);
			
			// Positive price movements (green bars at actual price levels)
			if (positiveChanges.length > 0) {
				datasets.push({
					label: `Price Increases (${positiveChanges.length})`,
					data: positiveChanges.map(p => ({ x: p.x, y: p.y })),
					backgroundColor: '#10B98160',
					borderColor: '#10B981',
					borderWidth: 2,
					barThickness: 'flex',
					maxBarThickness: 25
				});
			}
			
			// Negative price movements (red bars at actual price levels)
			if (negativeChanges.length > 0) {
				datasets.push({
					label: `Price Decreases (${negativeChanges.length})`,
					data: negativeChanges.map(p => ({ x: p.x, y: p.y })),
					backgroundColor: '#EF444460',
					borderColor: '#EF4444',
					borderWidth: 2,
					barThickness: 'flex',
					maxBarThickness: 25
				});
			}
			
			// Overall price trend line
			datasets.push({
				label: 'Price Trend',
				type: 'line',
				data: fallbackPriceData,
				borderColor: '#3B82F6',
				backgroundColor: 'transparent',
				borderWidth: 2,
				pointRadius: 2,
				pointHoverRadius: 5,
				tension: 0.2,
				fill: false
			});
			
			chartTitle = 'Price Movement Analysis';
			
		} else {
			console.warn('⚠️ No data available for candlestick chart');
			return;
		}
		
		// Create the chart with enhanced configuration matching original HTML
		candleChartInstance = new Chart(candleChartCanvas, {
			type: 'bar',
			data: { datasets },
			options: {
				responsive: true,
				maintainAspectRatio: false,
				resizeDelay: 0,
				devicePixelRatio: window.devicePixelRatio || 1,
				interaction: {
					mode: 'index',
					intersect: false
				},
				scales: {
					x: {
						type: 'time',
						time: { 
							unit: timeframe <= 7 ? 'day' : timeframe <= 30 ? 'day' : 'week',
							displayFormats: {
								day: 'MMM d',
								week: 'MMM d'
							}
						},
						title: { 
							display: true, 
							text: 'Date',
							font: { size: 12, weight: '600' }
						},
						grid: { 
							display: true, 
							color: 'rgba(255, 255, 255, 0.15)',
							lineWidth: 1
						},
						ticks: {
							maxTicksLimit: 7,
							font: { size: 11, weight: '500' }
						}
					},
					y: {
						beginAtZero: false,
						title: { 
							display: true, 
							text: 'Price (USD)',
							font: { size: 12, weight: '600' }
						},
						grid: { 
							display: true, 
							color: 'rgba(255, 255, 255, 0.15)',
							lineWidth: 1
						},
						ticks: {
							callback: function(value) {
								return '$' + value.toLocaleString();
							},
							font: { size: 11, weight: '500' }
						}
					}
				},
				plugins: {
					title: {
						display: true,
						text: chartTitle === 'OHLC Analysis' ? '🕯️ OHLC Price Analysis' : '📊 Price Movement Analysis',
						font: { size: 15, weight: 'bold' }
					},
					legend: { 
						display: true,
						position: 'top',
						labels: {
							usePointStyle: true,
							padding: 8,
							font: { size: 11, weight: '500' },
							filter: function(legendItem) {
								// Hide High-Low Wicks from legend to reduce clutter
								return !['High-Low Wicks'].includes(legendItem.text);
							}
						}
					},
					subtitle: {
						display: true,
						text: '📝 Green bars = price increased, Red bars = price decreased, Blue line = price trend',
						font: { size: 10, style: 'italic', weight: '400' }
					},
					tooltip: {
						mode: 'index',
						intersect: false,
						backgroundColor: 'rgba(0, 0, 0, 0.8)',
						titleColor: '#ffffff',
						bodyColor: '#ffffff',
						borderColor: 'rgba(255, 255, 255, 0.2)',
						borderWidth: 1,
						cornerRadius: 6,
						callbacks: {
							title: function(context) {
								return context[0].label;
							},
							beforeBody: function(context) {
								// Enhanced tooltip for OHLC data
								if (ohlcData.length > 0) {
									const timePoint = context[0].parsed.x;
									const candle = ohlcData.find(c => c.x.getTime() === new Date(timePoint).getTime());
									
									if (candle) {
										const priceChange = candle.c - candle.o;
										const percentChange = ((priceChange / candle.o) * 100).toFixed(2);
										const direction = candle.c >= candle.o ? '📈' : '📉';
										
										return [
											`${direction} OHLC Data:`,
											`Open: $${candle.o.toLocaleString()}`,
											`High: $${candle.h.toLocaleString()}`,
											`Low: $${candle.l.toLocaleString()}`,
											`Close: $${candle.c.toLocaleString()}`,
											`Change: ${priceChange >= 0 ? '+' : ''}$${priceChange.toFixed(2)} (${percentChange}%)`,
											`Range: $${(candle.h - candle.l).toFixed(2)}`
										];
									}
								}
								return [];
							},
							label: function(context) {
								const value = context.parsed.y;
								return `${context.dataset.label}: $${value.toLocaleString()}`;
							}
						}
					}
				},
				layout: {
					padding: { top: 2, bottom: 2, left: 2, right: 2 }
				},
				animation: {
					duration: 200,
					easing: 'easeInOutQuart'
				}
			}
		});
		
		// Force chart visibility and render
		setTimeout(() => {
			if (candleChartInstance && candleChartCanvas) {
				candleChartCanvas.style.display = 'block';
				candleChartCanvas.style.visibility = 'visible';
				candleChartInstance.update();
				candleChartInstance.resize();
				console.log(`✅ ${chartTitle} chart rendered successfully`);
			}
		}, 50);
	}

	async function performAIAnalysis(priceData, rsi, sma, bb, traditionalSignals, candlePatterns) {
		try {
			const currentPrice = priceData[priceData.length - 1].y;
			const currentRSI = rsi.length > 0 ? rsi[rsi.length - 1].y : 50;
			const smaSignal = traditionalSignals.find(s => s.type === 'SMA')?.signal || 'NEUTRAL';
			const bbSignal = traditionalSignals.find(s => s.type === 'BB')?.signal || 'NEUTRAL';
			
			console.log('🤖 Starting AI analysis with Cohere...');
			
			// Try Cohere AI analysis first (with timeout)
			try {
				const controller = new AbortController();
				const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout for AI analysis
				
				try {
					const response = await fetch(`${WORKER_URL}/ai-analysis`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						signal: controller.signal,
						body: JSON.stringify({
							rsi: currentRSI,
							smaSignal,
							bbSignal,
							priceData: priceData.slice(-10), // Send last 10 points to reduce payload
							coin: selectedCoin,
							patterns: candlePatterns.map(p => ({ type: p.type, signal: p.signal })) // Simplified patterns
						})
					});
					clearTimeout(timeoutId);
				
					if (response.ok) {
						const result = await response.json();
						console.log('🤖 Cohere AI analysis successful:', result);
						aiAnalysis = {
							...result,
							method: result.method || 'cohere-ai'
						};
						return;
					} else {
						console.log('🤖 AI analysis endpoint returned error:', response.status);
					}
				} catch (fetchError) {
					clearTimeout(timeoutId);
					if (fetchError.name === 'AbortError') {
						console.log('🤖 AI analysis timeout, using local analysis...');
					} else {
						throw fetchError;
					}
				}
			} catch (error) {
				console.log('🤖 AI analysis endpoint failed:', error.message);
			}
			
			// Fallback to enhanced local analysis
			console.log('🤖 Using enhanced local analysis as fallback...');
			aiAnalysis = performLocalAIAnalysis(currentRSI, smaSignal, bbSignal, priceData, selectedCoin, candlePatterns);
			
		} catch (error) {
			console.error('❌ AI analysis completely failed:', error);
			aiAnalysis = {
				mood: 'neutral',
				confidence: 50,
				reasoning: 'Analysis temporarily unavailable due to technical issues',
				method: 'error'
			};
		}
	}

	function performLocalAIAnalysis(rsi, smaSignal, bbSignal, priceData, coinId, patterns) {
		let bullishScore = 0, bearishScore = 0;
		let reasoning = '';
		
		// Enhanced RSI analysis with extreme conditions
		if (rsi < 20) {
			bullishScore += 3.5;
			reasoning += `🚀 EXTREMELY OVERSOLD RSI (${rsi.toFixed(1)}) - Strong buying opportunity detected. `;
		} else if (rsi < 30) {
			bullishScore += 2.5;
			reasoning += `📈 Oversold RSI (${rsi.toFixed(1)}) suggests potential reversal upward. `;
		} else if (rsi > 80) {
			bearishScore += 3.5;
			reasoning += `🐻 EXTREMELY OVERBOUGHT RSI (${rsi.toFixed(1)}) - Strong selling pressure expected. `;
		} else if (rsi > 70) {
			bearishScore += 2.5;
			reasoning += `📉 Overbought RSI (${rsi.toFixed(1)}) indicates potential reversal downward. `;
		} else if (rsi >= 45 && rsi <= 55) {
			reasoning += `⚖️ Neutral RSI (${rsi.toFixed(1)}) shows balanced momentum. `;
		}
		
		// Enhanced SMA analysis
		if (smaSignal === 'BUY') {
			bullishScore += 1.5;
			reasoning += `📊 Price trending above moving average - bullish momentum confirmed. `;
		} else if (smaSignal === 'SELL') {
			bearishScore += 1.5;
			reasoning += `📊 Price trending below moving average - bearish momentum confirmed. `;
		} else {
			reasoning += `📊 Price consolidating near moving average - awaiting direction. `;
		}
		
		// Enhanced Bollinger Bands analysis
		if (bbSignal === 'BUY') {
			bullishScore += 1.2;
			reasoning += `📏 Price touching lower Bollinger Band - oversold bounce expected. `;
		} else if (bbSignal === 'SELL') {
			bearishScore += 1.2;
			reasoning += `📏 Price touching upper Bollinger Band - overbought pullback likely. `;
		} else {
			reasoning += `📏 Price within normal Bollinger Band range. `;
		}
		
		// Enhanced pattern analysis
		if (patterns && patterns.length > 0) {
			const bullishPatterns = patterns.filter(p => p.signal === 'BUY');
			const bearishPatterns = patterns.filter(p => p.signal === 'SELL');
			const strongBullish = bullishPatterns.filter(p => p.strength === 'Strong').length;
			const strongBearish = bearishPatterns.filter(p => p.strength === 'Strong').length;
			
			bullishScore += bullishPatterns.length * 0.5 + strongBullish * 0.5;
			bearishScore += bearishPatterns.length * 0.5 + strongBearish * 0.5;
			
			if (strongBullish > 0) {
				reasoning += `🕯️ ${strongBullish} strong bullish patterns detected. `;
			}
			if (strongBearish > 0) {
				reasoning += `🕯️ ${strongBearish} strong bearish patterns detected. `;
			}
			if (bullishPatterns.length > bearishPatterns.length) {
				reasoning += `🔄 Pattern analysis favors bullish outlook. `;
			} else if (bearishPatterns.length > bullishPatterns.length) {
				reasoning += `🔄 Pattern analysis favors bearish outlook. `;
			}
		}
		
		// Price momentum analysis
		if (priceData.length >= 3) {
			const recentPrices = priceData.slice(-3);
			const momentum = (recentPrices[2].y - recentPrices[0].y) / recentPrices[0].y;
			if (momentum > 0.03) {
				bullishScore += 1;
				reasoning += `⚡ Strong upward momentum (+${(momentum * 100).toFixed(1)}%). `;
			} else if (momentum < -0.03) {
				bearishScore += 1;
				reasoning += `⚡ Strong downward momentum (${(momentum * 100).toFixed(1)}%). `;
			}
		}
		
		// Determine mood with enhanced logic
		let mood, confidence;
		const totalScore = bullishScore + bearishScore;
		
		if (bullishScore > bearishScore + 0.5) {
			mood = 'bullish';
			confidence = Math.min(95, 50 + (bullishScore - bearishScore) * 15);
			if (bullishScore > 4) {
				reasoning += `🎯 STRONG BULLISH SIGNAL - Multiple indicators align. `;
			}
		} else if (bearishScore > bullishScore + 0.5) {
			mood = 'bearish';
			confidence = Math.min(95, 50 + (bearishScore - bullishScore) * 15);
			if (bearishScore > 4) {
				reasoning += `🎯 STRONG BEARISH SIGNAL - Multiple indicators align. `;
			}
		} else {
			mood = 'neutral';
			confidence = 45 + Math.abs(bullishScore - bearishScore) * 10;
			reasoning += `🤔 Mixed signals detected - market consolidation likely. `;
		}
		
		return {
			mood,
			confidence: Math.round(confidence),
			reasoning: reasoning.trim() || `AI analysis complete for ${coinId.toUpperCase()}`,
			method: 'enhanced-local-ai',
			scores: {
				bullish: bullishScore.toFixed(1),
				bearish: bearishScore.toFixed(1),
				patterns: patterns?.length || 0
			}
		};
	}

	let aiExplanationPending = false;
	const AI_CLIENT_TIMEOUT_MS = 21000; // 21s client timeout (1s less than server 22s)
	
	async function getAIExplanation() {
		if (!currentAnalysisData) {
			alert('Please run an analysis first!');
			return;
		}
		
		if (aiExplanationPending) {
			console.log('🧠 AI explanation already in progress, skipping duplicate request');
			return;
		}
		
		aiExplanationPending = true;
		
		try {
			console.log('🧠 Generating comprehensive AI explanation...');
			
			// Show loading state
			aiExplanationData = {
				explanation: `<div style="display: flex; align-items: center; gap: 10px; color: var(--text-secondary);">
					<div style="width: 20px; height: 20px; border: 2px solid var(--border-color); border-top: 2px solid var(--accent-color); border-radius: 50%; animation: spin 1s linear infinite;"></div>
					Generating comprehensive AI explanation...
				</div>`,
				method: 'loading'
			};
			
			// Extract current values from analysis data
			const latestPriceData = currentAnalysisData.priceData;
			const latestRSIData = currentAnalysisData.rsi;
			const latestSMAData = currentAnalysisData.sma;
			const latestBBData = currentAnalysisData.bb;
			
			// Get the actual LATEST values from the arrays (what's shown on chart)
			const liveCurrentPrice = latestPriceData[latestPriceData.length - 1].y;
			const liveCurrentRSI = latestRSIData.length > 0 ? latestRSIData[latestRSIData.length - 1].y : 50;
			const liveCurrentSMA = latestSMAData.length > 0 ? latestSMAData[latestSMAData.length - 1].y : liveCurrentPrice;
			const liveCurrentBBUpper = latestBBData.upper.length > 0 ? latestBBData.upper[latestBBData.upper.length - 1].y : liveCurrentPrice * 1.05;
			const liveCurrentBBLower = latestBBData.lower.length > 0 ? latestBBData.lower[latestBBData.lower.length - 1].y : liveCurrentPrice * 0.95;
			
			console.log(`📊 LIVE Chart Values - Price: $${liveCurrentPrice.toLocaleString()}, RSI: ${liveCurrentRSI.toFixed(1)}, SMA: $${liveCurrentSMA.toLocaleString()}, BB: [$${liveCurrentBBLower.toLocaleString()}-$${liveCurrentBBUpper.toLocaleString()}]`);
			
			// Prepare comprehensive data for analysis
			const explanationPayload = {
				rsi: currentAnalysisData.rsi,
				sma: currentAnalysisData.sma,
				bb: currentAnalysisData.bb,
				signals: currentAnalysisData.signals || [],
				coin: currentAnalysisData.coin,
				timeframe: currentAnalysisData.timeframe,
				priceData: currentAnalysisData.priceData,
				currentPrice: liveCurrentPrice,
				currentRSI: liveCurrentRSI,
				currentSMA: liveCurrentSMA,
				currentBBUpper: liveCurrentBBUpper,
				currentBBLower: liveCurrentBBLower,
				candlePatterns: currentAnalysisData.candlePatterns || []
			};
			
			// Create AbortController for client timeout
			const controller = new AbortController();
			const timeoutId = setTimeout(() => {
				controller.abort();
			}, AI_CLIENT_TIMEOUT_MS);
			
			try {
				// Try API with client timeout
				const response = await Promise.race([
					fetch(`${WORKER_URL}/ai-explain`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify(explanationPayload),
						signal: controller.signal
					}),
					new Promise((_, reject) => 
						setTimeout(() => reject(new Error('Client timeout: AI explanation took too long')), AI_CLIENT_TIMEOUT_MS)
					)
				]);
				
				clearTimeout(timeoutId);
				
				if (response.ok) {
					const aiExplanation = await response.json();
					const aiStatus = response.headers.get('X-AI-Status') || 'unknown';
					const aiReason = response.headers.get('X-AI-Reason') || null;
					console.log('🧠 AI API Explanation result:', aiExplanation);
					console.log('🧠 AI Status:', aiStatus);
					if (aiReason) console.log('🧠 AI Reason:', aiReason);
					
					// Only render if ok === true or method === 'rule-based-fallback'
					if (aiExplanation.ok === true || aiExplanation.method === 'rule-based-fallback') {
						// If server returned fallback due to timeout, show appropriate message
						let explanationText = aiExplanation.explanation;
						if (aiStatus === 'fallback' && (aiReason === 'ai-total-timeout' || aiReason === 'ai-model-timeout' || aiReason === 'ai-repair-timeout')) {
							// Prepend timeout message to fallback explanation
							explanationText = `<div style="color: var(--warning-color); margin-bottom: 1rem; padding: 0.75rem; background: #fff3cd; border-radius: 8px; border-left: 4px solid #ff9800;">
								<strong>⏱️ AI Timed Out on Server</strong><br>
								The AI explanation request exceeded the server timeout (${aiReason === 'ai-model-timeout' ? 'model call' : aiReason === 'ai-repair-timeout' ? 'repair' : 'total'} timeout). 
								A rule-based explanation is provided below. <em>You can try again if you'd like an AI-generated explanation.</em>
							</div>` + explanationText;
						}
						
						aiExplanationData = {
							explanation: explanationText,
							method: aiExplanation.method || 'cohere-chat-api',
							technicalContext: aiExplanation.technicalContext,
							timestamp: aiExplanation.timestamp,
							aiStatus: aiStatus,
							aiReason: aiReason,
							fallbackReason: aiExplanation.fallbackReason || null
						};
						return;
					} else {
						throw new Error(`AI explanation marked as non-compliant: ${aiExplanation.error || 'unknown error'}`);
					}
				} else {
					throw new Error(`API error: ${response.status}`);
				}
			} catch (fetchError) {
				clearTimeout(timeoutId);
				
				// Check if it's a timeout or abort
				if (fetchError.name === 'AbortError' || fetchError.message.includes('timeout')) {
					console.warn('🧠 AI explanation timed out on client side');
					aiExplanationData = {
						explanation: `<div style="color: var(--warning-color);">
							<strong>⏱️ AI Explanation Timed Out</strong><br>
							The AI explanation request took longer than expected. The server may still be processing your request.<br><br>
							<em>Please try again in a moment, or refer to the technical indicators above for manual analysis.</em>
						</div>`,
						method: 'timeout',
						aiStatus: 'timeout',
						aiReason: 'client-timeout'
					};
					return;
				}
				
				// Other errors - use local fallback
				console.log('🧠 AI API not available, using comprehensive local analysis:', fetchError.message);
				
				// Use comprehensive local analysis (matching original HTML)
				const localExplanation = generateLocalExplanation();
				console.log('🧠 Comprehensive Local Explanation generated:', localExplanation);
				aiExplanationData = localExplanation;
			}
			
		} catch (error) {
			console.error('❌ AI Explanation completely failed:', error);
			aiExplanationData = {
				explanation: `<div style="color: var(--danger-color);">
					<strong>⚠️ AI Explanation Failed:</strong><br>
					${error.message}<br><br>
					<em>Try again in a moment or refer to the technical indicators above for manual analysis.</em>
				</div>`,
				method: 'error',
				aiStatus: 'error',
				aiReason: error.message
			};
		} finally {
			aiExplanationPending = false;
		}
	}

	function generateLocalExplanation() {
		if (!currentAnalysisData) return { explanation: 'No analysis data available', method: 'error' };
		
		console.log('🧠 Generating comprehensive local AI explanation...');
		
		const { priceData, rsi, sma, bb, signals, coin, timeframe, candlePatterns } = currentAnalysisData;
		
		// Extract current values
		const currentPrice = priceData[priceData.length - 1].y;
		const currentRSI = rsi.length > 0 ? rsi[rsi.length - 1].y : null;
		const currentSMA = sma.length > 0 ? sma[sma.length - 1].y : currentPrice;
		const currentBBUpper = bb.upper.length > 0 ? bb.upper[bb.upper.length - 1].y : currentPrice * 1.05;
		const currentBBLower = bb.lower.length > 0 ? bb.lower[bb.lower.length - 1].y : currentPrice * 0.95;
		
		let explanation = '';
		
		// Market Overview
		explanation += `📊 **COMPREHENSIVE TECHNICAL ANALYSIS EXPLANATION for ${coin.toUpperCase()}**\n\n`;
		explanation += `**Current Market Snapshot:**\n`;
		explanation += `• Price: $${currentPrice.toLocaleString()}\n`;
		explanation += `• Timeframe Analyzed: ${timeframe} days\n`;
		explanation += `• Total Data Points: ${priceData.length}\n\n`;
		
		// RSI Analysis
		explanation += `**📈 RSI Analysis (Relative Strength Index):**\n`;
		if (rsi && rsi.length > 0) {
			explanation += `• Current RSI: ${currentRSI.toFixed(2)}\n`;
			if (currentRSI < 20) {
				explanation += `• **EXTREMELY OVERSOLD**: RSI below 20 suggests the asset is heavily oversold and due for a potential bounce. This is a very strong bullish signal.\n`;
			} else if (currentRSI < 30) {
				explanation += `• **OVERSOLD**: RSI below 30 indicates oversold conditions. Historically, this often precedes price recoveries.\n`;
			} else if (currentRSI > 80) {
				explanation += `• **EXTREMELY OVERBOUGHT**: RSI above 80 suggests the asset is heavily overbought and may face selling pressure.\n`;
			} else if (currentRSI > 70) {
				explanation += `• **OVERBOUGHT**: RSI above 70 indicates overbought conditions. This could signal a potential pullback.\n`;
			} else if (currentRSI >= 45 && currentRSI <= 55) {
				explanation += `• **BALANCED**: RSI around 50 shows neutral momentum with no extreme conditions.\n`;
			} else {
				explanation += `• **NORMAL RANGE**: RSI is within typical trading range, suggesting balanced market conditions.\n`;
			}
		} else {
			explanation += `• RSI calculation pending due to limited data points.\n`;
		}
		explanation += '\n';
		
		// Moving Average Analysis
		explanation += `**📊 Moving Average Analysis:**\n`;
		if (sma && sma.length > 0) {
			explanation += `• Current SMA: $${currentSMA.toLocaleString()}\n`;
			const priceVsSMA = ((currentPrice - currentSMA) / currentSMA) * 100;
			explanation += `• Price vs SMA: ${priceVsSMA >= 0 ? '+' : ''}${priceVsSMA.toFixed(2)}%\n`;
			
			if (currentPrice > currentSMA * 1.02) {
				explanation += `• **BULLISH TREND**: Price is significantly above the moving average, indicating upward momentum.\n`;
			} else if (currentPrice < currentSMA * 0.98) {
				explanation += `• **BEARISH TREND**: Price is below the moving average, suggesting downward pressure.\n`;
			} else {
				explanation += `• **CONSOLIDATION**: Price is trading near the moving average, indicating potential consolidation phase.\n`;
			}
		} else {
			explanation += `• Moving average calculation pending due to limited data points.\n`;
		}
		explanation += '\n';
		
		// Bollinger Bands Analysis
		explanation += `**📏 Bollinger Bands Analysis:**\n`;
		if (bb && bb.upper.length > 0) {
			explanation += `• Upper Band: $${currentBBUpper.toLocaleString()}\n`;
			explanation += `• Lower Band: $${currentBBLower.toLocaleString()}\n`;
			explanation += `• Band Width: $${(currentBBUpper - currentBBLower).toLocaleString()}\n`;
			
			if (currentPrice < currentBBLower) {
				explanation += `• **OVERSOLD SIGNAL**: Price is below the lower Bollinger Band, suggesting potential oversold conditions and possible reversal.\n`;
			} else if (currentPrice > currentBBUpper) {
				explanation += `• **OVERBOUGHT SIGNAL**: Price is above the upper Bollinger Band, indicating potential overbought conditions.\n`;
			} else {
				const bandPosition = ((currentPrice - currentBBLower) / (currentBBUpper - currentBBLower)) * 100;
				explanation += `• **BAND POSITION**: Price is at ${bandPosition.toFixed(1)}% of the band range, indicating ${bandPosition > 50 ? 'upper' : 'lower'} band pressure.\n`;
			}
		} else {
			explanation += `• Bollinger Bands calculation pending due to limited data points.\n`;
		}
		explanation += '\n';
		
		// Pattern Analysis
		if (candlePatterns && candlePatterns.length > 0) {
			explanation += `**🕯️ Pattern Recognition:**\n`;
			const bullishPatterns = candlePatterns.filter(p => p.signal === 'BUY');
			const bearishPatterns = candlePatterns.filter(p => p.signal === 'SELL');
			const neutralPatterns = candlePatterns.filter(p => p.signal === 'NEUTRAL');
			
			explanation += `• **Patterns Detected**: ${candlePatterns.length} total (${bullishPatterns.length} bullish, ${bearishPatterns.length} bearish, ${neutralPatterns.length} neutral)\n`;
			
			if (bullishPatterns.length > 0) {
				explanation += `• **Bullish Patterns**: ${bullishPatterns.map(p => p.type).join(', ')}\n`;
			}
			if (bearishPatterns.length > 0) {
				explanation += `• **Bearish Patterns**: ${bearishPatterns.map(p => p.type).join(', ')}\n`;
			}
			if (neutralPatterns.length > 0) {
				explanation += `• **Neutral Patterns**: ${neutralPatterns.map(p => p.type).join(', ')}\n`;
			}
			explanation += '\n';
		}
		
		// Price Trend Analysis
		if (priceData.length >= 3) {
			explanation += `**📈 Price Trend Analysis:**\n`;
			const recentPrices = priceData.slice(-3);
			const shortTermTrend = ((recentPrices[2].y - recentPrices[0].y) / recentPrices[0].y) * 100;
			
			explanation += `• **Short-term Trend**: ${shortTermTrend >= 0 ? '+' : ''}${shortTermTrend.toFixed(2)}%\n`;
			
			if (Math.abs(shortTermTrend) > 2) {
				explanation += `• **Strong Movement**: ${shortTermTrend > 0 ? 'Significant upward momentum' : 'Significant downward momentum'} detected.\n`;
			} else if (Math.abs(shortTermTrend) > 0.5) {
				explanation += `• **Moderate Movement**: ${shortTermTrend > 0 ? 'Mild upward trend' : 'Mild downward trend'} observed.\n`;
			} else {
				explanation += `• **Sideways Movement**: Price showing minimal directional change, indicating consolidation.\n`;
			}
			explanation += '\n';
		}
		
		// Signal Summary
		explanation += `**🎯 Signal Summary:**\n`;
		if (signals && signals.length > 0) {
			const buySignals = signals.filter(s => s.signal === 'BUY');
			const sellSignals = signals.filter(s => s.signal === 'SELL');
			const neutralSignals = signals.filter(s => s.signal === 'NEUTRAL');
			
			explanation += `• **Buy Signals**: ${buySignals.length} (${buySignals.map(s => s.type).join(', ')})\n`;
			explanation += `• **Sell Signals**: ${sellSignals.length} (${sellSignals.map(s => s.type).join(', ')})\n`;
			explanation += `• **Neutral Signals**: ${neutralSignals.length} (${neutralSignals.map(s => s.type).join(', ')})\n`;
		}
		explanation += '\n';
		
		// Trading Implications
		explanation += `**💡 Trading Implications:**\n`;
		if (currentRSI && currentRSI < 30 && currentPrice < currentBBLower) {
			explanation += `• **Strong Buy Setup**: Both RSI and Bollinger Bands suggest oversold conditions.\n`;
		} else if (currentRSI && currentRSI > 70 && currentPrice > currentBBUpper) {
			explanation += `• **Strong Sell Setup**: Both RSI and Bollinger Bands suggest overbought conditions.\n`;
		} else {
			explanation += `• **Mixed Signals**: Indicators show conflicting signals, suggesting caution and further analysis.\n`;
		}
		
		explanation += `• **Risk Management**: Always use stop-losses and position sizing appropriate for your risk tolerance.\n`;
		explanation += `• **Confirmation**: Look for additional confirmations before making trading decisions.\n\n`;
		
		// Educational Note
		explanation += `**📚 Educational Note:**\n`;
		explanation += `This analysis uses adaptive technical indicators that adjust to available data. `;
		explanation += `Short timeframes may have fewer data points, affecting indicator reliability. `;
		explanation += `Always combine technical analysis with fundamental analysis and risk management. `;
		explanation += `Past performance does not guarantee future results.\n\n`;
		
		explanation += `**⚠️ Disclaimer**: This is educational content only, not financial advice. Always do your own research and consult with financial professionals before making investment decisions.`;
		
		return {
			explanation: explanation,
			method: 'comprehensive-local-analysis',
			timestamp: new Date().toISOString()
		};
	}

	function formatAIExplanation(explanation) {
		// Format the explanation with proper line breaks and markdown-style formatting
		let formattedExplanation = explanation
			.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') // Bold text
			.replace(/\n\n/g, '</p><p>') // Paragraph breaks
			.replace(/\n/g, '<br>') // Line breaks
			.replace(/•/g, '&bull;'); // Bullet points
		
		// Wrap in paragraph tags if not already HTML
		if (!formattedExplanation.includes('<p>') && !formattedExplanation.includes('<div>')) {
			formattedExplanation = `<div style="line-height: 1.6;">${formattedExplanation}</div>`;
		}
		
		return formattedExplanation;
	}

	function getMethodDisplayName(method) {
		switch (method) {
			case 'cohere-chat-api':
				return 'Cohere AI';
			case 'comprehensive-local-analysis':
				return 'AI-Enhanced Local';
			case 'enhanced-local-analysis':
				return 'Enhanced Local';
			case 'rule-based':
				return 'Rule-based';
			case 'loading':
				return 'Loading...';
			case 'error':
				return 'Error';
			default:
				return 'Local Analysis';
		}
	}

	function goBack() {
		goto('modules');
	}
</script>

<svelte:head>
	<title>🔍 Technical Analysis - Crypto Mood Dashboard</title>
</svelte:head>

<div class="ta-container">
	<div class="ta-header">
		<div class="header-content">
			<h1>🔍 Technical Analysis Module</h1>
			<button class="back-button" on:click={goBack}>← Back to Modules</button>
		</div>
		<p class="subtitle">Professional crypto technical indicators and signals</p>
	</div>

	<section class="controls">
		<div class="control-group">
			<label for="coinSelect">Cryptocurrency:</label>
			{#if coinsLoading}
				<select disabled>
					<option>Loading coins...</option>
				</select>
			{:else}
				<select id="coinSelect" bind:value={selectedCoin} on:change={analyzeTA}>
					{#each coins as coin}
						<option value={coin.id}>{coin.name} ({coin.symbol})</option>
					{/each}
				</select>
			{/if}
		</div>
		
		<div class="control-group">
			<label for="timeframe">Timeframe:</label>
			<select bind:value={timeframe} on:change={analyzeTA}>
				<option value={7}>7 Days</option>
				<option value={14}>14 Days</option>
				<option value={30}>30 Days</option>
			</select>
		</div>
		
		<div class="button-group">
			<button on:click={analyzeTA} disabled={loading}>
				{loading ? '🔄 Analyzing...' : '🔍 Analyze'}
			</button>
			{#if aiAnalysis}
				<button on:click={getAIExplanation} disabled={aiExplanationPending}>
					{aiExplanationPending ? '⏳ Generating...' : '🤖 AI Explain This'}
				</button>
			{/if}
		</div>
	</section>

	{#if loading || candleLoading}
		<div class="loading-section">
			<div class="loading">
				{loading ? 'Fetching data and calculating indicators...' : ''}
				{candleLoading ? 'Analyzing patterns...' : ''}
			</div>
		</div>
	{:else if error}
		<div class="error-section">
			<div class="error">❌ {error}</div>
		</div>
	{:else if priceData.length > 0}
		<div class="ta-charts-grid">
			<div class="ta-chart-column left">
				<!-- Price Chart -->
				<div class="ta-chart-container">
					<h3>📈 Price Chart with Technical Indicators</h3>
					<div class="chart-info-box">
						<strong>ℹ️ Chart Information:</strong> Technical indicators (SMA, Bollinger Bands) start after collecting sufficient data points for accurate calculations. This delayed start is mathematically correct and ensures reliable signals.
						<br><strong>🤖 AI Enhancement:</strong> Advanced AI analysis will automatically classify market mood and provide pattern explanations below the chart.
						{#if priceData.length > 0}
							<br><strong>📊 Current Analysis:</strong> Using {priceData.length} data points with adaptive periods for optimal accuracy.
						{/if}
					</div>
					<div class="chart-wrapper">
						<canvas bind:this={priceChartCanvas}></canvas>
					</div>
				</div>

				<!-- Candlestick Chart -->
				<div class="ta-chart-container">
					<h3>📊 Price Movement Analysis</h3>
					<div class="chart-info-box">
						<strong>ℹ️ Price Analysis Information:</strong> Shows price movements over time. Green bars = price increased from previous period, Red bars = price decreased, Blue line = overall trend.
						<br><strong>📊 Visual Analysis:</strong> Bar heights represent actual price levels. Color patterns reveal market sentiment and momentum changes over the selected timeframe.
						<br><strong>🔧 Pattern Recognition:</strong> Consecutive price movements and trend changes help identify potential trading opportunities and market psychology.
						{#if ohlcData.length > 0}
							<br><strong>🕯️ OHLC Data:</strong> Using {ohlcData.length} candlestick periods for comprehensive pattern analysis.
						{:else if priceData.length > 0}
							<br><strong>📈 Price Data:</strong> Using {priceData.length} price points for movement pattern analysis.
						{/if}
					</div>
					<div class="chart-wrapper">
						<canvas bind:this={candleChartCanvas}></canvas>
					</div>
					{#if candleError}
						<div class="error">{candleError}</div>
					{/if}
				</div>
			</div>

			<div class="ta-chart-column right">
				<!-- Technical Indicators -->
				<div class="indicators-panel">
					<h3>📊 Technical Indicators</h3>
					<div class="indicators-list">
						{#each indicators as indicator}
							<div class="indicator">
								<h4>{indicator.type} ({indicator.period})</h4>
								<div class="indicator-value">{indicator.value}</div>
								<div class="signal {indicator.signal.toLowerCase()}">{indicator.signal}</div>
								<div class="signal-strength">{indicator.strength} Signal</div>
								<div class="explanation">{indicator.reason}</div>
							</div>
						{/each}
						
						<!-- Patterns -->
						{#if candlePatterns.length > 0}
							<div class="patterns-section">
								<h4>🕯️ Patterns Detected ({candlePatterns.length})</h4>
								<div class="patterns-scroll-container">
									{#each candlePatterns as pattern}
										<div class="pattern-entry">
											<div class="signal {pattern.signal.toLowerCase()}">{pattern.type}</div>
											<div class="signal-strength">{pattern.strength} Signal</div>
											<div class="explanation">{pattern.reason}</div>
										</div>
									{/each}
								</div>
							</div>
						{/if}
						
						<!-- Enhanced Educational Notes -->
						{#if indicators.length > 0 || candlePatterns.length > 0}
							<div class="educational-notes">
								<h4>📚 Educational Notes</h4>
								<div class="educational-content">
									<strong>• Adaptive Indicators:</strong> Period lengths automatically adjust based on available data ({priceData.length} points)
									<br><strong>• Technical Indicators:</strong> 
									{#if indicators.length > 0}
										RSI, SMA, and Bollinger Bands with adaptive periods provide quantitative analysis
									{:else}
										RSI, SMA, and Bollinger Bands provide quantitative analysis
									{/if}
									<br><strong>• Pattern Analysis:</strong> 
									{#if candlePatterns.length > 0}
										{candlePatterns.length} patterns detected for market psychology insights
									{:else}
										Visual patterns reveal market psychology and sentiment
									{/if}
									<br><strong>• Combined Analysis:</strong> Both technical indicators and price patterns work together for comprehensive market analysis
									<br><strong>• Pattern Recognition:</strong> Doji = indecision, Hammer = potential reversal, Strong candles = momentum, Continuation = trend persistence
									<br><strong>• AI Enhancement:</strong> Machine learning analyzes all signals together for improved accuracy and market mood classification
									<br><strong>• Data Quality:</strong> 
									{#if priceData.length >= 50}
										Optimal data quality (50+ points) - Highly reliable indicators
									{:else if priceData.length >= 20}
										Reliable data quality (20+ points) - Good indicator accuracy
									{:else if priceData.length >= 10}
										Sufficient data quality (10+ points) - Moderate indicator reliability
									{:else}
										Limited data quality (&lt;10 points) - Use with caution, consider longer timeframe
									{/if}
								</div>
							</div>
						{/if}
					</div>
				</div>
			</div>
		</div>



		<!-- Overall Summary -->
		{#if overallSignal}
			<div class="ta-summary">
				<h3>📋 Technical Analysis Summary</h3>
				<div class="overall-signal {overallSignal.signal.toLowerCase()}">
					{overallSignal.signal === 'BUY' ? '🚀' : overallSignal.signal === 'SELL' ? '📉' : '⏸️'}
					{overallSignal.signal}
				</div>
				<div class="confidence">Confidence: {overallSignal.confidence}%</div>
				<div class="signal-breakdown">
					Signal Breakdown: {overallSignal.buyCount} BUY • {overallSignal.sellCount} SELL • {overallSignal.neutralCount} NEUTRAL
				</div>
				<div class="disclaimer">
					<strong>⚠️ Remember:</strong> Technical analysis is educational only, not investment advice. 
					Always do your own research and never invest more than you can afford to lose.
				</div>
			</div>
		{/if}

		<!-- AI-Powered Analysis Section (Inline, Mobile-Friendly) -->
		{#if aiAnalysis}
			<div class="ai-analysis-section">
				<div class="ai-analysis-card">
					<h3 class="ai-analysis-header">
						🤖 AI-Powered Market Analysis
						<span class="ai-method-badge">{aiAnalysis.method === 'cohere-chat-api' ? 'Cohere AI' : 'Rule-based'}</span>
					</h3>
					
					<div class="ai-analysis-grid">
						<div class="ai-mood-display">
							<div class="ai-mood-icon">
								{aiAnalysis.mood === 'bullish' ? '🚀' : aiAnalysis.mood === 'bearish' ? '🐻' : '⚖️'}
							</div>
							<div class="ai-mood-label {aiAnalysis.mood}">{aiAnalysis.mood.toUpperCase()}</div>
							<div class="ai-confidence">Confidence: {aiAnalysis.confidence}%</div>
						</div>
						
						<div class="ai-reasoning-container">
							<div class="ai-reasoning">{aiAnalysis.reasoning}</div>
						</div>
					</div>
				</div>
				
				<!-- AI Explanation Section (Inline) -->
				{#if aiExplanationData}
					<div class="ai-explanation-card">
						<h3 class="ai-explanation-header">
							🧠 AI Pattern Explanation
							<span class="ai-explain-badge">
								{aiExplanationData.method === 'cohere-chat-api' ? 'Cohere AI' : 
								 aiExplanationData.method === 'rule-based-fallback' ? 'Rule-based' : 
								 aiExplanationData.method === 'comprehensive-local-analysis' ? 'AI-Enhanced Local' : 'Unknown'}
							</span>
							{#if aiExplanationData.aiStatus === 'repaired'}
								<span class="ai-status-badge" style="font-size: 0.75rem; color: #ff9800; margin-left: 0.5rem; padding: 0.2rem 0.5rem; background: #fff3cd; border-radius: 12px;" title={aiExplanationData.aiReason || 'Model violation repaired'}>⚠️ Repaired</span>
							{:else if aiExplanationData.aiStatus === 'fallback'}
								<span class="ai-status-badge" style="font-size: 0.75rem; color: #9e9e9e; margin-left: 0.5rem; padding: 0.2rem 0.5rem; background: #f5f5f5; border-radius: 12px;" title={aiExplanationData.aiReason || aiExplanationData.fallbackReason || 'Using rule-based fallback'}>
									{#if aiExplanationData.aiReason && (aiExplanationData.aiReason.includes('timeout') || aiExplanationData.aiReason.includes('ai-model-timeout') || aiExplanationData.aiReason.includes('ai-total-timeout'))}
										⏱️ Timeout Fallback
									{:else}
										📊 Fallback
									{/if}
								</span>
							{:else if aiExplanationData.aiStatus === 'ok'}
								<span class="ai-status-badge" style="font-size: 0.75rem; color: #4caf50; margin-left: 0.5rem; padding: 0.2rem 0.5rem; background: #e8f5e9; border-radius: 12px;">✅ Validated</span>
							{:else if aiExplanationData.aiStatus === 'timeout'}
								<span class="ai-status-badge" style="font-size: 0.75rem; color: #ff5722; margin-left: 0.5rem; padding: 0.2rem 0.5rem; background: #ffe0b2; border-radius: 12px;" title="Client-side timeout">⏱️ Client Timeout</span>
							{/if}
						</h3>
						<div class="ai-explanation-content">
							{@html aiExplanationData.explanation.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>').replace(/•/g, '&bull;')}
						</div>
						{#if aiExplanationData.technicalContext}
							<div class="ai-technical-context" style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--border-color); font-size: 0.85rem; color: var(--text-secondary);">
								<strong>Technical Context:</strong> Price: ${aiExplanationData.technicalContext.currentPrice?.toFixed(2)}, 
								RSI: {aiExplanationData.technicalContext.currentRSI?.toFixed(2)}, 
								SMA({aiExplanationData.technicalContext.smaPeriod}): ${aiExplanationData.technicalContext.currentSMA?.toFixed(2)}
							</div>
						{/if}
					</div>
				{/if}
			</div>
		{/if}
	{/if}
</div>

<style>
	.ta-container {
		max-width: 1200px;
		margin: 2rem auto;
		padding: 2rem;
		background: var(--bg-primary);
		border-radius: 12px;
		box-shadow: var(--shadow);
	}

	.ta-header {
		text-align: center;
		margin-bottom: 2rem;
		padding-bottom: 1.5rem;
		border-bottom: 2px solid var(--border-color);
	}

	.header-content {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
		flex-wrap: wrap;
		gap: 1rem;
	}

	.header-content h1 {
		color: var(--accent-color);
		font-size: 2.5rem;
		margin: 0;
		font-weight: 700;
	}

	.back-button {
		background: var(--bg-tertiary);
		color: var(--text-primary);
		border: 1px solid var(--border-color);
		padding: 0.75rem 1.5rem;
		border-radius: 8px;
		cursor: pointer;
		font-size: 1rem;
		font-weight: 600;
		transition: all 0.3s ease;
	}

	.back-button:hover {
		background: var(--accent-color);
		color: white;
		transform: translateY(-1px);
	}

	.subtitle {
		color: var(--text-secondary);
		font-size: 1.2rem;
		margin: 0;
	}

	.controls {
		display: flex;
		gap: 1.5rem;
		margin-bottom: 2rem;
		align-items: center;
		flex-wrap: wrap;
		padding: 1.5rem;
		background: var(--bg-secondary);
		border-radius: 8px;
		border: 1px solid var(--border-color);
	}

	.control-group {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.control-group label {
		font-weight: 600;
		color: var(--text-primary);
		font-size: 0.9rem;
	}

	.control-group select {
		padding: 0.75rem;
		border: 1px solid var(--border-color);
		border-radius: 6px;
		background: var(--bg-primary);
		color: var(--text-primary);
		font-size: 1rem;
		min-width: 150px;
	}

	.button-group {
		display: flex;
		gap: 1rem;
		margin-left: auto;
	}

	.button-group button {
		background: var(--accent-color);
		color: white;
		border: none;
		padding: 0.75rem 1.5rem;
		border-radius: 6px;
		cursor: pointer;
		font-size: 1rem;
		font-weight: 600;
		transition: all 0.3s ease;
	}

	.button-group button:hover:not(:disabled) {
		background: var(--accent-hover);
		transform: translateY(-1px);
	}

	.button-group button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.loading-section, .error-section {
		text-align: center;
		padding: 2rem;
		margin: 2rem 0;
	}

	.loading {
		font-size: 1.2rem;
		color: var(--text-secondary);
	}

	.error {
		color: var(--danger-color);
		font-size: 1.1rem;
		padding: 1rem;
		background: rgba(220, 53, 69, 0.1);
		border-radius: 6px;
		border: 1px solid var(--danger-color);
	}

	.ta-charts-grid {
		display: grid;
		grid-template-columns: 2fr 1fr;
		gap: 2rem;
		margin-bottom: 2rem;
	}

	.ta-chart-column {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.ta-chart-container {
		background: var(--bg-secondary);
		padding: 1.5rem;
		border-radius: 8px;
		border: 1px solid var(--border-color);
	}

	.ta-chart-container h3 {
		color: var(--text-primary);
		margin: 0 0 1rem 0;
		font-size: 1.3rem;
	}

	.chart-info-box {
		background: var(--bg-tertiary);
		padding: 1rem;
		border-radius: 6px;
		margin-bottom: 1rem;
		font-size: 0.9rem;
		color: var(--text-secondary);
		border-left: 4px solid var(--accent-color);
	}

	.chart-wrapper {
		height: 400px;
		position: relative;
	}

	.indicators-panel {
		background: var(--bg-secondary);
		padding: 1.5rem;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		height: fit-content;
	}

	.indicators-panel h3 {
		color: var(--text-primary);
		margin: 0 0 1.5rem 0;
		font-size: 1.3rem;
	}

	.indicators-list {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.indicator {
		background: var(--bg-tertiary);
		padding: 1rem;
		border-radius: 6px;
		border: 1px solid var(--border-color);
	}

	.indicator h4 {
		color: var(--text-primary);
		margin: 0 0 0.5rem 0;
		font-size: 1.1rem;
	}

	.indicator-value {
		font-size: 1.2rem;
		font-weight: 600;
		color: var(--text-primary);
		margin-bottom: 0.5rem;
	}

	.signal {
		padding: 0.25rem 0.75rem;
		border-radius: 4px;
		font-size: 0.9rem;
		font-weight: 600;
		text-align: center;
		margin-bottom: 0.5rem;
		display: inline-block;
	}

	.signal.buy {
		background: var(--success-color);
		color: white;
	}

	.signal.sell {
		background: var(--danger-color);
		color: white;
	}

	.signal.neutral {
		background: var(--text-secondary);
		color: white;
	}

	.signal-strength {
		font-size: 0.9rem;
		color: var(--text-secondary);
		margin-bottom: 0.5rem;
	}

	.explanation {
		font-size: 0.85rem;
		color: var(--text-secondary);
		line-height: 1.4;
	}

	.patterns-section {
		margin-top: 1rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border-color);
	}

	.patterns-section h4 {
		color: var(--text-primary);
		margin: 0 0 1rem 0;
		font-size: 1.1rem;
	}

	.patterns-scroll-container {
		max-height: 200px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.pattern-entry {
		background: var(--bg-secondary);
		padding: 0.75rem;
		border-radius: 4px;
		border: 1px solid var(--border-color);
	}

	.pattern-entry .signal {
		margin-bottom: 0.25rem;
	}

	.pattern-entry .signal-strength {
		margin-bottom: 0.25rem;
	}

	.pattern-entry .explanation {
		font-size: 0.8rem;
	}

	.educational-notes {
		margin-top: 1.5rem;
		padding-top: 1.5rem;
		border-top: 1px solid var(--border-color);
	}

	.educational-notes h4 {
		color: var(--text-primary);
		margin: 0 0 1rem 0;
		font-size: 1.1rem;
	}

	.educational-content {
		font-size: 0.9rem;
		color: var(--text-secondary);
		line-height: 1.6;
	}

	.educational-content strong {
		color: var(--text-primary);
	}

	.ai-analysis-section {
		margin-bottom: 2rem;
	}

	.ai-analysis-card {
		background: var(--bg-secondary);
		padding: 1.5rem;
		border-radius: 8px;
		border: 1px solid var(--border-color);
	}

	.ai-analysis-card h3 {
		color: var(--text-primary);
		margin: 0 0 1rem 0;
		font-size: 1.3rem;
	}

	.ai-analysis-grid {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 1.5rem;
		align-items: center;
	}

	.ai-mood-display {
		text-align: center;
	}

	.ai-mood-icon {
		font-size: 3rem;
		margin-bottom: 0.5rem;
	}

	.ai-mood-label {
		font-size: 1.2rem;
		font-weight: 700;
		margin-bottom: 0.5rem;
	}

	.ai-mood-label.bullish { color: var(--success-color); }
	.ai-mood-label.bearish { color: var(--danger-color); }
	.ai-mood-label.neutral { color: var(--text-secondary); }

	.ai-confidence {
		font-size: 0.9rem;
		color: var(--text-secondary);
		margin-bottom: 0.25rem;
	}

	.ai-method {
		font-size: 0.8rem;
		color: var(--text-tertiary);
	}

	.ai-reasoning {
		color: var(--text-primary);
		line-height: 1.6;
	}

	.ta-summary {
		background: var(--bg-secondary);
		padding: 1.5rem;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		text-align: center;
		margin-bottom: 2rem;
	}

	.ta-summary h3 {
		color: var(--text-primary);
		margin: 0 0 1rem 0;
		font-size: 1.3rem;
	}

	.overall-signal {
		font-size: 2rem;
		font-weight: 700;
		margin-bottom: 0.5rem;
	}

	.overall-signal.buy { color: var(--success-color); }
	.overall-signal.sell { color: var(--danger-color); }
	.overall-signal.hold { color: var(--text-secondary); }

	.confidence {
		font-size: 1.2rem;
		color: var(--text-primary);
		margin-bottom: 1rem;
	}

	.signal-breakdown {
		font-size: 0.9rem;
		color: var(--text-secondary);
		margin-bottom: 1rem;
	}

	.disclaimer {
		font-size: 0.85rem;
		color: var(--text-tertiary);
		padding: 1rem;
		background: var(--bg-tertiary);
		border-radius: 6px;
		border-left: 4px solid var(--warning-color);
		line-height: 1.5;
	}

	/* AI Analysis Section - Inline & Mobile-Friendly */
	.ai-analysis-section {
		margin-top: 2rem;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.ai-analysis-card {
		background: var(--bg-secondary);
		border-radius: 12px;
		padding: 1.5rem;
		border: 1px solid var(--border-color);
		box-shadow: var(--shadow);
	}

	.ai-analysis-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin: 0 0 1rem 0;
		color: var(--accent-color);
		font-size: 1.4rem;
		font-weight: 700;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.ai-method-badge, .ai-explain-badge {
		background: var(--accent-color);
		color: white;
		padding: 0.3rem 0.8rem;
		border-radius: 15px;
		font-size: 0.8rem;
		font-weight: 600;
		white-space: nowrap;
	}

	.ai-analysis-grid {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 1.5rem;
		align-items: center;
	}

	.ai-mood-display {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 0.5rem;
	}

	.ai-mood-icon {
		font-size: 3rem;
		margin-bottom: 0.5rem;
	}

	.ai-mood-label {
		font-size: 1.2rem;
		font-weight: 700;
		padding: 0.5rem 1rem;
		border-radius: 20px;
		border: 2px solid;
		min-width: 100px;
	}

	.ai-mood-label.bullish {
		color: var(--success-color);
		border-color: var(--success-color);
		background: rgba(16, 185, 129, 0.1);
	}

	.ai-mood-label.bearish {
		color: var(--danger-color);
		border-color: var(--danger-color);
		background: rgba(239, 68, 68, 0.1);
	}

	.ai-mood-label.neutral {
		color: var(--warning-color);
		border-color: var(--warning-color);
		background: rgba(245, 158, 11, 0.1);
	}

	.ai-confidence {
		font-size: 1rem;
		font-weight: 600;
		color: var(--text-secondary);
	}

	.ai-reasoning-container {
		display: flex;
		align-items: center;
	}

	.ai-reasoning {
		font-size: 1.1rem;
		line-height: 1.6;
		color: var(--text-primary);
		padding: 1rem;
		background: var(--bg-primary);
		border-radius: 8px;
		border-left: 4px solid var(--accent-color);
	}

	.ai-explanation-card {
		background: var(--bg-secondary);
		border-radius: 12px;
		padding: 1.5rem;
		border: 1px solid var(--border-color);
		box-shadow: var(--shadow);
	}

	.ai-explanation-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin: 0 0 1rem 0;
		color: var(--accent-color);
		font-size: 1.3rem;
		font-weight: 700;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.ai-explanation-content {
		line-height: 1.7;
		font-size: 1rem;
		color: var(--text-primary);
		max-height: none;
		overflow: visible;
	}

	@media (max-width: 1024px) {
		.ta-charts-grid {
			grid-template-columns: 1fr;
		}
		
		.header-content {
			flex-direction: column;
			text-align: center;
		}
		
		.controls {
			flex-direction: column;
			align-items: stretch;
		}
		
		.button-group {
			margin-left: 0;
			justify-content: center;
		}
		
		.ai-analysis-grid {
			grid-template-columns: 1fr;
			text-align: center;
		}
	}

	@keyframes spin {
		0% { transform: rotate(0deg); }
		100% { transform: rotate(360deg); }
	}

	@keyframes fadeIn {
		0% { opacity: 0; transform: translateY(10px); }
		100% { opacity: 1; transform: translateY(0); }
	}

	.loading-spinner {
		width: 20px;
		height: 20px;
		border: 2px solid var(--border-color);
		border-top: 2px solid var(--accent-color);
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}

	@media (max-width: 768px) {
		.ta-container {
			margin: 1rem;
			padding: 1rem;
		}
		
		.header-content h1 {
			font-size: 2rem;
		}
		
		.chart-wrapper {
			height: 300px;
		}
		
		/* Mobile-friendly AI Analysis Section */
		.ai-analysis-grid {
			grid-template-columns: 1fr;
			gap: 1rem;
			text-align: center;
		}
		
		.ai-analysis-header, .ai-explanation-header {
			flex-direction: column;
			text-align: center;
			gap: 1rem;
		}
		
		.ai-mood-icon {
			font-size: 2.5rem;
		}
		
		.ai-mood-label {
			font-size: 1rem;
			padding: 0.4rem 0.8rem;
		}
		
		.ai-reasoning {
			font-size: 1rem;
			padding: 0.8rem;
		}
		
		.ai-explanation-content {
			font-size: 0.95rem;
		}
		
		.ai-method-badge, .ai-explain-badge {
			font-size: 0.75rem;
			padding: 0.25rem 0.6rem;
		}
		
		.ai-analysis-section {
			margin-top: 1.5rem;
			gap: 1rem;
		}
		
		.ai-analysis-card, .ai-explanation-card {
			padding: 1rem;
		}
		
		.indicator {
			animation: fadeIn 0.3s ease-out;
		}
	}

	/* Accessibility improvements */
	@media (prefers-reduced-motion: reduce) {
		.loading-spinner {
			animation: none !important;
		}
		* {
			animation-duration: 0.01ms !important;
			animation-iteration-count: 1 !important;
			transition-duration: 0.01ms !important;
		}
	}
</style> 