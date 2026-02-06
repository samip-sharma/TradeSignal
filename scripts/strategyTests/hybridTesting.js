
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import Alpaca from '@alpacahq/alpaca-trade-api';
import {
    calculateRSI,
    calculateBollingerBands,
    calculateRVOL,
    checkGoldenCross
} from '../../utils/algoCore/advancedIndicators.js';
import {
    findInitialPivots,
    calculateTrendStructureRatio,
    findExitProjectionPivot
} from '../../utils/algoCore/pivotFinders.js';
import { calculateProjectedExit } from '../../utils/algoCore/exitPriceCalculator.js';
import { calculateATR } from '../../utils/algoCore/technicalIndicators.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

if (!process.env.ALPACA_API_KEY || !process.env.ALPACA_API_SECRET) {
    if(!process.env.CI) process.exit(1);
}

const alpaca = new Alpaca({
  paper: true,
  keyId: process.env.ALPACA_API_KEY,
  secretKey: process.env.ALPACA_API_SECRET,
});

function calculateSMA(data, period) {
    if (data.length < period) return null;
    let sum = 0;
    for (let i = 0; i < period; i++) {
        sum += data[data.length - 1 - i].close;
    }
    return sum / period;
}

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

async function fetchData(ticker) {
    console.log(`fetching ${ticker}...`);
    let alpacaTimeframe = alpaca.newTimeframe(1, alpaca.timeframeUnit.DAY);

    try {
        const barsIterator = alpaca.getBarsV2(ticker, {
            start: new Date('2020-01-01').toISOString(),
            end: new Date('2025-01-01').toISOString(),
            timeframe: alpacaTimeframe,
        });
        const rawBars = [];
        for await (const bar of barsIterator) {
            rawBars.push(bar);
        }
        return normalizeAlpacaData(rawBars);
    } catch (e) {
        console.error(`Failed to fetch ${ticker}: ${e.message}`);
        return [];
    }
}

// --- CORE TEST ENGINE ---
function runEngine(data, strategyName, strategyLogic) {
    let balance = 10000;
    let position = null; // { price, size, stop, target }
    const tradeLog = [];
    
    // We start later to allow for MA200 and lookbacks
    for(let i = 202; i < data.length; i++) {
        const currentBar = data[i];
        const history = data.slice(0, i+1);

        // -- MANAGING POSITION --
        if (position) {
            // Check Stop/Limit
            let exitPrice = null;
            let exitReason = '';

            // 1. Fixed Stop Loss (Safety)
            if (currentBar.low <= position.stop) {
                exitPrice = position.stop;
                exitReason = 'Stop Loss';
            } 
            // 2. Take Profit (Target)
            else if (position.target && currentBar.high >= position.target) {
                exitPrice = position.target;
                exitReason = 'Target Hit';
            }
            // 3. Trailing Stop (if implemented in position structure)
            else if (position.trailingStop && currentBar.low <= position.trailingStop) {
                exitPrice = position.trailingStop;
                exitReason = 'Trailing Stop';
            }

            // Update Trailing Stop if price moved up
            if (!exitPrice && position.trailingStop && currentBar.close > position.highestClose) {
                position.highestClose = currentBar.close;
                // Move trail: Keep distance or tighten? Let's use simple logic:
                // New Stop = New Highest Close - (Distance that was originally set)
                // Or just standard ATR trail. Let's use logic passed by strategy if any.
                if (position.updateTrail) {
                     position.trailingStop = position.updateTrail(currentBar, position);
                }
            }

            if (exitPrice) {
                 const pnl = (exitPrice - position.price) * position.size;
                 balance += pnl;
                 tradeLog.push({
                     entryDate: position.entryDate,
                     exitDate: currentBar.date,
                     entryPrice: position.price,
                     exitPrice: exitPrice,
                     profit: pnl,
                     reason: exitReason
                 });
                 position = null;
            }
        } 
        
        // -- ENTRY LOGIC --
        if (!position) {
            const signal = strategyLogic(history, i); // Returns { price, stop, target, trailingStop, updateTrailFn } or null
            if (signal) {
                const size = balance / signal.price; // Full compounding
                position = {
                    price: signal.price,
                    size: size,
                    stop: signal.stop,
                    target: signal.target,
                    entryDate: currentBar.date,
                    trailingStop: signal.trailingStop,
                    highestClose: currentBar.close,
                    updateTrail: signal.updateTrail
                };
            }
        }
    }

    // --- METRICS GENERATION ---
    const years = {};
    let maxDD = 0;
    let peak = 10000;
    
    // Replay equity curve day by day (approximation using trade logs) 
    // Actually better to track daily equity line if we want MDD.
    // Let's simplified MDD from trade log path (Drawdown from peak balance).
    
    let runningBalance = 10000;
    let peakBalance = 10000;
    
    tradeLog.forEach(t => {
        runningBalance += t.profit;
        if(runningBalance > peakBalance) peakBalance = runningBalance;
        const dd = (peakBalance - runningBalance) / peakBalance;
        if(dd > maxDD) maxDD = dd;
        
        const y = t.exitDate.getFullYear();
        if(!years[y]) years[y] = { profit: 0, trades: 0 };
        years[y].profit += t.profit;
        years[y].trades++;
    });

    const wins = tradeLog.filter(t=>t.profit>0);
    const winRate = tradeLog.length > 0 ? (wins.length/tradeLog.length)*100 : 0;
    const grossProfit = wins.reduce((a,b)=>a+b.profit,0);
    const grossLoss = tradeLog.filter(t=>t.profit<0).reduce((a,b)=>a+Math.abs(b.profit),0);
    const profitFactor = grossLoss > 0 ? grossProfit/grossLoss : 999;
    
    return {
        name: strategyName,
        finalBalance: runningBalance,
        totalReturn: ((runningBalance-10000)/10000)*100,
        maxDD: maxDD * 100,
        winRate: winRate,
        profitFactor: profitFactor,
        totalTrades: tradeLog.length,
        years: years
    };
}

