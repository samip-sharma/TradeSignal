/**
 * @file utils/algoCore/backtester.js
 * @description Core logic for simulating trades and generating performance reports with advanced portfolio management.
 */

// Helper function to simulate the outcome of a single trade without logging it.
function getGhostTradeOutcome(signalData, historicalData) {
  const { tradeSignal, isLong, pivotHigh, pivotLow } = signalData;
  const stopLoss = isLong ? pivotLow?.low : pivotHigh?.high;
  const projectedExit = tradeSignal.projectedExit;

  if (!stopLoss || !projectedExit) return null;

  const startIndex = historicalData.findIndex(
    (d) => d.date.getTime() === tradeSignal.entryDate.getTime()
  );
  if (startIndex === -1) return null;

  let tradeResult = null;
  const tradeWindow = historicalData.slice(startIndex);
  for (const bar of tradeWindow) {
    if (isLong) {
      if (bar.low <= stopLoss) {
        tradeResult = { exitPrice: stopLoss };
        break;
      }
      if (bar.high >= projectedExit) {
        tradeResult = { exitPrice: projectedExit };
        break;
      }
    } else {
      if (bar.high >= stopLoss) {
        tradeResult = { exitPrice: stopLoss };
        break;
      }
      if (bar.low <= projectedExit) {
        tradeResult = { exitPrice: projectedExit };
        break;
      }
    }
  }

  if (!tradeResult) return null;

  const profit = isLong
    ? tradeResult.exitPrice - tradeSignal.entryPrice
    : tradeSignal.entryPrice - tradeResult.exitPrice;

  return profit > 0 ? "win" : "loss";
}

/**
 * Groups all potential trade signals by their exact entry bar timestamp.
 * This allows the backtester to efficiently look up signals for the current bar it's processing.
 * @param {Array} signals - The raw list of generated signals.
 * @returns {Object} An object where keys are timestamps and values are arrays of signals for that bar.
 */
function groupSignalsByEntryBar(signals) {
  const signalsByTimestamp = {};
  const allPotentialTrades = signals
    .map((signalData) => {
      if (signalData.longSignal)
        return {
          ...signalData,
          tradeSignal: signalData.longSignal,
          isLong: true,
        };
      if (signalData.shortSignal)
        return {
          ...signalData,
          tradeSignal: signalData.shortSignal,
          isLong: false,
        };
      return null;
    })
    .filter((trade) => trade && trade.tradeSignal.entryDate)
    .sort(
      (a, b) =>
        new Date(a.tradeSignal.entryDate) - new Date(b.tradeSignal.entryDate)
    );

  for (const trade of allPotentialTrades) {
    // Use the exact time in milliseconds as the key for precise grouping on all timeframes
    const entryTimestamp = new Date(trade.tradeSignal.entryDate).getTime();
    if (!signalsByTimestamp[entryTimestamp]) {
      signalsByTimestamp[entryTimestamp] = [];
    }
    signalsByTimestamp[entryTimestamp].push(trade);
  }
  return signalsByTimestamp;
}

