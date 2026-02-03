/**
 * @file utils/algoCore/tradeSignalLogic.js
 * @description Scans forward in time to find the first trade signals and the next-day entry points.
 */

export function findFutureSignals(bars, fractalHigh, fractalLow) {
  let longSignal = null;
  let shortSignal = null;

  if (!bars || bars.length < 2) {
    return { longSignal, shortSignal };
  }

  // Iterate up to the second-to-last bar to ensure we always have a "next day" for entry.
  for (let i = 0; i < bars.length - 1; i++) {
    const triggerBar = bars[i];
    const entryBar = bars[i + 1];

    // --- Check for a LONG Signal ---
    if (
      !longSignal &&
      fractalHigh &&
      triggerBar.date.getTime() > fractalHigh.date.getTime() &&
      triggerBar.close > fractalHigh.high
    ) {
      longSignal = {
        triggerDate: triggerBar.date,
        entryDate: entryBar.date,
        entryPrice: entryBar.open,
        reason: `Closed above fractal high of ${fractalHigh.high.toFixed(2)}`,
      };
    }

    // --- REVISED: Check for a SHORT Signal ---
    // The logic is now confirmed to match your requirement: a close below the low pivot.
    if (
      !shortSignal &&
      fractalLow &&
      triggerBar.date.getTime() > fractalLow.date.getTime() &&
      triggerBar.close < fractalLow.low
    ) {
      shortSignal = {
        triggerDate: triggerBar.date,
        entryDate: entryBar.date,
        entryPrice: entryBar.open,
        reason: `Closed below fractal low of ${fractalLow.low.toFixed(2)}`,
      };
    }

    if (longSignal && shortSignal) {
      break;
    }
  }

  return { longSignal, shortSignal };
}