// ===========================================
// STRATEGY DEFINITIONS
// ===========================================

// --- OPTION 1: GEOMETRIC TRIGGER ---
// Setup: Pivot Low. Trigger: Vol Trap (RSI < 30 + Price < BB Lower).
function logicOption1(history, i) {
    const current = history[i];
    // Indicators
    const rsi = calculateRSI(history, 14);
    const bb = calculateBollingerBands(history, 20, 2);
    
    // Geometry: Did we find a Pivot Low recently? (e.g., within last 5 days)
    // findInitialPivots looks at the whole array. We slice recent.
    const recentSlice = history.slice(history.length - 10);
    const { pivotLow } = findInitialPivots(recentSlice); // This function searches back
    // Check if pivot was recent
    const isPivotNearby = pivotLow && (new Date(current.date).getTime() - new Date(pivotLow.date).getTime()) < (5 * 24 * 60 * 60 * 1000);

    // Trigger: Vol Trap
    if (isPivotNearby && rsi < 35 && current.close < bb.lower) {
        return {
            price: current.close,
            stop: current.close * 0.90, // 10% Stop
            target: null, // Open target
            trailingStop: current.close * 0.90,
            updateTrail: (bar, pos) => Math.max(pos.trailingStop, bar.close * 0.90) // 10% Trailing
        };
    }
    return null;
}

// --- OPTION 2: TREND ARCHITECT ---
// Setup: Break Pre-Calculated Resistance. Filter: SMA 200. Volume > 1.5.
function logicOption2(history, i) {
    const current = history[i];
    const sma200 = calculateSMA(history, 200);
    const rvol = calculateRVOL(history, 20);
    
    // Geometry: Breakout of 20-day High (Classic Donchian)
    const prev20 = history.slice(i-21, i);
    const keyLevel = Math.max(...prev20.map(b=>b.high));
    
    if (current.close > sma200 && current.close > keyLevel && rvol > 1.5) {
        return {
            price: current.close,
            stop: current.close * 0.95, // Tight stop on breakout failure
            target: null,
            trailingStop: current.close * 0.95, 
            updateTrail: (bar, pos) => Math.max(pos.trailingStop, bar.close * 0.95) // 5% trailing (Breakouts need room to run but tight invalidation)
        };
    }
    return null;
}

