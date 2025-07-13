import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cryptoStore } from '../src/lib/stores.js';
import { WORKER_URL } from '../src/lib/config.js';

// Mock fetch
global.fetch = vi.fn();

describe('cryptoStore', () => {
    beforeEach(() => {
        fetch.mockClear();
    });

    it('should initialize with default values', () => {
        let storeValue;
        const unsubscribe = cryptoStore.subscribe(value => {
            storeValue = value;
        });
        expect(storeValue.loading).toBe(true);
        expect(storeValue.selectedCoin).toBe('bitcoin');
        unsubscribe();
    });

    it('should fetch coins and initial data on initStore', async () => {
        const mockCoins = [{ id: 'bitcoin', name: 'Bitcoin', symbol: 'BTC' }];
        const mockPrice = { price: 50000, change24h: 5, symbol: 'BTC' };
        const mockHistory = [{ x: new Date(), y: 50000 }];
        const mockNews = { headlines: ['news1'] };
        const mockSentiment = { score: 1, category: 'bullish' };

        fetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockCoins) });
        fetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockPrice) });
        fetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ prices: mockHistory.map(h => ({ timestamp: h.x.getTime(), price: h.y })) }) });
        fetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockNews) });
        fetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockSentiment) });

        await cryptoStore.initStore();

        let storeValue;
        const unsubscribe = cryptoStore.subscribe(value => {
            storeValue = value;
        });

        expect(storeValue.loading).toBe(false);
        expect(storeValue.coins).toEqual(mockCoins);
        expect(storeValue.priceData).toEqual(mockPrice);
        expect(storeValue.historyData).toEqual(mockHistory);
        expect(storeValue.newsData.headlines).toEqual(mockNews.headlines);
        expect(storeValue.newsData.sentiment).toEqual(mockSentiment);
        unsubscribe();
    });

    it('should set a new coin and fetch its data', async () => {
        const mockPrice = { price: 2000, change24h: -2, symbol: 'ETH' };
        const mockHistory = [{ x: new Date(), y: 2000 }];
        const mockNews = { headlines: ['news2'] };
        const mockSentiment = { score: -1, category: 'bearish' };

        fetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockPrice) });
        fetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ prices: mockHistory.map(h => ({ timestamp: h.x.getTime(), price: h.y })) }) });
        fetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockNews) });
        fetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockSentiment) });

        await cryptoStore.setCoin('ethereum');

        let storeValue;
        const unsubscribe = cryptoStore.subscribe(value => {
            storeValue = value;
        });

        expect(storeValue.loading).toBe(false);
        expect(storeValue.selectedCoin).toBe('ethereum');
        expect(storeValue.priceData).toEqual(mockPrice);
        expect(storeValue.historyData).toEqual(mockHistory);
        expect(storeValue.newsData.headlines).toEqual(mockNews.headlines);
        expect(storeValue.newsData.sentiment).toEqual(mockSentiment);
        unsubscribe();
    });
});
