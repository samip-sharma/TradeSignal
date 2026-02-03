/**
 * @file utils/algoCore/pivotListPineScriptGenerator.js
 * @description Generates a Pine Script v5 to visualize a list of high/low pivots.
 */

/**
 * Converts a JavaScript Date or date-string into a Unix timestamp (milliseconds).
 * This is necessary for Pine Script's time-based functions.
 * @param {string | Date} dateString - The date to convert.
 * @returns {number | null} A Unix timestamp number or null if invalid.
 */
function toPineTimestamp(dateString) {
  if (!dateString) return null;
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return null;
  return date.getTime();
}

/**
 * Generates a Pine Script v5 string to plot a list of pivot points.
 * @param {Array} pivots - An array of pivot objects from the API { date, type, price }.
 * @param {string} ticker - The ticker symbol, for the script title.
 * @returns {string} The complete Pine Script code.
 */
export function generatePivotListPineScript(pivots, ticker) {
  if (!pivots || pivots.length === 0) {
    return "// No pivots found to generate a script.";
  }

  const scriptTitle = `Pivot Points for ${ticker}`;

  // --- 1. Convert JavaScript pivot data into Pine Script array-friendly strings ---
  const pivotTimestamps = [];
  const pivotPrices = [];
  const pivotTypes = []; // We'll use 1 for High, -1 for Low

  for (const pivot of pivots) {
    const timestamp = toPineTimestamp(pivot.date);
    if (timestamp) {
      pivotTimestamps.push(timestamp);
      pivotPrices.push(pivot.price.toFixed(4)); // Use a few decimal places for precision
      pivotTypes.push(pivot.type === "High" ? 1 : -1);
    }
  }

  // --- 2. Generate the Pine Script using the prepared data ---
  const script = `//@version=5
indicator("${scriptTitle}", overlay=true, max_labels_count=500)

// --- Define the pivot data using arrays ---
// 'var' ensures these arrays are initialized only once for performance.
var int[] pivot_timestamps = array.from(${pivotTimestamps.join(",")})
var float[] pivot_prices = array.from(${pivotPrices.join(",")})
var int[] pivot_types = array.from(${pivotTypes.join(",")})

// This array prevents labels from being redrawn on every bar.
var bool[] plotted_flags = array.new_bool(array.size(pivot_timestamps), false)

// --- Loop through the pivots and plot them ---
// This loop runs on each bar, but the flag array ensures each label is drawn only once.
for i = 0 to array.size(pivot_timestamps) - 1
    // Check if the pivot's time has arrived and if it hasn't been plotted yet.
    if not array.get(plotted_flags, i) and time >= array.get(pivot_timestamps, i)
        int ts = array.get(pivot_timestamps, i)
        float price = array.get(pivot_prices, i)
        int type = array.get(pivot_types, i)

        // Customize the label based on the pivot type
        if type == 1 // High Pivot
            label.new(
                 x=ts, 
                 y=price, 
                 text='H', 
                 xloc=xloc.bar_time, 
                 yloc=yloc.abovebar, 
                 color=color.new(#dc3545, 20), // Red background
                 textcolor=color.white,
                 style=label.style_label_down,
                 tooltip = str.tostring(price, "0.00")
                 )
        else // Low Pivot
            label.new(
                 x=ts, 
                 y=price, 
                 text='L', 
                 xloc=xloc.bar_time, 
                 yloc=yloc.belowbar, 
                 color=color.new(#28a745, 20), // Green background
                 textcolor=color.white,
                 style=label.style_label_up,
                 tooltip = str.tostring(price, "0.00")
                 )

        // Mark this pivot as plotted to prevent it from being drawn again.
        array.set(plotted_flags, i, true)
`;

  return script;
}