// --- OPTION 3: FRACTAL EXIT ---
// Entry: Vol Trap. Exit: Geometric Projection.
function logicOption3(history, i) {
    const current = history[i];
    const rsi = calculateRSI(history, 14);
    const bb = calculateBollingerBands(history, 20, 2);
    
    // Entry: Vol Trap (Crypto style)
    if (rsi < 35 && current.close < bb.lower) {
        // Calculate Target using Geometry
        // We need a recent pivot structure to project from.
        // Let's find recent pivot low to project UP from.
        const lookbackWindow = history.slice(history.length - 60);
        const { pivotLow } = findInitialPivots(lookbackWindow);
        
        let target = null;
        if (pivotLow) {
             const exitPivot = findExitProjectionPivot(history.slice(0, history.length-1), 'LONG');
             if (exitPivot) {
                 // Calculate scaling factor
                 const scaleRef = history.slice(Math.max(0, i-180));
                 const trendRatio = calculateTrendStructureRatio(scaleRef);
                 const atrRatio = calculateATR(scaleRef, 50);
                 let scalingFactor = trendRatio || atrRatio || 1;
                 
                 // Calculate Projection
                 const timeDiff = i - history.findIndex(b => b.date.getTime() === exitPivot.date.getTime());
                 target = calculateProjectedExit({
                     signalType: 'LONG',
                     triggerPrice: current.close,
                     pivot: exitPivot,
                     timeDifference: timeDiff,
                     scalingFactor: scalingFactor
                 });
             }
        }

        // Fallback if geometry fails
        if (!target) target = current.close * 1.5; // 50% gain default

        return {
            price: current.close,
            stop: current.close * 0.85, // 15% Stop (wider for traps)
            target: target,
            trailingStop: null, // Rely on Target
            updateTrail: null
        };
    }
    return null;
}

async function runHybridTests() {
    console.log("=== HYBRID GEOMETRY BACKTESTING (2020-2025) ===");
    
    const mstrData = await fetchData("MSTR"); // Best for Volatility Strategies
    const spyData = await fetchData("SPY");   // Best for Trend/Dip
    
    console.log("\n--- OPTION 1: GEOMETRIC TRIGGER (Pivots + Vol Trap Entry) ---");
    const res1 = runEngine(mstrData, "Option 1 (MSTR)", logicOption1);
    printStats(res1);

    console.log("\n--- OPTION 2: TREND ARCHITECT (SMA200 + Breakout + Volume) ---");
    // Stocks respect Trend Breakouts better when filtered by SMA200 (unlike raw breakouts)
    const res2 = runEngine(spyData, "Option 2 (SPY)", logicOption2); 
    printStats(res2);

    console.log("\n--- OPTION 3: FRACTAL EXIT (Vol Trap Entry + Geometric Target) ---");
    const res3 = runEngine(mstrData, "Option 3 (MSTR)", logicOption3);
    printStats(res3);
}

function printStats(res) {
    console.log(`STRATEGY: ${res.name}`);
    console.log(`Final Balance: $${res.finalBalance.toFixed(2)}`);
    console.log(`Total Return:  ${res.totalReturn.toFixed(2)}%`);
    console.log(`Max Drawdown:  ${res.maxDD.toFixed(2)}%`);   
    console.log(`Profit Factor: ${res.profitFactor.toFixed(2)}`); 
    console.log(`Win Rate:      ${res.winRate.toFixed(2)}% (${res.totalTrades} trades)`);
    console.log("Yearly Breakdown:");
    Object.keys(res.years).sort().forEach(y => {
        const d = res.years[y];
        console.log(`  ${y}: $${d.profit.toFixed(0)} (${d.trades} trades)`);
    });
}

runHybridTests().catch(console.error);
