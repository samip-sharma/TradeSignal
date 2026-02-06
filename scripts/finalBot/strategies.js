
import { calculateRSI, calculateBollingerBands, calculateRVOL, calculateSMA } from './indicators.js';

export const STRATEGY_CONFIG = {
    VOL_TRAP: {
        ticker: 'MSTR', // Or BTC
        rsiThreshold: 35, // Buy when RSI < 35
        bbDeviation: 2,   // Price < Lower Band
        stopLoss: 0.85,   // 15% Max Loss
        trailPct: 0.90    // 10% Trailing Stop
    },
    WHALE_TRACKER: {
        ticker: 'MSTR',
        rvolThreshold: 2.0, // Volume > 2x Avg
        closeTopPct: 0.7,   // Close in top 30% of range
        stopLoss: 0.95,     // 5% Stop (Tight)
        trailPct: 0.95      // 5% Trail
    },
    HYBRID_DIP: {
        ticker: 'SPY',
        rsiThreshold: 30, // Panic
        smaFilter: 200,   // Trend
        stopLoss: 0.90,
        trailPct: 0.95    // Added trail for safety
    }
};

export function getVolTrapSignal(data, index) {
    const history = data.slice(0, index + 1);
    const rsi = calculateRSI(history, 14);
    const bb = calculateBollingerBands(history, 20, 2);
    const price = data[index].close;
    
    if (rsi < STRATEGY_CONFIG.VOL_TRAP.rsiThreshold && price < bb.lower) {
        return {
            strategy: 'Vol Trap',
            price: price,
            stop: price * STRATEGY_CONFIG.VOL_TRAP.stopLoss,
            trail: price * STRATEGY_CONFIG.VOL_TRAP.trailPct
        };
    }
    return null;
}

export function getWhaleSignal(data, index) {
    const history = data.slice(0, index + 1);
    
    // --- BEAR MARKET FILTER ---
    // Only buy breakouts if we are in a Long Term Uptrend.
    // Buying breakouts in a Bear Market is suicide.
    const sma200 = calculateSMA(history, 200);
    if (sma200 && data[index].close < sma200) return null;

    const rvol = calculateRVOL(history, 20);
    const bar = data[index];
    const range = bar.high - bar.low;
    const closeStrength = range > 0 ? (bar.close - bar.low) / range : 0;
    
    if (rvol > STRATEGY_CONFIG.WHALE_TRACKER.rvolThreshold && closeStrength > STRATEGY_CONFIG.WHALE_TRACKER.closeTopPct) {
        return {
            strategy: 'Whale Tracker',
            price: bar.close,
            stop: bar.close * STRATEGY_CONFIG.WHALE_TRACKER.stopLoss,
            trail: bar.close * STRATEGY_CONFIG.WHALE_TRACKER.trailPct
        };
    }
    return null;
}

export function getHybridDipSignal(data, index) {
    const history = data.slice(0, index + 1);
    const rsi = calculateRSI(history, 14);
    
    // We need to calculate SMA ourselves if not imported, or use loop
    // Let's assume calculateSMA works.
    let sma200 = null;
    if(history.length >= 200) {
        const sum = history.slice(history.length-200).reduce((a,b)=>a+b.close,0);
        sma200 = sum/200;
    }
    
    if (sma200 && data[index].close > sma200 && rsi < STRATEGY_CONFIG.HYBRID_DIP.rsiThreshold) {
        return {
            strategy: 'Hybrid Dip',
            price: data[index].close,
            stop: data[index].close * STRATEGY_CONFIG.HYBRID_DIP.stopLoss,
            trail: data[index].close * STRATEGY_CONFIG.HYBRID_DIP.trailPct
        };
    }
    return null;
}
