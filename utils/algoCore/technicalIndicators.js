/**
 * @file utils/algoCore/technicalIndicators.js
 * @description Contains functions for calculating common technical indicators.
 */

/**
 * Calculates the Average True Range (ATR) for a given set of bars.
 * ATR is a measure of volatility.
 *
 * @param {Array} bars - An array of bar data. Must be in chronological order.
 * @param {number} period - The lookback period for the ATR calculation (e.g., 14, 50).
 * @returns {number | null} The ATR value for the most recent bar, or null if there isn't enough data.
 */
export function calculateATR(bars, period) {
  if (!bars || bars.length < period + 1) {
    return null; // Not enough data for the calculation
  }

  const trueRanges = [];
  // Start from the second bar since we need the previous close for the first calculation
  for (let i = 1; i < bars.length; i++) {
    const currentBar = bars[i];
    const prevBar = bars[i - 1];

    const highMinusLow = currentBar.high - currentBar.low;
    const highMinusPrevClose = Math.abs(currentBar.high - prevBar.close);
    const lowMinusPrevClose = Math.abs(currentBar.low - prevBar.close);

    const trueRange = Math.max(
      highMinusLow,
      highMinusPrevClose,
      lowMinusPrevClose
    );
    trueRanges.push(trueRange);
  }

  // We only need the ATR for the most recent period.
  // Get the last `period` number of true ranges to average.
  const relevantTRs = trueRanges.slice(-period);
  if (relevantTRs.length < period) {
    return null; // Should not happen with the initial check, but as a safeguard.
  }

  // Calculate the simple average of the last 'period' true ranges.
  const sumOfTRs = relevantTRs.reduce((acc, val) => acc + val, 0);
  const atr = sumOfTRs / period;

  return atr;
}
