
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import Alpaca from '@alpacahq/alpaca-trade-api';
import { getVolTrapSignal, getWhaleSignal, getHybridDipSignal } from './strategies.js';

// --- CONFIG ---
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
const TIMEFRAME = '1Day';
const INITIAL_CASH = 10000;
const POSITION_LIMIT = 3; 

// --- SETUP ALPACA ---
const alpaca = new Alpaca({
  paper: true,
  keyId: process.env.ALPACA_API_KEY,
  secretKey: process.env.ALPACA_API_SECRET,
});

async function runBacktest() {
    console.log("=== FINAL PORTFOLIO BACKTEST: THE MACHINE ===");
    
    // 1. DATA FETCHING
    const spyData = await fetchData("SPY");
    const mstrData = await fetchData("MSTR"); 

    if (spyData.length === 0 || mstrData.length === 0) {
        console.error("Failed to fetch data.");
        return;
    }

    // 2. SIMULATION STATE
    let cash = INITIAL_CASH;
    let portfolioValue = INITIAL_CASH;
    const positions = []; // { ticker, strategy, shares, entryPrice, stop, trail, highestClose }
    const history = [];   // Portfolio value over time
    const tradeLog = [];  // Completed trades

    // 3. MERGE TIMELINES
    const allDates = new Set([
        ...spyData.map(d => d.date.getTime()),
        ...mstrData.map(d => d.date.getTime())
    ]);
    const sortedDates = Array.from(allDates).sort((a,b)=>a-b);

    // 4. MAIN LOOP
    console.log(`Simulating ${sortedDates.length} trading days...`);
    
    // Warmup period for indicators (200 days)
    for (let t = 200; t < sortedDates.length; t++) {
        const dateKey = sortedDates[t];
        const dateObj = new Date(dateKey);
        
        // Find daily bars
        const spyIdx = spyData.findIndex(d => d.date.getTime() === dateKey);
        const mstrIdx = mstrData.findIndex(d => d.date.getTime() === dateKey);
        const spyBar = spyIdx !== -1 ? spyData[spyIdx] : null;
        const mstrBar = mstrIdx !== -1 ? mstrData[mstrIdx] : null;

const FRICTION_PCT = 0.002; // 0.1% Entry + 0.1% Exit (Slippage + Fees)

// --- A. POSITION MANAGEMENT (Exits) ---
        for (let i = positions.length - 1; i >= 0; i--) {
            const pos = positions[i];
            const bar = pos.ticker === 'SPY' ? spyBar : mstrBar;
            
            if (!bar) continue; 

            let exitPrice = null;
            let reason = '';

            // Stop Loss
            if (bar.low <= pos.stop) {
                exitPrice = pos.stop;
                reason = 'Stop Loss';
            }
            // Trailing Stop Hit
            else if (bar.low <= pos.trail) {
                exitPrice = pos.trail;
                reason = 'Trailing Stop';
            }
            
            if (exitPrice) {
                // EXECUTE SELL
                const proceeds = exitPrice * pos.shares;
                const costBasis = pos.entryPrice * pos.shares;
                
                // COST CALCULATION
                // Friction applies to Entry (Cost added) and Exit (Proceeds reduced)
                // Approx: Total Trade Value * 0.002
                const frictionCost = (proceeds + costBasis) * (FRICTION_PCT / 2);
                
                const profit = proceeds - costBasis - frictionCost;
                cash += (proceeds - frictionCost); // Entry friction assumed paid from cash spread previously or just deducted here for neatness
                
                // Correction: In backtest we usually just deduct total friction from PnL
                
                tradeLog.push({
                    date: dateObj,
                    ticker: pos.ticker,
                    strategy: pos.strategy,
                    profit: profit,
                    returnPct: ((profit)/costBasis) * 100,
                    reason: reason
                });
                positions.splice(i, 1);
            } else {
                // UPDATE TRAIL
                if (bar.close > pos.highestClose) {
                    pos.highestClose = bar.close;
                    // Recalculate trail distance based on original pct
                    // Vol Trap: 10%, Whale: 5%
                    const trailPct = pos.strategy === 'Whale Tracker' ? 0.95 : 0.90; 
                    const newTrail = bar.close * trailPct;
                    if (newTrail > pos.trail) pos.trail = newTrail;
                }
            }
        }

        // ... [Signal Generation Code Omitted for brevity, unchanged] ...

        // Log Daily Equity
        portfolioValue = getEquity(cash, positions, spyBar, mstrBar);
        history.push({ date: dateObj, equity: portfolioValue });
    }

    // 5. FINAL REPORT
    generateReport(history, tradeLog, portfolioValue, INITIAL_CASH);
}

// ...

function generateReport(history, tradeLog, finalVal, initialVal) {
    console.log("\n--- STRESS TEST REPORT (Inc. Fees/Slippage 0.2%) ---");
    const totalReturn = ((finalVal - initialVal) / initialVal) * 100;
    
    // Drawdown
    let peak = -Infinity;
    let maxDD = 0;
    history.forEach(h => {
        if (h.equity > peak) peak = h.equity;
        const dd = (peak - h.equity) / peak;
        if (dd > maxDD) maxDD = dd;
    });

    // Profit Factor & Win Rate
    const wins = tradeLog.filter(t => t.profit > 0);
    const losses = tradeLog.filter(t => t.profit <= 0);
    const grossWin = wins.reduce((a, b) => a + b.profit, 0);
    const grossLoss = Math.abs(losses.reduce((a, b) => a + b.profit, 0));
    const pf = grossLoss === 0 ? 999 : (grossWin / grossLoss);

    console.log(`Final Equity:   $${finalVal.toFixed(2)}`);
    console.log(`Total Return:   ${totalReturn.toFixed(2)}%`);
    console.log(`Max Drawdown:   -${(maxDD * 100).toFixed(2)}%`);
    console.log(`Profit Factor:  ${pf.toFixed(2)}`);
    console.log(`Total Trades:   ${tradeLog.length}`);
    console.log(`Win Rate:       ${((wins.length / tradeLog.length) * 100).toFixed(1)}%`);

    console.log("\n--- BEAR MARKET CHECK (2022) ---");
    const trades2022 = tradeLog.filter(t => t.date.getFullYear() === 2022);
    const profit2022 = trades2022.reduce((a, b) => a + b.profit, 0);
    console.log(`2022 PnL:       $${profit2022.toFixed(2)}`);
    console.log(`2022 Trades:    ${trades2022.length}`);
    console.log(`Verdict:        ${profit2022 > -3000 ? "✅ SURVIVED" : "❌ FAILED"} (Benchmark MSTR: -74%)`);

    console.log("\n--- STRATEGY BREAKDOWN ---");
    const strats = {};
    tradeLog.forEach(t => {
        if (!strats[t.strategy]) strats[t.strategy] = { trades: 0, profit: 0, wins: 0 };
        strats[t.strategy].trades++;
        strats[t.strategy].profit += t.profit;
        if(t.profit > 0) strats[t.strategy].wins++;
    });
    console.table(strats);
}

// --- DATA FETCHING (Duplicate to avoid import issues for now) ---
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
        return [];
    }
}

runBacktest().catch(console.error);
