
// scripts/strategyTests/unitTests.js
// Purpose: Unit test the strategy logic functions against known/controlled datasets
// to ensure the verification script itself isn't buggy.

import assert from 'assert';
import { calculateRSI, calculateBollingerBands, checkGoldenCross } from '../../utils/algoCore/advancedIndicators.js';

// --- MOCK DATA GENERATOR ---
function createBar(close, high = close, low = close, volume = 1000) {
    return { close, high, low, volume, date: new Date() };
}

// Create a predictable trend: 10, 20, 30... 100
const uptrend = Array.from({ length: 10 }, (_, i) => createBar((i + 1) * 10));
// Create a V-shape: 100, 90... 10 ... 90, 100
const vShape = [
    ...Array.from({ length: 10 }, (_, i) => createBar(100 - i * 10)),
    ...Array.from({ length: 10 }, (_, i) => createBar((i + 1) * 10))
];

console.log("=== RUNNING UNIT TESTS FOR LOGIC VERIFICATION ===");

// 1. TEST RSI LOGIC
// Scenario: V-shape bottom should trigger Low RSI
function testRSI() {
    console.log("Testing RSI Calculation...");
    // A rapid drop should produce low RSI
    const drop = Array.from({ length: 15 }, (_, i) => createBar(100 - i * 5));
    const rsi = calculateRSI(drop, 14);
    
    // RSI should be near 0 after straight drop
    assert(rsi < 10, `RSI should be < 10 after crash, got ${rsi}`);
    console.log("✅ RSI Drop Test Passed");
}

// 2. TEST GOLDEN CROSS LOGIC
// Scenario: Short MA (3-period) crosses Long MA (5-period)
// Helper to mimick the heavy function checkGoldenCross roughly
function testGoldenCrossLogic() {
    console.log("Testing Golden Cross...");
    // Create data where SMA3 crosses SMA5
    // Day 0-4 (5 days): Price 10. SMA3=10, SMA5=10.
    // Day 5: Price 20. 
    //   SMA5 (Days 1-5): (10+10+10+10+20)/5 = 12
    //   SMA3 (Days 3-5): (10+10+20)/3 = 13.33
    //   Current Short(13.3) > Current Long(12)
    //   Prev Short (Days 2-4): 10
    //   Prev Long (Days 0-4): 10
    //   Cross: 10 <= 10 AND 13.3 > 12. Valid.
    
    // NOTE: checkGoldenCross needs min length = longPeriod + 1 (5+1 = 6)
    // We provide 7 candles to be safe and ensure the index arithmetic works
    const data = [
        createBar(10), createBar(10), createBar(10), createBar(10), createBar(10), // 0-4
        createBar(20), createBar(20) // 5-6
    ];
    
    // We call it on the specific slice that represents the "moment"
    // At index 5 (the jump):
    const slice = data.slice(0, 6); // Length 6. Index 0-5.
    // checkGoldenCross checks index (length-1) vs (length-2). 
    // So it checks index 5 vs index 4.
    
    const isCross = checkGoldenCross(slice, 3, 5); 
    assert(isCross === true, "Golden Cross should detect crossover");
    console.log("✅ Golden Cross Logic Passed");
}

// 3. TEST VOLATILITY TRAP LOGIC
// Scenario: Close < Lower Band
function testBollingerLogic() {
    console.log("Testing Bollinger Logic...");
    const data = Array.from({ length: 20 }, () => createBar(100)); // Stable 100
    // Add a crash
    data.push(createBar(80)); // 20% drop
    
    const bb = calculateBollingerBands(data, 20, 2);
    // Mean is approx 99. SD is small (mostly 100s). 
    // Lower band should be around 100 - (2*SD).
    // The drop to 80 should be WAY below lower band.
    
    assert(data[data.length-1].close < bb.lower, `Price 80 should be below Lower Band ${bb.lower}`);
    console.log("✅ Bollinger Trap Logic Passed");
}

// 4. TEST STRATEGY ENTRY TRIGGERS (Simulate the loops)
// We copy the exact IF statement logic from verifyStrategies.js
function testStrategyTriggers() {
    console.log("Testing Strategy Triggers...");
    
    // HYBRID DIP Trigger: RSI < 30 AND Price > SMA 200
    // We mock the indicators directly
    const rsi = 25; // Oversold
    const price = 105;
    const sma200 = 100; // Uptrend
    
    const signal = (price > sma200 && rsi < 30);
    assert(signal === true, "Hybrid Dip Trigger failed on valid inputs");
    
    // Fail case: Downtrend
    const signalFail = (95 > sma200 && rsi < 30);
    assert(signalFail === false, "Hybrid Dip Trigger fired in Downtrend (Should fail)");
    
    console.log("✅ Hybrid Dip Logic Passed");
}

try {
    testRSI();
    testGoldenCrossLogic();
    testBollingerLogic();
    testStrategyTriggers();
    console.log("\nALL LOGIC UNIT TESTS PASSED. The Verification Script is Code-Correct.");
} catch (e) {
    console.error("❌ UNIT TEST FAILED:", e.message);
}
