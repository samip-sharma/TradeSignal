
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

// Load Environment Variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

if (!process.env.ALPACA_API_KEY || !process.env.ALPACA_API_SECRET) {
    if(!process.env.CI) process.exit(1);
}

const alpaca = new Alpaca({
  paper: true,
  keyId: process.env.ALPACA_API_KEY,
  secretKey: process.env.ALPACA_API_SECRET,
});

// --- HELPER: SMA ---
function calculateSMA(data, period) {
    if (data.length < period) return null;
    let sum = 0;
    for (let i = 0; i < period; i++) {
        sum += data[data.length - 1 - i].close;
    }
    return sum / period;
}

// RATE LIMITER
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

// --- DATA FETCHING (Reusable) ---
// We will fetch BTC for Crypto tests and SPY for Stock tests
const ASSETS = {
    CRYPTO: "BTC/USD", // Alpaca Data V2 uses 'BTC/USD' or 'BTCUSD' depending on feed? Actually Alpaca Crypto is separate.
    // NOTE: For simplicity in this script using standard stocks to approximate unless 'BTCUSD' works directly.
    // Alpaca free tier has limited crypto history sometimes. Let's use MSTR as BTC proxy if BTC fails, but try BTCUSD first.
    CRYPTO_PROXY: "MSTR", 
    STOCK: "SPY",
    STOCK_SLOW: "DJI" // approximated by DIA
};

