import { NextResponse } from 'next/server';
import alpaca from "../../../lib/alpaca";
import { runBacktest } from "../../../utils/algoCore/backtester";

// Import all strategy logic files
import { filterToRTHAndWeekdays } from "../../../utils/algoCore/dataFilter";
import {
  findInitialPivots,
  findExitProjectionPivot,
  calculateTrendStructureRatio,
} from "../../../utils/algoCore/pivotFinders";
import { findFutureSignals } from "../../../utils/algoCore/tradeSignalLogic";
import { calculateProjectedExit } from "../../../utils/algoCore/exitPriceCalculator";
import { calculateATR } from "../../../utils/algoCore/technicalIndicators";

// --- CONFIGURABLE CONSTANTS ---
const LOOKBACK_FOR_START_POINT = 180;
const PIVOT_LOOKAROUND = 10;
// --- NEW: DYNAMIC SCALING CONFIGURATION ---
const SCALING_ATR_PERIOD = 50;
const SCALING_TREND_PIVOTS = 4;
const SCALING_LOOKBACK = 180; // How far back to look for scaling calculations
const TREND_WEIGHT = 0.6; // Weight for the pivot slope ratio
const VOLATILITY_WEIGHT = 0.4; // Weight for the ATR ratio

function normalizeAlpacaData(alpacaBars) {
  return alpacaBars.map((bar) => ({
    date: new Date(bar.Timestamp),
    open: bar.OpenPrice,
    high: bar.HighPrice,
    low: bar.LowPrice,
    close: bar.ClosePrice,
    volume: bar.Volume,
  }));
}

function findSharpPivots(data, lookaround) {
  const pivotTimestamps = new Set();
  if (data.length < lookaround * 2 + 1) return pivotTimestamps;
  for (let i = lookaround; i < data.length - lookaround; i++) {
    const currentBar = data[i];
    const window = data.slice(i - lookaround, i + lookaround + 1);
    const maxHighInWindow = Math.max(...window.map((b) => b.high));
    const minLowInWindow = Math.min(...window.map((b) => b.low));
    if (currentBar.high === maxHighInWindow)
      pivotTimestamps.add(currentBar.date.getTime());
    if (currentBar.low === minLowInWindow)
      pivotTimestamps.add(currentBar.date.getTime());
  }
  return pivotTimestamps;
}

