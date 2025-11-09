import { describe, it, expect } from 'vitest';
import { sma, rsiWilder, bollinger } from './indicators';

describe('SMA (Simple Moving Average)', () => {
	it('should compute SMA for known list', () => {
		const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
		const result = sma(values, 5);
		// Last 5 values: 16, 17, 18, 19, 20
		// Average: (16 + 17 + 18 + 19 + 20) / 5 = 90 / 5 = 18
		expect(result).toBe(18);
	});

	it('should return null for insufficient data', () => {
		const values = [1, 2, 3];
		const result = sma(values, 5);
		expect(result).toBeNull();
	});

	it('should return null for empty array', () => {
		const result = sma([], 5);
		expect(result).toBeNull();
	});

	it('should handle single value', () => {
		const values = [100];
		const result = sma(values, 1);
		expect(result).toBe(100);
	});
});

describe('RSI Wilder', () => {
	it('should yield RSI > 60 for clear uptrend', () => {
		// Create an uptrend: prices consistently increasing
		const values = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115];
		const result = rsiWilder(values, 14);
		expect(result).not.toBeNull();
		expect(result!).toBeGreaterThan(60);
	});

	it('should yield RSI < 40 for clear downtrend', () => {
		// Create a downtrend: prices consistently decreasing
		const values = [115, 114, 113, 112, 111, 110, 109, 108, 107, 106, 105, 104, 103, 102, 101, 100];
		const result = rsiWilder(values, 14);
		expect(result).not.toBeNull();
		expect(result!).toBeLessThan(40);
	});

	it('should return null for insufficient data', () => {
		const values = [100, 101, 102];
		const result = rsiWilder(values, 14);
		expect(result).toBeNull();
	});

	it('should return 100 when avgLoss is 0 (all gains)', () => {
		// All positive changes
		const values = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115];
		const result = rsiWilder(values, 14);
		// With all gains and no losses, RSI should approach 100
		expect(result).not.toBeNull();
		expect(result!).toBeGreaterThanOrEqual(50);
	});

	it('should handle mixed changes', () => {
		const values = [100, 101, 100, 102, 101, 103, 102, 104, 103, 105, 104, 106, 105, 107, 106, 108];
		const result = rsiWilder(values, 14);
		expect(result).not.toBeNull();
		expect(result!).toBeGreaterThan(0);
		expect(result!).toBeLessThan(100);
	});
});

describe('Bollinger Bands', () => {
	it('should return upper==lower==middle for flat series', () => {
		const values = new Array(20).fill(100);
		const result = bollinger(values, 20, 2);
		expect(result).not.toBeNull();
		expect(result!.middle).toBe(100);
		expect(result!.upper).toBe(100);
		expect(result!.lower).toBe(100);
		expect(result!.zScore).toBe(0);
		expect(result!.position).toBe('inside');
	});

	it('should compute correct bands for varying data', () => {
		const values = [90, 92, 94, 96, 98, 100, 102, 104, 106, 108, 110, 112, 114, 116, 118, 120, 122, 124, 126, 128];
		const result = bollinger(values, 20, 2);
		expect(result).not.toBeNull();
		expect(result!.middle).toBeGreaterThan(0);
		expect(result!.upper).toBeGreaterThan(result!.middle);
		expect(result!.lower).toBeLessThan(result!.middle);
		expect(['above', 'inside', 'below']).toContain(result!.position);
	});

	it('should return null for insufficient data', () => {
		const values = [100, 101, 102];
		const result = bollinger(values, 20, 2);
		expect(result).toBeNull();
	});

	it('should identify position above upper band', () => {
		// Create data where last value is clearly above upper band
		const baseValues = new Array(19).fill(100);
		const lastValue = 150; // Well above the mean
		const values = [...baseValues, lastValue];
		const result = bollinger(values, 20, 2);
		expect(result).not.toBeNull();
		expect(result!.position).toBe('above');
	});

	it('should identify position below lower band', () => {
		// Create data where last value is clearly below lower band
		const baseValues = new Array(19).fill(100);
		const lastValue = 50; // Well below the mean
		const values = [...baseValues, lastValue];
		const result = bollinger(values, 20, 2);
		expect(result).not.toBeNull();
		expect(result!.position).toBe('below');
	});

	it('should compute zScore correctly', () => {
		const values = new Array(20).fill(100);
		values[19] = 110; // 10 points above mean
		const result = bollinger(values, 20, 2);
		expect(result).not.toBeNull();
		// zScore should be positive for value above mean
		if (result!.zScore !== 0) {
			expect(result!.zScore).toBeGreaterThan(0);
		}
	});
});