async function fetchData(ticker, timeframe='1Day', startDate='2020-01-01', endDate='2025-01-01') {
    console.log(`fetching ${ticker}...`);
    let alpacaTimeframe = alpaca.newTimeframe(1, alpaca.timeframeUnit.DAY);
    if(timeframe === '1Hour') alpacaTimeframe = alpaca.newTimeframe(1, alpaca.timeframeUnit.HOUR);

    try {
        const barsIterator = alpaca.getBarsV2(ticker, {
            start: new Date(startDate).toISOString(),
            end: new Date(endDate).toISOString(),
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

// ============================================
// STRATEGY 1: WHALE TRACKER (Volume Explosion)
// Logic: Volume > 2x Avg AND Bullish Close
// Asset: BTC (Proxy: MSTR for reliable data access)
// ============================================
function testWhaleTracker(data) {
    let balance = 10000;
    let position = null;
    let wins = 0; let total = 0;
    
    // Lookback for RVOL
    const VOL_PERIOD = 20;

    for(let i = VOL_PERIOD; i < data.length; i++) {
        const bar = data[i];
        const rvol = calculateRVOL(data.slice(0, i+1), VOL_PERIOD);
        
        // EXIT LOGIC (Simple Trailing or Fixed for test)
        // Video says "Wait weeks for one perfect setup". Suggests swing.
        // Let's hold for N days or until breakdown.
        if (position) {
            // Simple Exit: Close if Price drops below Low of Entry Candle (Tight stop)
            if (bar.close < position.low) {
                const pnl = (bar.close - position.price) * position.size;
                balance += pnl;
                if(pnl > 0) wins++;
                total++;
                position = null;
            }
        }
        // ENTRY LOGIC
        else {
           // "Volume DOUBLE the average AND Price Closes Strong"
           // Strong Close = Close near High (upper 30% of range)
           const range = bar.high - bar.low;
           const closeStrength = (bar.close - bar.low) / (range || 1);
           
           if (rvol >= 2.0 && closeStrength > 0.7) {
               position = { price: bar.close, size: balance / bar.close, low: bar.low };
           }
        }
    }
    return { name: "Whale Tracker (MSTR)", balance, wins, total, wr: (wins/total*100).toFixed(1) };
}

// ============================================
// STRATEGY 2: GOLDEN CROSS (The Myth)
// Logic: SMA 50 crosses SMA 200
// Asset: SPY (Success) vs MSTR (Failure)
// ============================================
function testGoldenCross(data, assetName) {
    let balance = 10000;
    let position = null;
    let wins = 0; let total = 0;

    for (let i = 202; i < data.length; i++) {
        const history = data.slice(0, i+1);
        const isCross = checkGoldenCross(history, 50, 200);
        
        // Simple Exit: Death Cross (50 crosses below 200)
        // Or simplified: Exit if Price < SMA 200
        const sma200 = calculateSMA(history, 200);

        if (position) {
            if (data[i].close < sma200) { // Trend change exit
                const pnl = (data[i].close - position.price) * position.size;
                balance += pnl;
                if(pnl > 0) wins++;
                total++;
                position = null;
            }
        } else {
             if (isCross) {
                 position = { price: data[i].close, size: balance / data[i].close };
             }
        }
    }
    return { name: `Golden Cross (${assetName})`, balance, wins, total, wr: (wins/total*100).toFixed(1) };
}

// ============================================
// STRATEGY 3: UNIVERSAL / HYBRID
// Logic: RSI < 30 (Panic) AND Price > SMA 200 (Trend)
// Asset: SPY
// ============================================
function testHybridDip(data, assetName) {
    let balance = 10000;
    let position = null;
    let wins = 0; let total = 0;

    for(let i = 202; i < data.length; i++) {
        const history = data.slice(0, i+1);
        const sma200 = calculateSMA(history, 200);
        const rsi = calculateRSI(history, 14);

        if (position) {
            // Exit: RSI Returns to Neutral (> 50) or Time Based?
            // Video says "Combine Mean Reversion and Trend". Usually exit on bounce.
            if (rsi > 55) {
                const pnl = (data[i].close - position.price) * position.size;
                balance += pnl;
                if(pnl > 0) wins++;
                total++;
                position = null;
            }
        } else {
            // "Buy Panic (RSI Dip) ONLY in Bull trend"
            if (history[i].close > sma200 && rsi < 30) {
                 position = { price: data[i].close, size: balance / data[i].close };
            }
        }
    }
    return { name: `Hybrid Dip (${assetName})`, balance, wins, total, wr: (wins/total*100).toFixed(1) };
}

// ============================================
// STRATEGY 4: VOLATILITY TRAP (Crypto)
// Logic: Price < Lower Bollinger Band AND RSI < 30 (The Stretch)
// Asset: MSTR (Crypto Proxy)
// ============================================
function testVolatilityTrap(data, assetName) {
    let balance = 10000;
    let position = null;
    let wins = 0; let total = 0;

    for(let i = 50; i < data.length; i++) {
        const history = data.slice(0, i+1);
        const bb = calculateBollingerBands(history, 20, 2); // Default
        const rsi = calculateRSI(history, 14);

        if (!bb) continue;

        if (position) {
            // Snap back: Exit at Middle Band (SMA)
            if (data[i].close >= bb.middle) {
                 const pnl = (data[i].close - position.price) * position.size;
                balance += pnl;
                if(pnl > 0) wins++;
                total++;
                position = null;
            }
        } else {
            // "Price crashes BELOW bands while RSI hits oversold"
            if (data[i].close < bb.lower && rsi < 35) {
                position = { price: data[i].close, size: balance / data[i].close };
            }
        }
    }
    return { name: `Vol Trap (${assetName})`, balance, wins, total, wr: (wins/total*100).toFixed(1) };
}

// ============================================
// STRATEGY 5: TRAILING STOP VS FIXED TARGET
// Logic: Compare Fixed Reward (1:2) vs Trailing Stop (ATR based or % from High)
// Asset: MSTR (Crypto)
// ============================================
function testTrailingVsFixed(data, assetName) {
    let balanceFixed = 10000;
    let balanceTrail = 10000;
    let positionFixed = null;
    let positionTrail = null;

    // Simple Entry: Breakout 20 Day High (Standard Trend)
    for(let i = 21; i < data.length; i++) {
        const history = data.slice(i-21, i);
        const high20 = Math.max(...history.map(b => b.high));
        
        // ENTRY SIGNAL for both
        if (data[i].close > high20) {
            // FIXED STRATEGY
            if (!positionFixed) {
                const stopDist = data[i].close * 0.05; // 5% risk
                positionFixed = { 
                    price: data[i].close, 
                    size: balanceFixed / data[i].close,
                    stop: data[i].close - stopDist,
                    target: data[i].close + (stopDist * 2) // 1:2 Risk/Reward
                };
            }
            // TRAILING STRATEGY
            if (!positionTrail) {
                positionTrail = {
                    price: data[i].close,
                    size: balanceTrail / data[i].close,
                    stop: data[i].close * 0.95, // Initial 5% stop
                    highestPrice: data[i].close
                };
            }
        }

        // MANAGE FIXED
        if (positionFixed) {
            if (data[i].low <= positionFixed.stop) {
                // Stopped out
                balanceFixed = positionFixed.size * positionFixed.stop;
                positionFixed = null;
            } else if (data[i].high >= positionFixed.target) {
                // Hit Target
                balanceFixed = positionFixed.size * positionFixed.target;
                positionFixed = null;
            }
        }

        // MANAGE TRAILING
        if (positionTrail) {
            if (data[i].high > positionTrail.highestPrice) {
                positionTrail.highestPrice = data[i].high;
                // Trail stop: 10% below highest high (Wide to catch moon shots)
                positionTrail.stop = positionTrail.highestPrice * 0.90; 
            }
            
            if (data[i].low <= positionTrail.stop) {
                balanceTrail = positionTrail.size * positionTrail.stop;
                positionTrail = null;
            }
        }
    }
    return [
        { name: `Fixed Target (${assetName})`, balance: balanceFixed, wins: 0, total: 0, wr: 'N/A' },
        { name: `Trailing Stop (${assetName})`, balance: balanceTrail, wins: 0, total: 0, wr: 'N/A' }
    ];
}

// ============================================
// STRATEGY 6: TREND BREAKOUT (Donchian)
// Logic: Buy 50 Day High. Sell 20 Day Low.
// Asset: SPY (Illusion/Failure) vs BTC (Success)
// ============================================
function testTrendBreakout(data, assetName) {
    let balance = 10000;
    let position = null;
    let wins = 0; let total = 0;

    for(let i = 51; i < data.length; i++) {
        const history = data.slice(i-51, i);
        const high50 = Math.max(...history.map(b => b.high));
        const low20 = Math.min(...history.slice(history.length-20).map(b => b.low));

        if (position) {
            // Exit: New 20 Day Low
            if (data[i].close < low20) {
                const pnl = (data[i].close - position.price) * position.size;
                balance += pnl;
                if(pnl > 0) wins++;
                total++;
                position = null;
            }
        } else {
            // Entry: New 50 Day High
            if (data[i].close > high50) {
                position = { price: data[i].close, size: balance / data[i].close };
            }
        }
    }
    return { name: `Trend Breakout (${assetName})`, balance, wins, total, wr: (wins/total*100).toFixed(1) };
}

// ============================================
// STRATEGY 7: DEEP DIP (Panic)
// Logic: RSI < 10 (Strict) vs RSI < 30 (Hybrid)
// Asset: SPY
// ============================================
function testDeepDip(data, assetName) {
    let balance = 10000;
    let position = null;
    let wins = 0; let total = 0;

    for(let i = 200; i < data.length; i++) {
        const history = data.slice(0, i+1);
        const sma200 = calculateSMA(history, 200);
        const rsi = calculateRSI(history, 14);

        if (position) {
            // Quick bounce exit
            if (rsi > 40) { // Exit earlier
                const pnl = (data[i].close - position.price) * position.size;
                balance += pnl;
                if(pnl > 0) wins++;
                total++;
                position = null;
            }
        } else {
            // Strict Panic: RSI < 10 AND Up Trend
            if (sma200 && data[i].close > sma200 && rsi < 15) { // <10 is rare, using <15 for test count
                position = { price: data[i].close, size: balance / data[i].close };
            }
        }
    }
    return { name: `Deep Dip RSI<15 (${assetName})`, balance, wins, total, wr: (wins/total*100).toFixed(1) };
}

// ============================================
// STRATEGY 8: LUNAR CYCLES (Approximation)
// Logic: Short New Moon, Long Full Moon
// Asset: MSTR
// ============================================
function testLunar(data, assetName) {
    let balance = 10000;
    let position = null; // 'LONG' or 'SHORT'
    let entryPrice = 0;
    let size = 0;
    let wins = 0; let total = 0;

    // Approx Synodic Month: 29.53 days
    // Reference New Moon: Jan 11, 2024 (Time: 11:57 UTC)
    const REF_NEW_MOON = new Date('2024-01-11T11:57:00Z').getTime();
    const CYCLE_MS = 29.53059 * 24 * 60 * 60 * 1000;

    const getPhase = (date) => {
        const diff = date.getTime() - REF_NEW_MOON;
        const phase = (diff / CYCLE_MS) % 1;
        return phase < 0 ? 1 + phase : phase;
    };

    for(let i = 0; i < data.length; i++) {
        const phase = getPhase(data[i].date);
        
        // Full Moon (0.48 - 0.52) -> Buy Zone
        if (phase > 0.48 && phase < 0.52 && (!position || position === 'SHORT')) {
            if (position === 'SHORT') {
                const pnl = (entryPrice - data[i].close) * size;
                balance += pnl;
                if(pnl > 0) wins++;
                total++;
            }
            position = 'LONG';
            size = balance / data[i].close;
            entryPrice = data[i].close;
        }
        
        // New Moon (0.98 - 0.02) -> Sell Zone
        if ((phase > 0.98 || phase < 0.02) && (!position || position === 'LONG')) {
             if (position === 'LONG') {
                const pnl = (data[i].close - entryPrice) * size;
                balance += pnl;
                if(pnl > 0) wins++;
                total++;
            }
            position = 'SHORT';
            size = balance / data[i].close;
            entryPrice = data[i].close;
        }
    }
    return { name: `Lunar Cycles (Approx) (${assetName})`, balance, wins, total, wr: (wins/total*100).toFixed(1) };
}

// ============================================
// MAIN RUNNER
// ============================================
async function runAllTests() {
    console.log("=== VERIFYING ALL 8 STRATEGIES ===");
    
    // 1. Fetch Data
    const spyData = await fetchData("SPY");
    const mstrData = await fetchData("MSTR"); // Proxy for BTC
    
    // 2. Run Tests
    const results = [];
    
    // 1. Whale
    results.push(testWhaleTracker(mstrData));

    // 2. Golden Cross
    results.push(testGoldenCross(spyData, "SPY")); // Good
    results.push(testGoldenCross(mstrData, "MSTR")); // Bad

    // 3. Hybrid Dip
    results.push(testHybridDip(spyData, "SPY"));

    // 4. Vol Trap
    results.push(testVolatilityTrap(mstrData, "MSTR"));

    // 5. Trailing vs Fixed (The "Good vs Great")
    results.push(...testTrailingVsFixed(mstrData, "MSTR"));

    // 6. Trend Breakout (The "Illusion")
    results.push(testTrendBreakout(spyData, "SPY"));
    results.push(testTrendBreakout(mstrData, "MSTR"));

    // 7. Deep Dip (Panic)
    results.push(testDeepDip(spyData, "SPY"));

    // 8. Lunar
    results.push(testLunar(mstrData, "MSTR"));

    // PRINT TABLE
    console.table(results.map(r => ({
        Strategy: r.name,
        'Final Balance': `$${r.balance.toFixed(0)}`,
        'Win Rate': `${r.wr}%`,
        'Trades': r.total
    })));
}

runAllTests().catch(console.error);
