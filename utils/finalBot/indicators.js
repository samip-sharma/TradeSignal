
// scripts/finalBot/indicators.js

export function calculateSMA(data, period) {
    if (data.length < period) return null;
    let sum = 0;
    for (let i = 0; i < period; i++) {
        sum += data[data.length - 1 - i].close;
    }
    return sum / period;
}

export function calculateRSI(data, period = 14) {
    if (data.length < period + 1) return null;
    let gains = 0;
    let losses = 0;
    for (let i = 1; i <= period; i++) {
        const change = data[i].close - data[i - 1].close;
        if (change > 0) gains += change;
        else losses += Math.abs(change);
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
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

export function calculateBollingerBands(data, period = 20, multiplier = 2) {
    if (data.length < period) return null;
    const window = data.slice(data.length - period);
    const sum = window.reduce((acc, bar) => acc + bar.close, 0);
    const sma = sum / period;
    const squaredDiffs = window.map(bar => Math.pow(bar.close - sma, 2));
    const avgSquaredDiff = squaredDiffs.reduce((acc, val) => acc + val, 0) / period;
    const stdDev = Math.sqrt(avgSquaredDiff);

    return {
        upper: sma + (multiplier * stdDev),
        middle: sma,
        lower: sma - (multiplier * stdDev)
    };
}

export function calculateRVOL(data, period = 20) {
    if (data.length < period + 1) return 1;
    const currentVol = data[data.length - 1].volume;
    const history = data.slice(data.length - period - 1, data.length - 1); 
    const avgVol = history.reduce((acc, bar) => acc + bar.volume, 0) / period;
    return avgVol > 0 ? currentVol / avgVol : 1;
}