export function runBacktest(
  signals,
  historicalData,
  initialCapital = 1000,
  preventOnLosses = false,
  liquidateGroupOnLoss = false,
  allowSingleTradePerBar = false,
  positionSize = 0.1 // Default to 10%
) {
  const tradeLog = [];
  let currentCapital = initialCapital;
  let consecutiveLosses = 0;
  let isObserving = false;

  const POSITION_SIZE = positionSize;
  const MAX_OPEN_POSITIONS = Math.floor(1 / POSITION_SIZE); // Dynamic max positions

  let openPositions = [];
  const signalsByEntryBar = groupSignalsByEntryBar(signals);

  // Iterate through each bar of historical data (could be a day, hour, minute, etc.)
  for (const bar of historicalData) {
    const originsToLiquidate = new Map();

    // --- Logic for closing open positions ---
    if (liquidateGroupOnLoss) {
      for (const position of openPositions) {
        if (originsToLiquidate.has(position.startPointName)) continue;
        if (position.isLong && bar.low <= position.stopLoss) {
          originsToLiquidate.set(position.startPointName, position.stopLoss);
        } else if (!position.isLong && bar.high >= position.stopLoss) {
          originsToLiquidate.set(position.startPointName, position.stopLoss);
        }
      }
    }

    const remainingPositions = [];
    for (const position of openPositions) {
      let tradeResult = null;
      const liquidationPrice = originsToLiquidate.get(position.startPointName);

      if (liquidationPrice) {
        tradeResult = {
          exitPrice: liquidationPrice,
          exitReason: "Group Liquidation",
        };
      } else {
        if (position.isLong) {
          if (bar.low <= position.stopLoss)
            tradeResult = {
              exitPrice: position.stopLoss,
              exitReason: "Stop Loss Hit",
            };
          else if (bar.high >= position.takeProfit)
            tradeResult = {
              exitPrice: position.takeProfit,
              exitReason: "Take Profit Hit",
            };
        } else {
          if (bar.high >= position.stopLoss)
            tradeResult = {
              exitPrice: position.stopLoss,
              exitReason: "Stop Loss Hit",
            };
          else if (bar.low <= position.takeProfit)
            tradeResult = {
              exitPrice: position.takeProfit,
              exitReason: "Take Profit Hit",
            };
        }
      }

      if (tradeResult) {
        const shares = position.capitalAllocated / position.entryPrice;
        const profit = position.isLong
          ? (tradeResult.exitPrice - position.entryPrice) * shares
          : (position.entryPrice - tradeResult.exitPrice) * shares;

        currentCapital += profit;
        const profitPct = (profit / position.capitalAllocated) * 100;

        if (profit < 0) {
          consecutiveLosses++;
        } else {
          consecutiveLosses = 0;
        }
        if (preventOnLosses && consecutiveLosses >= 2) isObserving = true;

        tradeLog.push({
          ...position.originalSignal,
          ...tradeResult,
          exitDate: bar.date,
          profit,
          profitPct,
        });
      } else {
        remainingPositions.push(position);
      }
    }
    openPositions = remainingPositions;

    // --- Logic for entering new positions ---
    const currentBarTimestamp = bar.date.getTime();
    const signalsForThisBar = signalsByEntryBar[currentBarTimestamp] || [];

    let signalsToProcess = signalsForThisBar;
    if (allowSingleTradePerBar && signalsForThisBar.length > 0) {
      signalsToProcess = signalsForThisBar.slice(0, 1);
    }

    if (signalsToProcess.length > 0) {
      for (const signalData of signalsToProcess) {
        if (openPositions.length >= MAX_OPEN_POSITIONS) break;

        if (preventOnLosses && isObserving) {
          const outcome = getGhostTradeOutcome(signalData, historicalData);
          if (outcome === "win") {
            isObserving = false;
            consecutiveLosses = 0;
          }
          continue;
        }

        const {
          tradeSignal,
          isLong,
          pivotHigh,
          pivotLow,
          startPointName,
          startDateUTC,
          lookbackEndDate,
          lookbackPeriod,
        } = signalData;
        const stopLoss = isLong ? pivotLow?.low : pivotHigh?.high;
        const projectedExit = tradeSignal.projectedExit;
        if (!stopLoss || !projectedExit) continue;

        const capitalForThisTrade = currentCapital * POSITION_SIZE;

        // Create the new position object
        const newPosition = {
          entryDate: tradeSignal.entryDate,
          entryPrice: tradeSignal.entryPrice,
          isLong: isLong,
          stopLoss: stopLoss,
          takeProfit: projectedExit,
          capitalAllocated: capitalForThisTrade,
          startPointName: startPointName,
          originalSignal: {
            type: isLong ? "Long" : "Short",
            entryDate: tradeSignal.entryDate,
            entryPrice: tradeSignal.entryPrice,
            ingressDate: startDateUTC,
            lookbackEndDate,
            lookbackPeriod: lookbackPeriod,
            entryPivotHigh: pivotHigh,
            entryPivotLow: pivotLow,
            exitPivot: tradeSignal.exitPivot || null,
            projectedExit: projectedExit,
          },
        };

        // --- NEW: Check for Same-Day Exits ---
        // We must check if the price hit SL or TP on the very same day we entered.
        // Since we enter at the Open, we check the same bar's High and Low.
        let sameDayResult = null;
        if (isLong) {
            // Conservative assumption: If Low hit SL, assume it happened before High hit TP.
            if (bar.low <= stopLoss) {
                sameDayResult = { exitPrice: stopLoss, exitReason: "Stop Loss Hit (Same Day)" };
            } else if (bar.high >= projectedExit) {
                sameDayResult = { exitPrice: projectedExit, exitReason: "Take Profit Hit (Same Day)" };
            }
        } else {
            // Short: If High hit SL, assume it happened before Low hit TP.
            if (bar.high >= stopLoss) {
                sameDayResult = { exitPrice: stopLoss, exitReason: "Stop Loss Hit (Same Day)" };
            } else if (bar.low <= projectedExit) {
                sameDayResult = { exitPrice: projectedExit, exitReason: "Take Profit Hit (Same Day)" };
            }
        }

        if (sameDayResult) {
            // Process the trade immediately without adding it to openPositions for the next loop
             const shares = capitalForThisTrade / tradeSignal.entryPrice;
             const profit = isLong
              ? (sameDayResult.exitPrice - tradeSignal.entryPrice) * shares
              : (tradeSignal.entryPrice - sameDayResult.exitPrice) * shares;

            currentCapital += profit;
            const profitPct = (profit / capitalForThisTrade) * 100;

            if (profit < 0) {
              consecutiveLosses++;
            } else {
              consecutiveLosses = 0;
            }
            if (preventOnLosses && consecutiveLosses >= 2) isObserving = true;

            tradeLog.push({
              ...newPosition.originalSignal,
              ...sameDayResult,
              exitDate: bar.date, // Same date as entry
              profit,
              profitPct,
            });
        } else {
            // No same-day exit, add to open positions correctly
            openPositions.push(newPosition);
        }
      }
    }
  }

  // Close any remaining open positions at the end of the test
  const lastDay = historicalData[historicalData.length - 1];
  for (const position of openPositions) {
    const shares = position.capitalAllocated / position.entryPrice;
    const profit = position.isLong
      ? (lastDay.close - position.entryPrice) * shares
      : (position.entryPrice - lastDay.close) * shares;

    currentCapital += profit;
    const profitPct = (profit / position.capitalAllocated) * 100;
    tradeLog.push({
      ...position.originalSignal,
      exitPrice: lastDay.close,
      exitDate: lastDay.date,
      exitReason: "End of Test",
      profit,
      profitPct,
    });
  }

  // --- Final Summary Calculation ---
  tradeLog.sort((a, b) => new Date(a.entryDate) - new Date(b.entryDate));
  const totalTrades = tradeLog.length;
  const winningTrades = tradeLog.filter((t) => t.profit > 0).length;
  const losingTrades = totalTrades - winningTrades;
  const totalProfit = currentCapital - initialCapital;
  let cagr = 0;
  if (totalTrades > 0) {
    const firstTradeDate = new Date(tradeLog[0].entryDate);
    const lastTradeDate = new Date(tradeLog[tradeLog.length - 1].exitDate);
    const years =
      (lastTradeDate - firstTradeDate) / (1000 * 60 * 60 * 24 * 365.25);
    if (years > 0) {
      cagr = (Math.pow(currentCapital / initialCapital, 1 / years) - 1) * 100;
    }
  }

  const summary = {
    totalTrades,
    winningTrades,
    losingTrades,
    winRate: totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0,
    totalProfit,
    initialCapital,
    finalCapital: currentCapital,
    cagr,
  };

  return { tradeLog, summary };
}