export async function POST(request) {
  try {
    const {
      ticker,
      timeframe,
      startDate,
      endDate,
      lookbackPeriods,
      initialCapital,
      preventOnLosses,
      liquidateGroup,
      allowSingleTradePerDay,
      positionSize,
    } = await request.json();

    // --- Data Fetching (Unchanged) ---
    const userStartDate = new Date(startDate);
    const dataFetchStartDate = new Date(userStartDate);
    let preBufferDays;
    switch (timeframe) {
      case "1Day":
        preBufferDays = 365;
        break;
      default:
        preBufferDays = 60;
        break;
    }
    dataFetchStartDate.setDate(userStartDate.getDate() - preBufferDays);

    let alpacaTimeframe;
    switch (timeframe) {
      case "1Min":
        alpacaTimeframe = alpaca.newTimeframe(1, alpaca.timeframeUnit.MIN);
        break;
      case "5Min":
        alpacaTimeframe = alpaca.newTimeframe(5, alpaca.timeframeUnit.MIN);
        break;
      case "15Min":
        alpacaTimeframe = alpaca.newTimeframe(15, alpaca.timeframeUnit.MIN);
        break;
      case "1Hour":
        alpacaTimeframe = alpaca.newTimeframe(1, alpaca.timeframeUnit.HOUR);
        break;
      case "1Day":
        alpacaTimeframe = alpaca.newTimeframe(1, alpaca.timeframeUnit.DAY);
        break;
      default:
        throw new Error("Invalid timeframe provided.");
    }
    const barsIterator = alpaca.getBarsV2(ticker.replace("^", ""), {
      start: dataFetchStartDate.toISOString(),
      end: new Date(endDate).toISOString(),
      timeframe: alpacaTimeframe,
    });
    const rawAlpacaBars = [];
    for await (let bar of barsIterator) rawAlpacaBars.push(bar);
    const allStockData = normalizeAlpacaData(rawAlpacaBars);
    let processedData =
      timeframe !== "1Day"
        ? filterToRTHAndWeekdays(allStockData, timeframe)
        : allStockData;
    const simulationStartIndex = processedData.findIndex(
      (bar) => bar.date >= userStartDate
    );
    if (simulationStartIndex === -1) {
      return NextResponse.json({
        success: false,
        error: "Start Date not in dataset (weekend/holiday).",
      }, { status: 404 });
    }
    if (simulationStartIndex < LOOKBACK_FOR_START_POINT) {
      return NextResponse.json({
        success: false,
        error:
          "Not enough historical data. Please select an earlier Start Date.",
      }, { status: 400 });
    }

    const sharpPivotTimestamps = findSharpPivots(
      processedData,
      PIVOT_LOOKAROUND
    );
    let allGeneratedSignals = [];

    // --- Main Simulation Loop ---
    for (let i = simulationStartIndex; i < processedData.length; i++) {
      const currentBar = processedData[i];
      if (!sharpPivotTimestamps.has(currentBar.date.getTime())) continue;

      const startPoint = {
        name: `Auto Pivot on ${currentBar.date.toISOString()}`,
        date: currentBar.date,
      };

      for (const lookbackPeriod of lookbackPeriods) {
        const startIndex = i;
        const pointYIndex = startIndex + lookbackPeriod;
        if (pointYIndex >= processedData.length) continue;

        const lookbackBar = processedData[pointYIndex];
        const stoplossScanWindow = processedData.slice(
          startIndex,
          pointYIndex + 1
        );
        const { pivotHigh, pivotLow } = findInitialPivots(
          stoplossScanWindow,
          lookbackBar.close
        );

        const signalScanWindow = processedData.slice(pointYIndex + 1);
        let signals = findFutureSignals(signalScanWindow, pivotHigh, pivotLow);

        // --- DYNAMIC SCALING CALCULATION ---
        // ... (imports and other functions are unchanged) ...

        // --- Find Signals and Calculate Exits ---
        const calculateAndSetExit = (signal, signalType) => {
          if (!signal) return;
          const triggerIndex = processedData.findIndex(
            (d) => d.date.getTime() === signal.triggerDate.getTime()
          );
          if (triggerIndex > 0) {
            const historyBeforeTrigger = processedData.slice(0, triggerIndex);
            const exitPivot = findExitProjectionPivot(
              historyBeforeTrigger,
              signalType
            );

            if (exitPivot) {
              const pivotIndex = processedData.findIndex(
                (d) => d.date.getTime() === exitPivot.date.getTime()
              );

              const scalingHistory = processedData.slice(
                Math.max(0, triggerIndex - SCALING_LOOKBACK),
                triggerIndex
              );
              const trendRatio = calculateTrendStructureRatio(
                scalingHistory,
                SCALING_TREND_PIVOTS
              );
              const volatilityRatio = calculateATR(
                scalingHistory,
                SCALING_ATR_PERIOD
              );

              let finalScalingFactor = 1;
              if (trendRatio && volatilityRatio) {
                finalScalingFactor =
                  trendRatio * TREND_WEIGHT +
                  volatilityRatio * VOLATILITY_WEIGHT;
              } else if (trendRatio || volatilityRatio) {
                finalScalingFactor = trendRatio || volatilityRatio;
              }

              if (finalScalingFactor > 0) {
                signal.projectedExit = calculateProjectedExit({
                  signalType: signalType,
                  // --- FIX: Use the close price for both long and short for consistency ---
                  triggerPrice: processedData[triggerIndex].close,
                  pivot: exitPivot,
                  timeDifference: triggerIndex - pivotIndex,
                  scalingFactor: finalScalingFactor,
                });
              }
              signal.exitPivot = exitPivot;
            }
          }
        };

        calculateAndSetExit(signals.longSignal, "LONG");
        calculateAndSetExit(signals.shortSignal, "SHORT");

        // ... (rest of the file is unchanged) ...

        allGeneratedSignals.push({
          startPointName: startPoint.name,
          // --- THIS LINE IS NOW FIXED ---
          startDateUTC: startPoint.date.toISOString(),
          lookbackPeriod,
          lookbackEndDate: lookbackBar.date,
          pivotHigh,
          pivotLow,
          longSignal: signals.longSignal,
          shortSignal: signals.shortSignal,
        });
      }
    }

    const backtestResults = runBacktest(
      allGeneratedSignals,
      processedData,
      initialCapital,
      preventOnLosses,
      liquidateGroup,
      allowSingleTradePerDay,
      positionSize
    );

    return NextResponse.json({ success: true, data: backtestResults });
  } catch (error) {
    console.error("API Error in /api/robDaily:", error);
    return NextResponse.json({
      success: false,
      error: "An internal server error occurred: " + error.message,
    }, { status: 500 });
  }
}
