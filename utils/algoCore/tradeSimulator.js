/**
 * @file utils/algoCore/tradeSimulator.js
 * @description A simplified trade simulator used for pre-analysis and optimization.
 */

/**
 * Simulates the outcome of a single potential trade signal against historical data.
 * It checks if the trade would have hit its stop-loss or take-profit.
 * @param {object} signalData - The aggregated signal object.
 * @param {Array} historicalData - The complete array of historical stock data.
 * @returns {{profit: number, tradeFound: boolean}} - The result of the simulated trade.
 */
export function getTradeOutcome(signalData, historicalData) {
  // Determine if we're working with a long or short signal from the aggregated object
  const tradeSignal = signalData.longSignal || signalData.shortSignal;
  if (!tradeSignal || !tradeSignal.entryDate) {
    return { profit: 0, tradeFound: false };
  }

  const isLong = !!signalData.longSignal;
  const stopLoss = isLong
    ? signalData.pivotLow?.low
    : signalData.pivotHigh?.high;
  const projectedExit = tradeSignal.projectedExit;

  // If we don't have the necessary prices, we can't simulate the trade.
  if (!stopLoss || !projectedExit) {
    return { profit: 0, tradeFound: false };
  }

  // Find the starting bar for the simulation
  const entryDateStr = new Date(tradeSignal.entryDate)
    .toISOString()
    .split("T")[0];
  const startIndex = historicalData.findIndex(
    (d) => new Date(d.date).toISOString().split("T")[0] === entryDateStr
  );

  if (startIndex === -1) {
    return { profit: 0, tradeFound: false };
  }

  let tradeResult = null;
  const tradeWindow = historicalData.slice(startIndex);

  // Loop through the days following the entry to see what happens first
  for (const day of tradeWindow) {
    if (isLong) {
      // Check if stop loss is hit
      if (day.low <= stopLoss) {
        tradeResult = { exitPrice: stopLoss };
        break; // Exit the loop, the trade is over
      }
      // Check if take profit is hit
      if (day.high >= projectedExit) {
        tradeResult = { exitPrice: projectedExit };
        break; // Exit the loop, the trade is over
      }
    } else {
      // It's a short trade
      // Check if stop loss is hit
      if (day.high >= stopLoss) {
        tradeResult = { exitPrice: stopLoss };
        break;
      }
      // Check if take profit is hit
      if (day.low <= projectedExit) {
        tradeResult = { exitPrice: projectedExit };
        break;
      }
    }
  }

  // If the loop finishes and nothing was hit, no trade outcome can be determined from the data provided.
  if (!tradeResult) {
    return { profit: 0, tradeFound: false };
  }

  // Calculate the profit based on the outcome
  const profit = isLong
    ? tradeResult.exitPrice - tradeSignal.entryPrice
    : tradeSignal.entryPrice - tradeResult.exitPrice;

  return { profit: profit, tradeFound: true };
}
