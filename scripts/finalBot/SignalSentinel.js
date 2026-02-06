
import dotenv from 'dotenv';
import path from 'path';
import Alpaca from '@alpacahq/alpaca-trade-api';
import { getVolTrapSignal, getWhaleSignal, getHybridDipSignal } from '../../utils/finalBot/strategies.js';

// Load env (works locally and in CI if secrets injected)
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const DISCORD_URL = process.env.DISCORD_WEBHOOK_URL;

if (!DISCORD_URL) {
    console.error("❌ No DISCORD_WEBHOOK_URL found.");
    process.exit(1);
}

const alpaca = new Alpaca({
    keyId: process.env.ALPACA_API_KEY,
    secretKey: process.env.ALPACA_API_SECRET,
    paper: true,
});

async function sendDiscordAlert(signal, ticker) {
    const color = signal.strategy === 'Vol Trap' ? 15158332 : // RED
                  signal.strategy === 'Whale Tracker' ? 3066993 : // GREEN
                  3447003; // BLUE (Hybrid)

    const embed = {
        title: `🚨 BUY SIGNAL: ${ticker}`,
        description: `**Strategy**: ${signal.strategy}\n**Price**: $${signal.price.toFixed(2)}`,
        color: color,
        fields: [
            { name: "Stop Loss", value: `$${signal.stop.toFixed(2)}`, inline: true },
            { name: "Trailing Stop", value: `$${signal.trail.toFixed(2)}`, inline: true },
            { name: "Time", value: new Date().toISOString(), inline: false }
        ],
        footer: { text: "Sentinel Bot • Verified AlgoCore" }
    };

    try {
        await fetch(DISCORD_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ embeds: [embed] })
        });
        console.log(`✅ Sent Alert for ${ticker}`);
    } catch (e) {
        console.error("Failed to send Discord webhook", e);
    }
}

// Helper to normalized Alpaca Data
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

async function checkTicker(ticker) {
    console.log(`Checking ${ticker}...`);
    let startDate = new Date();
    startDate.setDate(startDate.getDate() - 200); // Need 200 days for SMA

    try {
        const barsIterator = alpaca.getBarsV2(ticker, {
            start: startDate.toISOString(),
            end: new Date().toISOString(),
            timeframe: alpaca.newTimeframe(1, alpaca.timeframeUnit.DAY),
        });
        const rawBars = [];
        for await (const bar of barsIterator) rawBars.push(bar);
        const data = normalizeAlpacaData(rawBars);

        if (data.length < 200) return;

        const i = data.length - 1; // Check LAST BAR (Current)
        
        let signal = null;
        if (ticker === 'MSTR' || ticker === 'COIN') {
            signal = getVolTrapSignal(data, i) || getWhaleSignal(data, i);
        } else if (ticker === 'SPY') {
            signal = getHybridDipSignal(data, i);
        }

        if (signal) {
            console.log(`🔥 SIGNAL FOUND: ${ticker} (${signal.strategy})`);
            await sendDiscordAlert(signal, ticker);
        } else {
            console.log(`No signal for ${ticker}`);
        }

    } catch (e) {
        console.error(`Error checking ${ticker}:`, e);
    }
}

async function runSentinel() {
    console.log("=== SENTINEL RUNNING ===");
    await checkTicker('MSTR');
    await checkTicker('COIN');
    await checkTicker('SPY');
    console.log("Done.");
}

runSentinel();
