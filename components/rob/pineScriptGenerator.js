/**
 * @file components/rob/pineScriptGenerator.js
 * @description Generates a robust Pine Script v5 to visualize the key dates and price levels of a trade.
 */

function toPineTimestamp(dateString) {
  if (!dateString) return "na";
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return "na";
  return date.getTime();
}

export function generateTradePineScript(trade) {
  if (!trade) return "// No trade data provided.";

  const entryDateString = new Date(trade.entryDate).toISOString().split("T")[0];
  const scriptTitle = `Trade Breakdown: ${trade.type} on ${entryDateString}`;

  const entryTimestamp = toPineTimestamp(trade.entryDate);
  const highPivotTimestamp = toPineTimestamp(trade.entryPivotHigh?.date);
  const lowPivotTimestamp = toPineTimestamp(trade.entryPivotLow?.date);

  // --- 2. Create an Array of ALL Potential Vertical Line Events ---
  const allEvents = [];
  if (trade.ingressDate) {
    allEvents.push({
      timestamp: toPineTimestamp(trade.ingressDate),
      label: "1. Start Date",
      color: "color.gray",
    });
  }
  if (trade.lookbackEndDate) {
    allEvents.push({
      timestamp: toPineTimestamp(trade.lookbackEndDate),
      label: `2. ${trade.lookbackPeriod} Bars Ahead`,
      color: "color.purple",
    });
  }
  if (trade.entryPivotHigh?.date) {
    allEvents.push({
      timestamp: highPivotTimestamp,
      label: "3. Stoploss High Pivot",
      color: "color.green",
    });
  }
  if (trade.entryPivotLow?.date) {
    allEvents.push({
      timestamp: lowPivotTimestamp,
      label: "3. Stoploss Low Pivot",
      color: "color.red",
    });
  }
  if (trade.entryDate) {
    allEvents.push({
      timestamp: entryTimestamp,
      label: "4. Entry",
      color: "color.blue",
    });
  }
  if (trade.exitPivot?.date) {
    allEvents.push({
      timestamp: toPineTimestamp(trade.exitPivot.date),
      label: "5) circum entry",
      color: "color.orange",
    });
  }

  // --- NEW: Group events by timestamp to merge labels on the same bar ---
  const eventsByTimestamp = {};
  for (const event of allEvents) {
    if (event.timestamp !== "na") {
      if (!eventsByTimestamp[event.timestamp]) {
        eventsByTimestamp[event.timestamp] = {
          labels: [],
          color: event.color, // Use the color of the first event at this timestamp
        };
      }
      eventsByTimestamp[event.timestamp].labels.push(event.label);
    }
  }

  const processedEvents = Object.entries(eventsByTimestamp).map(
    ([timestamp, data]) => ({
      timestamp: parseInt(timestamp),
      // Join labels with a newline character for multi-line display
      label: `"${data.labels.join("\\n")}"`,
      color: data.color,
    })
  );

  if (processedEvents.length === 0) {
    return "// No valid date markers to plot.";
  }

  const pointTimestamps = processedEvents.map((p) => p.timestamp);
  const pointLabels = processedEvents.map((p) => p.label);
  const pointColors = processedEvents.map((p) => p.color);

  // --- 3. Generate the Pine Script ---
  let script = `//@version=5
indicator("${scriptTitle}", overlay=true, max_labels_count=500)

// --- Horizontal Line Plotting ---
var int entry_ts = ${entryTimestamp || "na"}
var int high_pivot_ts = ${highPivotTimestamp || "na"}
var int low_pivot_ts = ${lowPivotTimestamp || "na"}

float stoplossHighPrice = ${trade.entryPivotHigh?.high || "na"}
plot(time >= high_pivot_ts ? stoplossHighPrice : na, title="Stoploss High", color=color.green, style=plot.style_linebr, linewidth=1)

float stoplossLowPrice = ${trade.entryPivotLow?.low || "na"}
plot(time >= low_pivot_ts ? stoplossLowPrice : na, title="Stoploss Low", color=color.red, style=plot.style_linebr, linewidth=1)

float projectedExitPrice = ${trade.projectedExit || "na"}
plot(time >= entry_ts ? projectedExitPrice : na, title="Projected Exit", color=color.yellow, style=plot.style_linebr, linewidth=2)

// --- Vertical Date Markers (with merged labels) ---
var int[] event_timestamps = array.from(${pointTimestamps.join(",")})
var string[] event_labels = array.from(${pointLabels.join(",")})
var color[] event_colors = array.from(${pointColors.join(",")})
var bool[] plotted_flags = array.new_bool(array.size(event_timestamps), false)

for i = 0 to array.size(event_timestamps) - 1
    if not array.get(plotted_flags, i) and time >= array.get(event_timestamps, i)
        int ts = array.get(event_timestamps, i)
        color c = array.get(event_colors, i)
        line.new(ts, low, ts, high, xloc=xloc.bar_time, color=color.new(c, 70), style=line.style_dotted)
        label.new(ts, high, array.get(event_labels, i), xloc=xloc.bar_time, yloc=yloc.abovebar, style=label.style_label_down, color=c, textcolor=color.white)
        array.set(plotted_flags, i, true)
`;

  return script;
}
