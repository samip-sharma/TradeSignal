
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import Alpaca from '@alpacahq/alpaca-trade-api';

// --- Import AlgoCore Modules (using relative paths from this script location) ---
// Note: We are mocking/duplicating some logic to avoid complex dependency issues with swisseph in Node context if not needed.
// But we will try to reuse what we can.

import { filterToRTHAndWeekdays } from '../utils/algoCore/dataFilter.js';
import {
  findInitialPivots,
  findExitProjectionPivot,
  calculateTrendStructureRatio,
} from '../utils/algoCore/pivotFinders.js';
import { findFutureSignals } from '../utils/algoCore/tradeSignalLogic.js';
import { calculateProjectedExit } from '../utils/algoCore/exitPriceCalculator.js';
import { calculateATR } from '../utils/algoCore/technicalIndicators.js';

// Load Environment Variables
// We are in /scripts, so .env.local is in ../
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

if (!process.env.ALPACA_API_KEY || !process.env.ALPACA_API_SECRET) {
    console.error("Error: ALPACA_API_KEY and ALPACA_API_SECRET must be set in .env.local");
    // Fallback for demo if env not found or CI environment
    if(!process.env.CI) process.exit(1);
}

const alpaca = new Alpaca({
  paper: true,
  keyId: process.env.ALPACA_API_KEY,
  secretKey: process.env.ALPACA_API_SECRET,
});

// --- CONFIGURATION ---
// --- CONFIGURATION ---
const TICKERS = [
    // Tech / Growth (Original Core)
    "NVDA", "TSLA", "META", "MSFT", "AMZN",
    // Crypto Proxies
    "MSTR", "COIN",
    // Financials
    "JPM", "GS",
    // Energy
    "XOM", 
    // Healthcare
    "LLY", 
    // Industrials
    "CAT", 
    // Consumer Staples
    "COST", 
    // Commodities
    "GLD",
    // Indices
    "SPY", "IWM"
];

const START_DATE = "2020-01-01";
const END_DATE = "2025-10-01"; 
const TIMEFRAME = "1Day"; // Reverted to 1Day based on performance

// STRATEGY PARAMS
const LOOKBACK_PERIODS = [90, 45, 22];
const SCALING_ATR_PERIOD = 50;
const SCALING_TREND_PIVOTS = 4;
const SCALING_LOOKBACK = 180;
const TREND_WEIGHT = 0.6;
const VOLATILITY_WEIGHT = 0.4;
const PIVOT_LOOKAROUND = 10;

// PORTFOLIO PARAMS
const INITIAL_CAPITAL = 10000;
const POSITION_SIZE_PCT = 0.10; // 10%
const MAX_POSITIONS = 10; 

// --- HELPER FUNCTIONS ---

function calculateSMA(data, period) {
    if (data.length < period) return null;
    let sum = 0;
    for (let i = 0; i < period; i++) {
        sum += data[data.length - 1 - i].close;
    }
    return sum / period;
}

// ... (existing helpers) ...

// --- MAIN LOGIC ---

// ... (fetchTickerData, findSharpPivots unchanged) ...

