
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import Alpaca from '@alpacahq/alpaca-trade-api';
import { getVolTrapSignal, getWhaleSignal, getHybridDipSignal } from './strategies.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const alpaca = new Alpaca({
  paper: true,
  keyId: process.env.ALPACA_API_KEY,
  secretKey: process.env.ALPACA_API_SECRET,
});

// --- CONFIG ---
const INITIAL_CASH = 10000;
const BASKET = ['MSTR', 'COIN', 'NVDA', 'AMD', 'QQQ']; // The Expanded Universe
const MAX_POSITIONS = 5; // Allow more simultaneous trades

// --- DATA FETCHING ---
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
    // COIN IPO'd April 2021, so start later to avoid errors or handle empty
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
        console.log(`Error fetching ${ticker}: ${e.message}`);
        return [];
    }
}

async function runBasketTest() {
    console.log("=== RUNNING BASKET TEST (5 TICKERS) ===");
    
    // 1. Load All Data
    const marketData = {};
    for (const t of BASKET) {
        marketData[t] = await fetchData(t);
    }
    
    // 2. Align Dates
    const allDates = new Set();
    Object.values(marketData).forEach(data => {
        data.forEach(d => allDates.add(d.date.getTime()));
    });
    const sortedDates = Array.from(allDates).sort((a,b)=>a-b);
    
    // 3. Sim Loop
    let cash = INITIAL_CASH;
    let positions = [];
    const tradeLog = [];
    let history = [];
    
    // Warmup
    for (let t = 200; t < sortedDates.length; t++) {
        const dateKey = sortedDates[t];
        const dateObj = new Date(dateKey);
        
        // Update Portfolio Value
        let equity = cash;
        positions.forEach(p => {
            const data = marketData[p.ticker];
            const bar = data.find(d => d.date.getTime() === dateKey) || data[data.length-1]; // Fallback? No, just use last known if missing (holiday)
            // Better: Find index
            const idx = data.findIndex(d => d.date.getTime() === dateKey);
            if(idx !== -1) p.lastPrice = data[idx].close;
            equity += (p.shares * p.lastPrice);
        });
        
        // A. MANAGE EXITS
        for (let i = positions.length - 1; i >= 0; i--) {
            const pos = positions[i];
            const data = marketData[pos.ticker];
            const idx = data.findIndex(d => d.date.getTime() === dateKey);
            
            if (idx === -1) continue; // No data today for this ticker
            const bar = data[idx];
            
            let exitPrice = null;
            let reason = '';
            
            if (bar.low <= pos.stop) { exitPrice = pos.stop; reason = 'Stop Loss'; }
            else if (bar.low <= pos.trail) { exitPrice = pos.trail; reason = 'Trailing Stop'; }
            
            if (exitPrice) {
                const proceeds = exitPrice * pos.shares;
                const profit = proceeds - (pos.entryPrice * pos.shares);
                cash += proceeds;
                tradeLog.push({ ticker: pos.ticker, strategy: pos.strategy, profit, reason, date: dateObj });
                positions.splice(i, 1);
            } else {
                // Update Trail
                if (bar.close > pos.highestClose) {
                    pos.highestClose = bar.close;
                    const trailPct = pos.strategy === 'Whale Tracker' ? 0.95 : 0.90;
                    const newTrail = bar.close * trailPct;
                    if (newTrail > pos.trail) pos.trail = newTrail;
                }
            }
        }
        
        // B. ENTRIES
        // Logic: 
        // - MSTR, COIN, NVDA, AMD -> Use Vol Trap & Whale (High Beta)
        // - QQQ -> Use Hybrid Dip (Index)
        
        if (positions.length < MAX_POSITIONS) {
            // Check every ticker
            for (const ticker of BASKET) {
                if (cash < 1000) break; // Min cash
                if (positions.find(p => p.ticker === ticker)) continue; // One pos per ticker
                
                const data = marketData[ticker];
                const idx = data.findIndex(d => d.date.getTime() === dateKey);
                if (idx < 200) continue;
                
                const bar = data[idx];
                const size = (cash + getPosVal(positions)) * 0.20; // 20% allocation per trade
                if (cash < size) continue;
                
                let signal = null;
                
                if (['MSTR', 'COIN', 'NVDA', 'AMD'].includes(ticker)) {
                    // Try Vol Trap
                    const sig1 = getVolTrapSignal(data, idx);
                    if (sig1) signal = sig1;
                    else {
                        // Try Whale
                        const sig2 = getWhaleSignal(data, idx);
                        if (sig2) signal = sig2;
                    }
                } else if (['QQQ'].includes(ticker)) {
                    // Hybrid Dip
                    const sig3 = getHybridDipSignal(data, idx);
                    if (sig3) signal = sig3;
                }
                
                if (signal) {
                    const shares = size / signal.price;
                    positions.push({
                        ticker, strategy: signal.strategy, entryPrice: signal.price,
                        shares, stop: signal.stop, trail: signal.trail,
                        highestClose: signal.price, lastPrice: signal.price
                    });
                    cash -= size;
                }
            }
        }
        
        history.push({ date: dateObj, equity });
    }
    
    // REPORT
    const finalVal = history[history.length-1].equity;
    const totalReturn = ((finalVal - INITIAL_CASH) / INITIAL_CASH) * 100;
    
    console.log(`\n=== BASKET TEST RESULTS ===`);
    console.log(`Final Equity:  $${finalVal.toFixed(2)}`);
    console.log(`Total Return:  ${totalReturn.toFixed(2)}%`);
    console.log(`Total Trades:  ${tradeLog.length} (Avg ${(tradeLog.length/5).toFixed(1)}/year)`);
    
    const countByTicker = {};
    tradeLog.forEach(t=>{
        if(!countByTicker[t.ticker]) countByTicker[t.ticker]=0;
        countByTicker[t.ticker]++;
    });
    console.table(countByTicker);
}

function getPosVal(positions) {
    return positions.reduce((sum, p) => sum + (p.shares * p.lastPrice), 0);
}

runBasketTest().catch(console.error);
