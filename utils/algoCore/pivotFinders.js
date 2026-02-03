/**
 * @file utils/algoCore/pivotFinders.js
 * @description Contains different strategies for finding pivot points in historical data.
 */

/**
 * Finds the most relevant high and low pivots within a given window of bars.
 * This function is unbiased and finds the most recent fractals.
 */
export function findInitialPivots(bars) {
  if (!bars || bars.length < 3) {
    return { pivotHigh: null, pivotLow: null };
  }

  let pivotHigh5Bar = null;
  let pivotLow5Bar = null;
  let pivotHigh3Bar = null;
  let pivotLow3Bar = null;

  if (bars.length >= 5) {
    for (let i = bars.length - 3; i >= 2; i--) {
      const middle = bars[i];
      if (!pivotHigh5Bar) {
        if (
          middle.high > bars[i - 1].high &&
          middle.high > bars[i - 2].high &&
          middle.high > bars[i + 1].high &&
          middle.high > bars[i + 2].high
        ) {
          pivotHigh5Bar = { date: middle.date, high: middle.high };
        }
      }
      if (!pivotLow5Bar) {
        if (
          middle.low < bars[i - 1].low &&
          middle.low < bars[i - 2].low &&
          middle.low < bars[i + 1].low &&
          middle.low < bars[i + 2].low
        ) {
          pivotLow5Bar = { date: middle.date, low: middle.low };
        }
      }
      if (pivotHigh5Bar && pivotLow5Bar) break;
    }
  }

  for (let i = bars.length - 2; i >= 1; i--) {
    const middle = bars[i];
    if (!pivotHigh5Bar && !pivotHigh3Bar) {
      if (middle.high > bars[i - 1].high && middle.high > bars[i + 1].high) {
        pivotHigh3Bar = { date: middle.date, high: middle.high };
      }
    }
    if (!pivotLow5Bar && !pivotLow3Bar) {
      if (middle.low < bars[i - 1].low && middle.low < bars[i + 1].low) {
        pivotLow3Bar = { date: middle.date, low: middle.low };
      }
    }
    if ((pivotHigh5Bar || pivotHigh3Bar) && (pivotLow5Bar || pivotLow3Bar))
      break;
  }

  const initialPivotHigh = pivotHigh5Bar || pivotHigh3Bar;
  const initialPivotLow = pivotLow5Bar || pivotLow3Bar;

  let finalPivotHigh = initialPivotHigh;
  let finalPivotLow = initialPivotLow;

  if (initialPivotHigh) {
    const startIndex = bars.findIndex(
      (d) => d.date.getTime() === initialPivotHigh.date.getTime()
    );
    if (startIndex !== -1) {
      const correctionWindow = bars.slice(startIndex);
      let maxHighInWindow = initialPivotHigh.high;
      let correctedHighBar = bars[startIndex];
      for (const bar of correctionWindow) {
        if (bar.high > maxHighInWindow) {
          maxHighInWindow = bar.high;
          correctedHighBar = bar;
        }
      }
      finalPivotHigh = {
        date: correctedHighBar.date,
        high: maxHighInWindow,
      };
    }
  }

  if (initialPivotLow) {
    const startIndex = bars.findIndex(
      (d) => d.date.getTime() === initialPivotLow.date.getTime()
    );
    if (startIndex !== -1) {
      const correctionWindow = bars.slice(startIndex);
      let minLowInWindow = initialPivotLow.low;
      let correctedLowBar = bars[startIndex];
      for (const bar of correctionWindow) {
        if (bar.low < minLowInWindow) {
          minLowInWindow = bar.low;
          correctedLowBar = bar;
        }
      }
      finalPivotLow = {
        date: correctedLowBar.date,
        low: minLowInWindow,
      };
    }
  }

  return {
    pivotHigh: finalPivotHigh,
    pivotLow: finalPivotLow,
  };
}

/**
 * Finds the most recent pivot (high for short, low for long) in the history
 * preceding a specific trigger bar.
 */
export function findExitProjectionPivot(historicalBars, signalType) {
  if (!historicalBars || historicalBars.length < 3) {
    return null;
  }
  for (let i = historicalBars.length - 2; i >= 1; i--) {
    const middle = historicalBars[i];
    const prev = historicalBars[i - 1];
    const next = historicalBars[i + 1];
    if (signalType === "LONG") {
      if (middle.low < prev.low && middle.low < next.low) {
        return { date: middle.date, low: middle.low };
      }
    } else {
      if (middle.high > prev.high && middle.high > next.high) {
        return { date: middle.date, high: middle.high };
      }
    }
  }
  return null;
}

/**
 * Calculates a price-to-bar ratio based on the slope between recent major pivots.
 * This is the function that was accidentally deleted and is now restored.
 */
export function calculateTrendStructureRatio(
  bars,
  numPivots = 4,
  pivotLookaround = 10
) {
  if (bars.length < pivotLookaround * 2 + 1) {
    return null;
  }

  const pivots = [];
  for (let i = pivotLookaround; i < bars.length - pivotLookaround; i++) {
    const window = bars.slice(i - pivotLookaround, i + pivotLookaround + 1);
    const currentBar = bars[i];
    const maxHigh = Math.max(...window.map((b) => b.high));
    const minLow = Math.min(...window.map((b) => b.low));
    let isPivot = false;
    if (currentBar.high === maxHigh) {
      pivots.push({ index: i, price: currentBar.high, type: "High" });
      isPivot = true;
    } else if (currentBar.low === minLow) {
      pivots.push({ index: i, price: currentBar.low, type: "Low" });
      isPivot = true;
    }
    if (isPivot) {
      i += pivotLookaround;
    }
  }

  if (pivots.length < 2) {
    return null;
  }

  const recentPivots = pivots.slice(-numPivots);
  const slopes = [];

  for (let i = 1; i < recentPivots.length; i++) {
    const p2 = recentPivots[i];
    const p1 = recentPivots[i - 1];
    const deltaP = Math.abs(p2.price - p1.price);
    const deltaT = p2.index - p1.index;
    if (deltaT > 0) {
      slopes.push(deltaP / deltaT);
    }
  }

  if (slopes.length === 0) {
    return null;
  }

  const averageSlope =
    slopes.reduce((acc, val) => acc + val, 0) / slopes.length;
  return averageSlope;
}