async function generateSignalsForTicker(ticker, data) {
    if (data.length < 200) return [];

    let processedData = data;
    if (TIMEFRAME !== "1Day") {
        processedData = filterToRTHAndWeekdays(data, TIMEFRAME);
    }

    const sharpPivotTimestamps = findSharpPivots(processedData, PIVOT_LOOKAROUND);
    const generatedSignals = [];

    // Pre-calculate pivot points to iterate faster
    // Start after enough data for SMA(200)
    for (let i = 200; i < processedData.length; i++) {
        const currentBar = processedData[i];
        
        if (!sharpPivotTimestamps.has(currentBar.date.getTime())) continue;

        // --- TREND FILTER (The "Quality" Control) ---
        // Calculate SMA 200 at this point
        const historyForSMA = processedData.slice(0, i + 1); // Slice up to current
        // Optimization: We only need the last 200
        const smaWindow = processedData.slice(i - 200 + 1, i + 1);
        const sma200 = calculateSMA(smaWindow, 200);
        
        const isBullishTrend = sma200 && currentBar.close > sma200;
        const isBearishTrend = sma200 && currentBar.close < sma200;

        for (const lookbackPeriod of LOOKBACK_PERIODS) {
            // ... (setup code unchanged) ...
            
            const startIndex = i;
            const pointYIndex = startIndex + lookbackPeriod;
            if (pointYIndex >= processedData.length) continue;

            const lookbackBar = processedData[pointYIndex];
            const stoplossScanWindow = processedData.slice(startIndex, pointYIndex + 1);
            const { pivotHigh, pivotLow } = findInitialPivots(stoplossScanWindow, lookbackBar.close);

            const signalScanWindow = processedData.slice(pointYIndex + 1);
            const signals = findFutureSignals(signalScanWindow, pivotHigh, pivotLow);

            // Helper to process a signal (Long or Short)
            const processSignal = (signal, type) => {
                if (!signal) return;

                // --- APPLY TREND FILTER HERE ---
                if (type === 'LONG' && !isBullishTrend) return; // Only Long in Bull Trend
                if (type === 'SHORT' && !isBearishTrend) return; // Only Short in Bear Trend
                
                // Calculate Exit (unchanged)
                const triggerIndex = processedData.findIndex(d => d.date.getTime() === signal.triggerDate.getTime());
                if (triggerIndex <= 0) return;

                const historyBeforeTrigger = processedData.slice(0, triggerIndex);
                const exitPivot = findExitProjectionPivot(historyBeforeTrigger, type);

                if (!exitPivot) return; // STRICT: No exit pivot, no trade

                // Scaling Logic
                const scalingHistory = processedData.slice(Math.max(0, triggerIndex - SCALING_LOOKBACK), triggerIndex);
                const trendRatio = calculateTrendStructureRatio(scalingHistory, SCALING_TREND_PIVOTS);
                const volatilityRatio = calculateATR(scalingHistory, SCALING_ATR_PERIOD);
                
                let scalingFactor = 1;
                 if (trendRatio && volatilityRatio) {
                    scalingFactor = trendRatio * TREND_WEIGHT + volatilityRatio * VOLATILITY_WEIGHT;
                } else if (trendRatio || volatilityRatio) {
                    scalingFactor = trendRatio || volatilityRatio;
                }

                if (scalingFactor <= 0) return;

                const projectedExit = calculateProjectedExit({
                    signalType: type,
                    triggerPrice: processedData[triggerIndex].close,
                    pivot: exitPivot,
                    timeDifference: triggerIndex - processedData.findIndex(d=>d.date.getTime()===exitPivot.date.getTime()),
                    scalingFactor: scalingFactor
                });

                if (!projectedExit) return;

                generatedSignals.push({
                    ticker,
                    type,
                    entryDate: signal.entryDate,
                    entryPrice: signal.entryPrice,
                    stopLoss: type === 'LONG' ? pivotLow?.low : pivotHigh?.high,
                    takeProfit: projectedExit,
                    signalDate: signal.triggerDate
                });
            };

            processSignal(signals.longSignal, 'LONG');
            processSignal(signals.shortSignal, 'SHORT');
        }
    }
    return generatedSignals;
}

