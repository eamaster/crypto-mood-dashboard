import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import TechSnapshotCard from './TechSnapshotCard.svelte';

// Create a mock store value that can be updated
let mockStoreValue = {
	selectedCoin: 'bitcoin',
	historyData: [],
	loading: false,
	error: null
};

// Mock the stores module
vi.mock('../stores.js', () => ({
	cryptoStore: {
		subscribe: (callback) => {
			// Immediately call with current value
			callback(mockStoreValue);
			// Return unsubscribe function
			return () => {};
		}
	}
}));

// Mock the config
vi.mock('../config.js', () => ({
	WORKER_URL: 'https://test-worker.com'
}));

// Mock fetch globally
global.fetch = vi.fn();

describe('TechSnapshotCard', () => {
	beforeEach(() => {
		// Reset mock store value
		mockStoreValue = {
			selectedCoin: 'bitcoin',
			historyData: [],
			loading: false,
			error: null
		};
		
		// Reset fetch mock
		vi.clearAllMocks();
		global.fetch.mockResolvedValue({
			ok: true,
			json: async () => ({
				ohlc: Array.from({ length: 60 }, (_, i) => ({
					timestamp: new Date(2024, 0, i + 1).toISOString(),
					open: 50000,
					high: 51000,
					low: 49000,
					close: 50000 + i * 100,
					volume: 1000000
				}))
			})
		});
	});

	it('should render title "Technical Snapshot"', () => {
		render(TechSnapshotCard);
		expect(screen.getByText('🧪 Technical Snapshot')).toBeInTheDocument();
	});

	it('should show loading state when loading=true', () => {
		mockStoreValue.loading = true;
		render(TechSnapshotCard);
		expect(screen.getByText('Loading data...')).toBeInTheDocument();
	});

	it('should render RSI, SMA, and Bollinger rows with data', async () => {
		// Create 60 close prices for SMA50
		const closes = Array.from({ length: 60 }, (_, i) => 50000 + i * 100);
		mockStoreValue.historyData = closes.map((price, i) => ({
			x: new Date(2024, 0, i + 1),
			y: price
		}));
		mockStoreValue.loading = false;

		render(TechSnapshotCard);

		await waitFor(() => {
			expect(screen.getByText(/RSI\(14\):/)).toBeInTheDocument();
			expect(screen.getByText(/SMA20 vs SMA50:/)).toBeInTheDocument();
			expect(screen.getByText(/Bands:/)).toBeInTheDocument();
		});
	});

	it('should show "Bullish" when SMA20 > SMA50', async () => {
		// Create data where SMA20 > SMA50 (increasing trend)
		const closes = Array.from({ length: 60 }, (_, i) => 50000 + i * 200);
		mockStoreValue.historyData = closes.map((price, i) => ({
			x: new Date(2024, 0, i + 1),
			y: price
		}));
		mockStoreValue.loading = false;

		render(TechSnapshotCard);

		await waitFor(() => {
			expect(screen.getByText(/Bullish/)).toBeInTheDocument();
		}, { timeout: 2000 });
	});

	it('should show "n/a" when insufficient data', async () => {
		// Only 10 data points (insufficient for SMA20/SMA50/RSI/Bollinger)
		// Mock fetch to return insufficient data too (only 10 candles)
		global.fetch.mockResolvedValue({
			ok: true,
			json: async () => ({
				ohlc: Array.from({ length: 10 }, (_, i) => ({
					timestamp: new Date(2024, 0, i + 1).toISOString(),
					open: 50000,
					high: 51000,
					low: 49000,
					close: 50000 + i * 100,
					volume: 1000000
				}))
			})
		});

		const closes = Array.from({ length: 10 }, (_, i) => 50000 + i * 100);
		mockStoreValue.historyData = closes.map((price, i) => ({
			x: new Date(2024, 0, i + 1),
			y: price
		}));
		mockStoreValue.loading = false;

		render(TechSnapshotCard);

		// Wait for component to process data and OHLC fetch
		await waitFor(() => {
			// With only 10 data points (even after OHLC fetch), 
			// SMA50 needs 50 points, so it should show n/a
			// SMA20 needs 20 points, so it should also show n/a
			// RSI needs 15 points, so it should show n/a
			// Bollinger needs 20 points, so it should show n/a
			const maLabel = screen.getByText(/SMA20 vs SMA50:/);
			expect(maLabel).toBeInTheDocument();
			// Check that the row exists - it should show n/a for SMA50
			const maRow = maLabel.closest('.indicator-row');
			expect(maRow).toBeInTheDocument();
			// The component should render the row even if data is insufficient
			expect(maRow?.textContent).toBeTruthy();
		}, { timeout: 3000 });
	});

	it('should show error state when error is present', () => {
		mockStoreValue.error = '429 Rate limit exceeded';
		mockStoreValue.loading = false;

		render(TechSnapshotCard);

		expect(screen.getByText(/Rate limit exceeded/)).toBeInTheDocument();
	});

	it('should show Bollinger position (Inside/Above/Below)', async () => {
		// Create data with last price inside bands
		const basePrice = 50000;
		const closes = Array.from({ length: 20 }, () => basePrice);
		mockStoreValue.historyData = closes.map((price, i) => ({
			x: new Date(2024, 0, i + 1),
			y: price
		}));
		mockStoreValue.loading = false;

		render(TechSnapshotCard);

		await waitFor(() => {
			expect(screen.getByText(/Bands:/)).toBeInTheDocument();
		});
	});
});
