/**
 * @file components/rob/TradeInfo.js
 * @description A component to display the detailed breakdown of a single trade's generation logic, styled with Tailwind CSS.
 */

import React, { useState } from "react";
import { generateTradePineScript } from "./pineScriptGenerator"; // Import the generator

// --- REVISED HELPER FUNCTION TO FORMAT DATE & TIME ---
const formatDateTime = (dateString) => {
  if (!dateString) return "N/A";
  try {
    const date = new Date(dateString);
    // Use Intl.DateTimeFormat to display the date and time in the US Eastern timezone,
    // which aligns with the market's trading day. This prevents the UTC-to-local conversion
    // from shifting the displayed date to the previous day.
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      dateStyle: "medium", // e.g., "Apr 4, 2025"
      timeStyle: "short", // e.g., "4:00 PM"
    }).format(date);
  } catch (e) {
    console.error("Could not format date:", dateString, e);
    return "Invalid Date";
  }
};

const TradeInfo = ({ trade }) => {
  // State for the copy button text
  const [copyButtonText, setCopyButtonText] = useState("Copy Pine Script");

  const {
    ingressDate,
    lookbackPeriod,
    lookbackEndDate,
    entryPivotHigh,
    entryPivotLow,
    entryDate,
    entryPrice,
    exitPivot,
    projectedExit,
    type,
  } = trade;

  // Function to handle the copy-to-clipboard action
  const handleCopyPineScript = () => {
    const script = generateTradePineScript(trade);
    navigator.clipboard
      .writeText(script)
      .then(() => {
        setCopyButtonText("Copied!");
        setTimeout(() => setCopyButtonText("Copy Pine Script"), 2000); // Reset after 2 seconds
      })
      .catch((err) => {
        console.error("Failed to copy text: ", err);
        setCopyButtonText("Failed to Copy");
        setTimeout(() => setCopyButtonText("Copy Pine Script"), 2000);
      });
  };

  return (
    <div className="p-6 bg-black/20 rounded-lg text-zinc-300 border border-zinc-800/50 leading-relaxed">
      <div className="flex justify-between items-center border-b border-zinc-700/50 pb-3 mb-4">
        <h4 className="m-0 text-white font-semibold">Trade Generation Breakdown</h4>
        <button
          onClick={handleCopyPineScript}
          className={`
            px-3 py-1.5 text-xs font-medium rounded border transition-colors duration-200
            ${copyButtonText === "Copied!" 
                ? "bg-green-600 border-green-600 text-white" 
                : "bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700 hover:text-white"}
          `}
        >
          {copyButtonText}
        </button>
      </div>

      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-sm items-center">
        <strong className="text-zinc-400">1. Start Date:</strong>
        <span className="text-white">{formatDateTime(ingressDate)}</span>

        <strong className="text-zinc-400">2. {lookbackPeriod} Bars Ahead Date:</strong>
        <span className="text-white">{formatDateTime(lookbackEndDate)}</span>

        <strong className="text-zinc-400">3. Stoploss High Pivot:</strong>
        <span className={type === "Short" ? "text-red-400 font-bold" : "text-white"}>
          {entryPivotHigh
            ? `${entryPivotHigh.high.toFixed(2)} on ${formatDateTime(entryPivotHigh.date)}`
            : "N/A"}
        </span>

        <strong className="text-zinc-400">3. Stoploss Low Pivot:</strong>
        <span className={type === "Long" ? "text-red-400 font-bold" : "text-white"}>
          {entryPivotLow
            ? `${entryPivotLow.low.toFixed(2)} on ${formatDateTime(entryPivotLow.date)}`
            : "N/A"}
        </span>

        <strong className="text-zinc-400">4. Entry:</strong>
        <span className="text-white">
          {entryPrice.toFixed(2)} on {formatDateTime(entryDate)}
        </span>

        <strong className="text-zinc-400">5. Price Projection Pivot:</strong>
        <span className="text-white">
          {exitPivot
            ? `${(exitPivot.high || exitPivot.low).toFixed(2)} on ${formatDateTime(exitPivot.date)}`
            : "N/A"}
        </span>

        <strong className="text-zinc-400">6. Projected Exit Price:</strong>
        <span className="text-green-400 font-bold">
          {projectedExit ? projectedExit.toFixed(2) : "N/A"}
        </span>
      </div>
    </div>
  );
};

export default TradeInfo;
