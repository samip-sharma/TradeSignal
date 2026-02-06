
import dotenv from 'dotenv';
import path from 'path';
import Alpaca from '@alpacahq/alpaca-trade-api';
// Use the EXACT path the API route uses to test resolution
import { getVolTrapSignal } from '../utils/finalBot/strategies.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const alpaca = new Alpaca({
    keyId: process.env.ALPACA_API_KEY,
    secretKey: process.env.ALPACA_API_SECRET,
    paper: true,
});

async function testFetch() {
    console.log("Testing Alpaca Fetch...");
    try {
        const barsIterator = alpaca.getBarsV2('MSTR', {
            start: '2024-01-01T00:00:00.000Z',
            end: '2024-01-10T00:00:00.000Z',
            timeframe: alpaca.newTimeframe(1, alpaca.timeframeUnit.DAY),
        });
        const bars = [];
        for await (const b of barsIterator) bars.push(b);
        console.log(`Fetched ${bars.length} bars.`);
    } catch(e) {
        console.error("Fetch Failed:", e);
    }
}

testFetch();
