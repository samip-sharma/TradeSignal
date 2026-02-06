
// utils/algoCore/advancedIndicators.js

// --- 1. RSI (Relative Strength Index) ---
export function calculateRSI(data, period = 14) {
    if (data.length < period + 1) return null;

    let gains = 0;
    let losses = 0;

    // Calculate initial Average Gain/Loss
    for (let i = 1; i <= period; i++) {
        const change = data[i].close - data[i - 1].close;
        if (change > 0) gains += change;
        else losses += Math.abs(change);
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    // Smoothed RSI for the rest of the data
    // We only need the RSI for the *last* candle to make a decision, 
    // but calculating the series improves accuracy for 'wilder' smoothing.
    // Optimization: Just iterate to the end.
    for (let i = period + 1; i < data.length; i++) {
        const change = data[i].close - data[i - 1].close;
        const currentGain = change > 0 ? change : 0;
        const currentLoss = change < 0 ? Math.abs(change) : 0;

        avgGain = ((avgGain * (period - 1)) + currentGain) / period;
        avgLoss = ((avgLoss * (period - 1)) + currentLoss) / period;
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

// --- 2. Bollinger Bands ---
export function calculateBollingerBands(data, period = 20, multiplier = 2) {
    if (data.length < period) return null;

    // Get the window
    const window = data.slice(data.length - period);
    
    // SMA
    const sum = window.reduce((acc, bar) => acc + bar.close, 0);
    const sma = sum / period;

    // Standard Deviation
    const squaredDiffs = window.map(bar => Math.pow(bar.close - sma, 2));
    const avgSquaredDiff = squaredDiffs.reduce((acc, val) => acc + val, 0) / period;
    const stdDev = Math.sqrt(avgSquaredDiff);

    return {
        upper: sma + (multiplier * stdDev),
        middle: sma,
        lower: sma - (multiplier * stdDev)
    };
}

// --- 3. Relative Volume (RVOL) ---
export function calculateRVOL(data, period = 20) {
    if (data.length < period + 1) return 1;

    const currentVol = data[data.length - 1].volume;
    const history = data.slice(data.length - period - 1, data.length - 1); // Exclude current bar
    const avgVol = history.reduce((acc, bar) => acc + bar.volume, 0) / period;

    return avgVol > 0 ? currentVol / avgVol : 1;
}

// --- 4. Golden Cross (SMA Crossover) ---
export function checkGoldenCross(data, shortPeriod = 50, longPeriod = 200) {
    if (data.length < longPeriod + 1) return false;

    const getSMA = (endIdx, period) => {
        const slice = data.slice(endIdx - period + 1, endIdx + 1);
        const sum = slice.reduce((acc, b) => acc + b.close, 0);
        return sum / period;
    };

    const currentShort = getSMA(data.length - 1, shortPeriod);
    const currentLong = getSMA(data.length - 1, longPeriod);
    
    const prevShort = getSMA(data.length - 2, shortPeriod);
    const prevLong = getSMA(data.length - 2, longPeriod);

    // Bullish Cross: Short crosses ABOVE Long
    return prevShort <= prevLong && currentShort > currentLong;
}
