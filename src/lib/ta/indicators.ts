/**
 * Technical Analysis Indicators
 * Pure functions for computing technical indicators from price data
 */

/**
 * Simple Moving Average (SMA)
 * @param values - Array of close prices (newest last)
 * @param period - Number of periods to average
 * @returns SMA value or null if insufficient data
 */
export function sma(values: number[], period: number): number | null {
  if (!Array.isArray(values) || values.length < period) return null;
  const start = values.length - period;
  let sum = 0;
  for (let i = start; i < values.length; i++) sum += values[i];
  return sum / period;
}

/**
 * Relative Strength Index (RSI) using Wilder's smoothing method
 * @param values - Array of close prices (newest last)
 * @param period - RSI period (default 14)
 * @returns RSI value (0-100) or null if insufficient data
 */
export function rsiWilder(values: number[], period = 14): number | null {
  if (!Array.isArray(values) || values.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gains += change; else losses -= change;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

/**
 * Bollinger Bands
 * @param values - Array of close prices (newest last)
 * @param period - Moving average period (default 20)
 * @param k - Standard deviation multiplier (default 2)
 * @returns Bollinger Bands data or null if insufficient data
 */
export function bollinger(
  values: number[],
  period = 20,
  k = 2
): {
  middle: number;
  upper: number;
  lower: number;
  zScore: number;
  position: 'above' | 'inside' | 'below';
} | null {
  if (!Array.isArray(values) || values.length < period) return null;
  const m = sma(values, period);
  if (m === null) return null;
  const start = values.length - period;
  let variance = 0;
  for (let i = start; i < values.length; i++) {
    const d = values[i] - m;
    variance += d * d;
  }
  const std = Math.sqrt(variance / period);
  const upper = m + k * std;
  const lower = m - k * std;
  const last = values[values.length - 1];
  const zScore = std === 0 ? 0 : (last - m) / std;
  const position = last > upper ? 'above' : (last < lower ? 'below' : 'inside');
  return { middle: m, upper, lower, zScore, position };
}