async function runPortfolioSimulation() {
    console.log("=== AlgoCore Portfolio Simulation ===");
    console.log(`Tickers: ${TICKERS.join(', ')}`);
    console.log(`Timeframe: ${TIMEFRAME}`);
    console.log(`Range: ${START_DATE} to ${END_DATE}`);
    console.log("------------------------------------------------");

    const marketData = {};
    for (const ticker of TICKERS) {
        try {
            marketData[ticker] = await fetchTickerData(ticker);
            console.log(`  > Loaded ${marketData[ticker].length} bars for ${ticker}`);
            await sleep(500); // Respect Rate Limits
        } catch (e) {
            console.error(`  x Failed to load ${ticker}: ${e.message}`);
        }
    }

    console.log("Generating Signals...");
    let allSignals = [];
    for (const ticker of Object.keys(marketData)) {
        const tickerSignals = await generateSignalsForTicker(ticker, marketData[ticker]);
        console.log(`  > ${ticker}: ${tickerSignals.length} potential signals`);
        allSignals = [...allSignals, ...tickerSignals];
    }

    // Sort Signals by Time
    allSignals.sort((a, b) => a.entryDate - b.entryDate);

    console.log("Running Portfolio Loop...");
    
    let cash = INITIAL_CAPITAL;
    let portfolioHistory = [];
    const openPositions = []; 
    const tradeLog = [];

    const allDates = new Set();
    Object.values(marketData).forEach(data => {
        data.forEach(bar => allDates.add(bar.date.getTime()));
    });
    const timeline = Array.from(allDates).sort((a, b) => a - b);

    // Build optimized price map
    const priceMap = {}; 
    Object.keys(marketData).forEach(ticker => {
        marketData[ticker].forEach(bar => {
            const ts = bar.date.getTime();
            if(!priceMap[ts]) priceMap[ts] = {};
            priceMap[ts][ticker] = bar;
        });
    });

    let currentSignalIndex = 0;

    for (const ts of timeline) {
        const dateObj = new Date(ts);
        const dayPrices = priceMap[ts];
        if (!dayPrices) continue;

        // A. Manage Open Positions
        for (let i = openPositions.length - 1; i >= 0; i--) {
            const pos = openPositions[i];
            const bar = dayPrices[pos.ticker];
            
            if (!bar) continue; 

            let exitPrice = null;
            let exitReason = null;

            if (pos.type === 'LONG') {
                if (bar.low <= pos.stopLoss) { exitPrice = pos.stopLoss; exitReason = 'Stop Loss'; }
                else if (bar.high >= pos.takeProfit) { exitPrice = pos.takeProfit; exitReason = 'Take Profit'; }
            } else { // SHORT
                if (bar.high >= pos.stopLoss) { exitPrice = pos.stopLoss; exitReason = 'Stop Loss'; }
                else if (bar.low <= pos.takeProfit) { exitPrice = pos.takeProfit; exitReason = 'Take Profit'; }
            }

            if (exitPrice) {
                const profit = pos.type === 'LONG' 
                    ? (exitPrice - pos.entryPrice) * pos.shares
                    : (pos.entryPrice - exitPrice) * pos.shares;
                
                cash += (pos.initialCost + profit);
                
                tradeLog.push({
                    ticker: pos.ticker,
                    type: pos.type,
                    entryDate: pos.entryDate,
                    entryPrice: pos.entryPrice,
                    exitDate: dateObj,
                    exitPrice: exitPrice,
                    profit: profit,
                    reason: exitReason
                });

                openPositions.splice(i, 1);
            }
        }

        // B. Process New Signals
        while (currentSignalIndex < allSignals.length) {
            const signal = allSignals[currentSignalIndex];
            const signalTs = signal.entryDate.getTime();

            if (signalTs < ts) { currentSignalIndex++; continue; }
            if (signalTs > ts) { break; }

            currentSignalIndex++;

            const bar = dayPrices[signal.ticker];
            if (!bar) continue;
            
            if (openPositions.length >= MAX_POSITIONS) continue;
            if (openPositions.find(p => p.ticker === signal.ticker)) continue;

            // Use Current Equity for Sizing
            const currentEquity = cash + openPositions.reduce((acc, pos) => {
                 const currentBar = dayPrices[pos.ticker];
                 if(!currentBar) return acc + pos.initialCost; 
                 const unrealized = pos.type === 'LONG' 
                    ? (currentBar.close - pos.entryPrice) * pos.shares
                    : (pos.entryPrice - currentBar.close) * pos.shares;
                 return acc + pos.initialCost + unrealized;
            }, 0);

            const tradeAmount = currentEquity * POSITION_SIZE_PCT;
            
            if (cash < tradeAmount) continue;

            const shares = tradeAmount / signal.entryPrice;
            
            // Check SAME DAY Stop Loss/Take Profit
            let instantExit = null;
             if (signal.type === 'LONG') {
                if (bar.low <= signal.stopLoss) instantExit = { price: signal.stopLoss, reason: 'Stop Loss (Same Day)' };
                else if (bar.high >= signal.takeProfit) instantExit = { price: signal.takeProfit, reason: 'Take Profit (Same Day)' };
            } else {
                if (bar.high >= signal.stopLoss) instantExit = { price: signal.stopLoss, reason: 'Stop Loss (Same Day)' };
                else if (bar.low <= signal.takeProfit) instantExit = { price: signal.takeProfit, reason: 'Take Profit (Same Day)' };
            }

            if (instantExit) {
                const profit = signal.type === 'LONG'
                    ? (instantExit.price - signal.entryPrice) * shares
                    : (signal.entryPrice - instantExit.price) * shares;
                
                cash += profit;
                 tradeLog.push({
                    ticker: signal.ticker,
                    type: signal.type,
                    entryDate: signal.entryDate,
                    entryPrice: signal.entryPrice,
                    exitDate: dateObj,
                    exitPrice: instantExit.price,
                    profit: profit,
                    reason: instantExit.reason
                });

            } else {
                cash -= tradeAmount;
                openPositions.push({
                    ticker: signal.ticker,
                    type: signal.type,
                    shares: shares,
                    entryPrice: signal.entryPrice,
                    entryDate: signal.entryDate,
                    initialCost: tradeAmount,
                    stopLoss: signal.stopLoss,
                    takeProfit: signal.takeProfit
                });
            }
        }

        // Record Daily Equity
        const totalEquity = cash + openPositions.reduce((acc, pos) => {
             const currentBar = dayPrices[pos.ticker];
             if(!currentBar) return acc + pos.initialCost;
             const unrealized = pos.type === 'LONG' 
                ? (currentBar.close - pos.entryPrice) * pos.shares
                : (pos.entryPrice - currentBar.close) * pos.shares;
             return acc + pos.initialCost + unrealized;
        }, 0);
        
        portfolioHistory.push({ date: dateObj, equity: totalEquity, openPositionsCount: openPositions.length });
    }

    // --- EXPOSURE STATS ---
    const totalTradingDays = portfolioHistory.length;
    const daysInMarket = portfolioHistory.filter(d => d.openPositionsCount > 0).length;
    const exposurePct = totalTradingDays > 0 ? (daysInMarket / totalTradingDays) * 100 : 0;
    
    console.log(`Time in Market:  ${exposurePct.toFixed(2)}% (${daysInMarket}/${totalTradingDays} days)`);
    console.log("------------------------------------------------");
    
    console.log(`Initial Capital: $${INITIAL_CAPITAL.toFixed(2)}`);
    const finalEquity = portfolioHistory.length > 0 ? portfolioHistory[portfolioHistory.length-1].equity : INITIAL_CAPITAL;
    console.log(`Final Equity:    $${finalEquity.toFixed(2)}`);
    console.log(`Total Return:    ${((finalEquity - INITIAL_CAPITAL)/INITIAL_CAPITAL * 100).toFixed(2)}%`);
    
    // Calculate CAGR
    const startDate = new Date(START_DATE);
    const endDate = new Date(END_DATE); 
    const years = (endDate - startDate) / (1000 * 60 * 60 * 24 * 365.25);
    const cagr = (Math.pow(finalEquity / INITIAL_CAPITAL, 1 / years) - 1) * 100;
    console.log(`CAGR:            ${cagr.toFixed(2)}%`);

    // --- BENCHMARK COMPARISON (Approximation) ---
    // Average return of the ticker universe if held equally
    let totalBenchmarkReturn = 0;
    Object.keys(marketData).forEach(ticker => {
        const data = marketData[ticker];
        if(data.length > 0) {
            const startPrice = data[0].close;
            const endPrice = data[data.length-1].close;
            totalBenchmarkReturn += (endPrice - startPrice) / startPrice;
        }
    });
    const avgBenchmarkReturn = (totalBenchmarkReturn / Object.keys(marketData).length) * 100;
    console.log(`Benchmark (B&H): ${avgBenchmarkReturn.toFixed(2)}% (Avg of all tickers)`);

    if (((finalEquity - INITIAL_CAPITAL)/INITIAL_CAPITAL * 100) > avgBenchmarkReturn) {
        console.log("✅ ALPHA DETECTED: Strategy outperformed Benchmark.");
    } else {
        console.log("⚠️ NO ALPHA: Strategy underperformed simple Buy & Hold.");
    }

    // Calculate max drawdown
    let maxDrawdown = 0;
    let peak = -Infinity;
    for (const point of portfolioHistory) {
      if (point.equity > peak) peak = point.equity;
      const dd = (peak - point.equity) / peak;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }
    console.log(`Max Drawdown:    ${(maxDrawdown * 100).toFixed(2)}%`);
    // Stats
    const winningTrades = tradeLog.filter(t => t.profit > 0);
    const losingTrades = tradeLog.filter(t => t.profit <= 0);
    console.log(`Total Trades:    ${tradeLog.length}`);
    console.log(`Win Rate:        ${tradeLog.length > 0 ? (winningTrades.length / tradeLog.length * 100).toFixed(2) : 0}%`);
    
    // Breakdown: Long vs Short
    const longTrades = tradeLog.filter(t => t.type === 'LONG');
    const shortTrades = tradeLog.filter(t => t.type === 'SHORT');
    const longWins = longTrades.filter(t => t.profit > 0);
    const shortWins = shortTrades.filter(t => t.profit > 0);
    const longPnL = longTrades.reduce((acc, t) => acc + t.profit, 0);
    const shortPnL = shortTrades.reduce((acc, t) => acc + t.profit, 0);

    console.log("\n--- Strategy Breakdown ---");
    console.log(`LONG  | Trades: ${longTrades.length} | Win Rate: ${longTrades.length > 0 ? (longWins.length / longTrades.length * 100).toFixed(2) : 0}% | P/L: $${longPnL.toFixed(0)}`);
    console.log(`SHORT | Trades: ${shortTrades.length} | Win Rate: ${shortTrades.length > 0 ? (shortWins.length / shortTrades.length * 100).toFixed(2) : 0}% | P/L: $${shortPnL.toFixed(0)}`);

    // Breakdown: Year by Year
    const yearlyStats = {};
    tradeLog.forEach(t => {
        const year = t.exitDate.getFullYear();
        if (!yearlyStats[year]) yearlyStats[year] = { profit: 0, trades: 0, wins: 0 };
        yearlyStats[year].profit += t.profit;
        yearlyStats[year].trades++;
        if (t.profit > 0) yearlyStats[year].wins++;
    });

    console.log("\n--- Yearly Performance --");
    Object.keys(yearlyStats).sort().forEach(year => {
        const stats = yearlyStats[year];
        console.log(`${year} | P/L: $${stats.profit.toFixed(0).padEnd(8)} | Trades: ${stats.trades} | Win Rate: ${((stats.wins/stats.trades)*100).toFixed(0)}%`);
    });

    // Ticker Breakdown
    const tickerStats = {};
    tradeLog.forEach(t => {
        if(!tickerStats[t.ticker]) tickerStats[t.ticker] = { profit: 0, wins: 0, total: 0 };
        tickerStats[t.ticker].profit += t.profit;
        tickerStats[t.ticker].total++;
        if(t.profit > 0) tickerStats[t.ticker].wins++;
    });

    console.log("\n--- Performance by Ticker ---");
    Object.keys(tickerStats)
        .sort((a,b) => tickerStats[b].profit - tickerStats[a].profit)
        .forEach(t => {
            const stats = tickerStats[t];
            console.log(`${t.padEnd(6)} | P/L: $${stats.profit.toFixed(0).padEnd(8)} | Win: ${((stats.wins/stats.total)*100).toFixed(0)}% (${stats.total} trades)`);
        });

    console.log("------------------------------------------------");
}

runPortfolioSimulation().catch(console.error);
