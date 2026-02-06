
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
    findExitProjectionPivot
} from '../../utils/algoCore/pivotFinders.js';
import { calculateSMA } from '../../utils/algoCore/technicalIndicators.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

if (!process.env.ALPACA_API_KEY || !process.env.ALPACA_API_SECRET) {
    if(!process.env.CI) process.exit(1);
}

const alpaca = new Alpaca({
  paper: true,
  keyId: process.env.ALPACA_API_KEY,
  secretKey: process.env.ALPACA_API_SECRET,
});

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

// ===========================================
// PORTFOLIO MIXING ENGINE
// ===========================================
// This engine runs multiple strategies in parallel on a single Capital Pool.
// It detects if cash is available and allocates based on signal priority.

async function runPortfolioMix(spyData, mstrData) {
    console.log("=== RUNNING MULTI-STRATEGY PORTFOLIO MIX ===");
    
    // CONFIGURATION
    const START_CAPITAL = 10000;
    let cash = START_CAPITAL;
    let portfolioValue = START_CAPITAL;
    
    // Positions Array: { ticker, strategy, entryPrice, size, shares, stop, target, trailingStop }
    let positions = [];
    const tradeLog = [];

    // Combine data dates to iterate day by day
    // We assume both datasets largely overlap in days. We drive by date loop.
    const allDates = new Set([
        ...spyData.map(d=>d.date.getTime()),
        ...mstrData.map(d=>d.date.getTime())
    ]);
    const sortedDates = Array.from(allDates).sort();

    // Loop through every trading day (Time Travel)
    for (let t = 200; t < sortedDates.length; t++) {
        const dateKey = sortedDates[t];
        const dateObj = new Date(dateKey);
        
        // Get Daily Bars for each asset
        const spyIdx = spyData.findIndex(d => d.date.getTime() === dateKey);
        const mstrIdx = mstrData.findIndex(d => d.date.getTime() === dateKey);
        
        const spyBar = spyIdx !== -1 ? spyData[spyIdx] : null;
        const mstrBar = mstrIdx !== -1 ? mstrData[mstrIdx] : null;

        if (!spyBar && !mstrBar) continue; // No trading today

        // 1. MANAGE EXISTING POSITIONS
        // Loop backwards to allow removal
        for (let p = positions.length - 1; p >= 0; p--) {
            const pos = positions[p];
            const bar = pos.ticker === 'SPY' ? spyBar : mstrBar;
            
            if (!bar) continue; // No data for this asset today
            
            let exitPrice = null;
            let exitReason = null;

            // Stop Loss
            if (bar.low <= pos.stop) {
                exitPrice = pos.stop;
                exitReason = `Stop Loss (${pos.strategy})`;
            }
            // Target
            else if (pos.target && bar.high >= pos.target) {
                exitPrice = pos.target;
                exitReason = `Target Hit (${pos.strategy})`;
            }
            // Trailing Stop (Dynamic)
            else if (pos.trailingStop && bar.low <= pos.trailingStop) {
                exitPrice = pos.trailingStop;
                exitReason = `Trailing Stop (${pos.strategy})`;
            }
            // Update Trail
            else if (pos.trailingStop && bar.close > pos.highestClose) {
                pos.highestClose = bar.close;
                // Update based on strategy rules
                if (pos.strategy === 'Vol Trap') pos.trailingStop = bar.close * 0.90; // 10% trail
                if (pos.strategy === 'Whale Tracker') pos.trailingStop = bar.close * 0.95; // 5% trail (tighter)
                if (pos.strategy === 'Hybrid Dip') pos.trailingStop = bar.close * 0.95; 
                // Option 3 Fractal Geometry Trail?
                if (pos.strategy === 'Fractal Geo') {
                     // Trail pivots? Complex. Stick to fixed % for robustness verified earlier.
                     pos.trailingStop = bar.close * 0.92;
                }
            }

            if (exitPrice) {
                const profit = (exitPrice - pos.entryPrice) * pos.shares;
                cash += (pos.size + profit);
                
                tradeLog.push({
                    date: dateObj,
                    ticker: pos.ticker,
                    strategy: pos.strategy,
                    profit: profit,
                    returnPct: (profit/pos.size)*100
                });
                
                positions.splice(p, 1);
            }
        }

        // 2. GENERATE NEW SIGNALS (Only if Cash Available)
        // We allow max 3 positions. Roughly 33% allocation each.
        const positionLimit = 3;
        const perTradeRisk = 0.33;
        
        if (positions.length < positionLimit) {
            const availableToTrade = portfolioValue * perTradeRisk;
            
            // --- SIGNAL LOGIC ---
            
            // A. VOLATILITY TRAP (MSTR)
            if (mstrBar && mstrIdx > 50) {
                 const hist = mstrData.slice(0, mstrIdx+1);
                 const bb = calculateBollingerBands(hist, 20, 2);
                 const rsi = calculateRSI(hist, 14);
                 
                 // Logic: RSI < 35 && Close < Lower Band
                 if (rsi < 35 && mstrBar.close < bb.lower && checkNoPos(positions, 'MSTR')) {
                     const shares = availableToTrade / mstrBar.close;
                     addPosition(positions, 'MSTR', 'Vol Trap', mstrBar.close, availableToTrade, shares, mstrBar.close*0.85, null, mstrBar.close*0.85);
                     cash -= availableToTrade;
                 }
            }
            
            // B. WHALE TRACKER (MSTR)
            if (cash > availableToTrade && mstrBar && mstrIdx > 20) { // Check cash again
                const hist = mstrData.slice(0, mstrIdx+1);
                 const rvol = calculateRVOL(hist, 20);
                 const range = mstrBar.high - mstrBar.low;
                 const closeStrength = (mstrBar.close - mstrBar.low) / (range || 1);
                 
                 // Logic: RVOL > 2.0 && Close Top 30%
                 if (rvol > 2.0 && closeStrength > 0.7 && checkNoPos(positions, 'MSTR')) {
                     const shares = availableToTrade / mstrBar.close;
                     // Tighter stop for breakouts (5%)
                     addPosition(positions, 'MSTR', 'Whale Tracker', mstrBar.close, availableToTrade, shares, mstrBar.close*0.95, null, mstrBar.close*0.95);
                     cash -= availableToTrade;
                 }
            }
            
            // C. HYBRID DIP (SPY)
            if (cash > availableToTrade && spyBar && spyIdx > 200) {
                 const hist = spyData.slice(0, spyIdx+1);
                 const rsi = calculateRSI(hist, 14);
                 const sma200 = calculateSMA(hist, 200);
                 
                 // Logic: RSI < 30 && Close > SMA 200
                 if (rsi < 30 && spyBar.close > sma200 && checkNoPos(positions, 'SPY')) {
                      const shares = availableToTrade / spyBar.close;
                      addPosition(positions, 'SPY', 'Hybrid Dip', spyBar.close, availableToTrade, shares, spyBar.close*0.90, null, null); // No trail initially, sell on RSI bounce? Or use 10% stop
                      // Verified stats used 10% stop, no trail. Let's add trail to be safe.
                      cash -= availableToTrade;
                 }
            }
            
            // D. GEOMETRY BREAKOUT  (Weak but tested for mix)
            // Skip - Verified as weak. We stick to Top 3.
        }
        
        // Update Portfolio Value
        let positionsValue = 0;
        positions.forEach(p => {
            const bar = p.ticker === 'SPY' ? spyBar : mstrBar;
            if(bar) positionsValue += (p.shares * bar.close);
            else positionsValue += p.size; // fallback
        });
        portfolioValue = cash + positionsValue;
    }

    // --- REPORTING ---
    const totalReturn = ((portfolioValue - START_CAPITAL) / START_CAPITAL) * 100;
    const wins = tradeLog.filter(t => t.profit > 0);
    const profitFactor = wins.reduce((a,b)=>a+b.profit,0) / Math.abs(tradeLog.filter(t=>t.profit<0).reduce((a,b)=>a+b.profit,0));
    
    console.log(`\n=== MIXED PORTFOLIO RESULTS ===`);
    console.log(`Final Balance: $${portfolioValue.toFixed(2)}`);
    console.log(`Total Return:  ${totalReturn.toFixed(2)}%`);
    console.log(`Profit Factor: ${profitFactor.toFixed(2)}`);
    console.log(`Total Trades:  ${tradeLog.length} (Avg ${Math.round(tradeLog.length/5)}/year)`);
    console.log(`Avg Trade PnL: $${(tradeLog.reduce((a,b)=>a+b.profit,0)/tradeLog.length).toFixed(2)}`);
    
    // Strategy Specifics
    const stratStats = {};
    tradeLog.forEach(t => {
        if(!stratStats[t.strategy]) stratStats[t.strategy] = { count: 0, profit: 0 };
        stratStats[t.strategy].count++;
        stratStats[t.strategy].profit += t.profit;
    });
    console.table(stratStats);
}

function checkNoPos(positions, ticker) {
    // Basic rule: Don't double buy same ticker same day?
    // Actually we can, but let's diversify. If we hold MSTR via Vol Trap, don't buy via Whale on top (too much risk concentration).
    return !positions.find(p => p.ticker === ticker);
}

function addPosition(positions, ticker, strategy, price, size, shares, stop, target, trailingStop) {
    positions.push({
        ticker, strategy, entryPrice: price, size, shares, stop, target, trailingStop, highestClose: price
    });
}

async function runTest() {
    const spy = await fetchData("SPY");
    const mstr = await fetchData("MSTR");
    await runPortfolioMix(spy, mstr);
}

runTest().catch(console.error);
