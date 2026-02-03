'use client';

/**
 * @file app/robAnalysis/page.js
 * @description The main page component for the backtest analysis UI, styled with Tailwind CSS.
 */

import React, { useState } from "react";
import TradeInfo from "../../components/rob/TradeInfo";

// --- REVISED HELPER FUNCTION TO FORMAT DATE & TIME ---
const formatDateTime = (dateString) => {
  if (!dateString) return "N/A";
  try {
    const date = new Date(dateString);
    // Use the Intl API to format the date correctly for the New York timezone.
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    const parts = formatter.formatToParts(date);
    const partValue = (type) => parts.find((p) => p.type === type)?.value || "";

    const year = partValue("year");
    const month = partValue("month");
    const day = partValue("day");
    const hour = partValue("hour") === "24" ? "00" : partValue("hour");
    const minute = partValue("minute");

    return `${year}-${month}-${day} ${hour}:${minute}`;
  } catch (e) {
    console.error("Could not format date:", dateString, e);
    return "Invalid Date";
  }
};

// --- Child Components ---

const TradeRow = ({ trade }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const profitColor = trade.profit >= 0 ? "text-green-500" : "text-red-500";
  const typeColor = trade.type === "Long" ? "text-green-400" : "text-red-400";

  return (
    <>
      <tr className="border-b border-zinc-800 hover:bg-zinc-900/50 transition-colors">
        <td className="p-4">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-zinc-400 hover:text-white transition-colors focus:outline-none"
          >
            {isExpanded ? "▼" : "▶"}
          </button>
        </td>
        <td className={`p-4 font-medium ${typeColor}`}>
          {trade.type}
        </td>
        <td className="p-4 text-zinc-300">{formatDateTime(trade.entryDate)}</td>
        <td className="p-4 text-zinc-300">{trade.entryPrice.toFixed(2)}</td>
        <td className="p-4 text-zinc-300">{formatDateTime(trade.exitDate)}</td>
        <td className="p-4 text-zinc-300">{trade.exitPrice.toFixed(2)}</td>
        <td className="p-4 text-zinc-400 text-sm">{trade.exitReason}</td>
        <td className={`p-4 font-medium ${profitColor}`}>
          {trade.profit.toFixed(2)}
        </td>
        <td className={`p-4 font-medium ${profitColor}`}>
          {trade.profitPct.toFixed(2)}%
        </td>
      </tr>
      {isExpanded && (
        <tr className="bg-zinc-900/30">
          <td colSpan="9" className="p-0">
            <div className="p-4 border-b border-zinc-800">
               <TradeInfo trade={trade} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
};

const TradeLogTable = ({ tradeLog }) => (
  <div className="mt-8 bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden shadow-sm">
    <div className="p-6 border-b border-zinc-800">
        <h2 className="text-xl font-bold text-white">Trade Log</h2>
    </div>
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="bg-zinc-900/80 text-xs uppercase tracking-wider text-zinc-500 font-semibold">
            <th className="p-4 w-10"></th>
            <th className="p-4">Type</th>
            <th className="p-4">Entry Date</th>
            <th className="p-4">Entry Price</th>
            <th className="p-4">Exit Date</th>
            <th className="p-4">Exit Price</th>
            <th className="p-4">Exit Reason</th>
            <th className="p-4">P/L ($)</th>
            <th className="p-4">P/L (%)</th>
          </tr>
        </thead>
        <tbody>
          {tradeLog.map((trade, index) => (
            <TradeRow key={index} trade={trade} />
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

const SummaryCard = ({ label, value, subValues, highlight }) => {
    let colorClass = "text-white";
    if (highlight === "positive") colorClass = "text-green-500";
    if (highlight === "negative") colorClass = "text-red-500";
    
    return (
        <div className="bg-zinc-900/50 border border-zinc-800 p-5 rounded-xl flex flex-col justify-between">
            <span className="text-zinc-400 text-sm font-medium mb-2 block">{label}</span>
            <span className={`text-2xl font-bold ${colorClass}`}>{value}</span>
            {subValues && <div className="mt-2 text-sm text-zinc-500">{subValues}</div>}
        </div>
    )
}

const SummaryReport = ({ summary }) => (
  <div className="mb-8">
    <h2 className="text-2xl font-bold text-white mb-4">Backtest Summary</h2>
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard 
            label="Initial Capital" 
            value={`$${summary.initialCapital.toFixed(2)}`} 
        />
        <SummaryCard 
            label="Final Value" 
            value={`$${summary.finalCapital.toFixed(2)}`}
            highlight={summary.finalCapital >= summary.initialCapital ? "positive" : "negative"}
        />
        <SummaryCard 
            label="Total Net P/L" 
            value={`$${summary.totalProfit.toFixed(2)}`}
            highlight={summary.totalProfit >= 0 ? "positive" : "negative"}
        />
        <SummaryCard 
            label="CAGR" 
            value={`${summary.cagr.toFixed(2)}%`}
            highlight={summary.cagr >= 0 ? "positive" : "negative"}
        />
        <SummaryCard 
            label="Total Trades" 
            value={summary.totalTrades}
            subValues={
                <span className="flex gap-3">
                    <span className="text-green-500">{summary.winningTrades} Wins</span>
                    <span className="text-red-500">{summary.losingTrades} Losses</span>
                </span>
            }
        />
        <SummaryCard 
            label="Win Rate" 
            value={`${summary.winRate.toFixed(2)}%`}
        />
    </div>
  </div>
);

// --- Main Page Component ---
export default function RobAnalysisPage() {
  // --- State for UI controls ---
  const [ticker, setTicker] = useState("AAPL");
  const [initialCapital, setInitialCapital] = useState("1000");
  const [startDate, setStartDate] = useState("2025-01-01");
  const [endDate, setEndDate] = useState("2025-10-01");
  const [timeframe, setTimeframe] = useState("1Day");

  const [startDateType, setStartDateType] = useState("ingress");
  const [manualStartDate, setManualStartDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [lookbackPeriods, setLookbackPeriods] = useState({
    90: true,
    45: true,
    22: true,
  });
  const [preventOnLosses, setPreventOnLosses] = useState(false);
  const [liquidateGroup, setLiquidateGroup] = useState(false);
  const [allowSingleTradePerDay, setAllowSingleTradePerDay] = useState(true);

  // --- State for results and UI feedback ---
  const [results, setResults] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLookbackChange = (period) =>
    setLookbackPeriods((prev) => ({ ...prev, [period]: !prev[period] }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");
    setResults(null);

    const selectedPeriods = Object.keys(lookbackPeriods)
      .filter((p) => lookbackPeriods[p])
      .map(Number);
    if (selectedPeriods.length === 0) {
      setError("Please select at least one look-forward period.");
      setIsLoading(false);
      return;
    }

    try {
      const requestBody = {
        ticker,
        timeframe,
        startDate,
        endDate,
        startDateType,
        manualStartDate,
        lookbackPeriods: selectedPeriods,
        initialCapital: parseFloat(initialCapital),
        preventOnLosses,
        liquidateGroup,
        allowSingleTradePerDay,
      };

      const response = await fetch("/api/robDaily", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const responseData = await response.json();
      if (!response.ok || !responseData.success) {
        throw new Error(
          responseData.error || "An unknown error occurred during backtest."
        );
      }
      setResults(responseData.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-zinc-100 font-sans p-6 md:p-12">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-8 text-transparent bg-clip-text bg-gradient-to-r from-white to-zinc-500">
          AlgoCore Analysis
        </h1>

        <form
          onSubmit={handleSubmit}
          className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6 md:p-8 mb-10 shadow-lg backdrop-blur-sm"
        >
          {/* --- Primary Controls --- */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
            <div className="space-y-2">
              <label htmlFor="ticker" className="block text-sm font-medium text-zinc-400">Ticker</label>
              <input
                id="ticker"
                type="text"
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                required
                className="w-full bg-black/50 border border-zinc-700 text-white rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="initialCapital" className="block text-sm font-medium text-zinc-400">Initial Capital ($)</label>
              <input
                id="initialCapital"
                type="number"
                value={initialCapital}
                onChange={(e) => setInitialCapital(e.target.value)}
                required
                className="w-full bg-black/50 border border-zinc-700 text-white rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="startDate" className="block text-sm font-medium text-zinc-400">Start Date</label>
              <input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
                className="w-full bg-black/50 border border-zinc-700 text-white rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all [color-scheme:dark]"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="endDate" className="block text-sm font-medium text-zinc-400">End Date</label>
              <input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
                className="w-full bg-black/50 border border-zinc-700 text-white rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all [color-scheme:dark]"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="timeframe" className="block text-sm font-medium text-zinc-400">Timeframe</label>
              <div className="relative">
                <select
                  id="timeframe"
                  value={timeframe}
                  onChange={(e) => setTimeframe(e.target.value)}
                  className="w-full appearance-none bg-black/50 border border-zinc-700 text-white rounded-lg px-4 py-2 pr-8 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                >
                  <option value="1Min">1 Minute</option>
                  <option value="5Min">5 Minutes</option>
                  <option value="15Min">15 Minutes</option>
                  <option value="1Hour">1 Hour</option>
                  <option value="1Day">1 Day</option>
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-zinc-400">
                    <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
                </div>
              </div>
            </div>
          </div>

          {/* --- Logic Controls Section --- */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8 border-t border-zinc-800 pt-8">
              
              {/* Left Column: Date and Lookback */}
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-end">
                    <div className="w-full sm:w-1/2 space-y-2">
                        <label htmlFor="startDateType" className="block text-sm font-medium text-zinc-400">Start Date Strategy</label>
                        <div className="relative">
                            <select
                            id="startDateType"
                            value={startDateType}
                            onChange={(e) => setStartDateType(e.target.value)}
                            className="w-full appearance-none bg-black/50 border border-zinc-700 text-white rounded-lg px-4 py-2 pr-8 focus:ring-2 focus:ring-blue-500 outline-none"
                            >
                            <option value="ingress">Solar Ingress</option>
                            <option value="manual">Manual Date</option>
                            <option value="auto">Auto High/Low Pivots</option>
                            </select>
                            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-zinc-400">
                                <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
                            </div>
                        </div>
                    </div>
                    {startDateType === "manual" && (
                        <div className="w-full sm:w-1/2 space-y-2">
                            <label htmlFor="manualStartDate" className="block text-sm font-medium text-zinc-400">Manual Date</label>
                            <input
                                id="manualStartDate"
                                type="date"
                                value={manualStartDate}
                                onChange={(e) => setManualStartDate(e.target.value)}
                                required
                                className="w-full bg-black/50 border border-zinc-700 text-white rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none [color-scheme:dark]"
                            />
                        </div>
                    )}
                </div>

                <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-3">Look-Forward Periods</label>
                    <div className="flex gap-4">
                        {[90, 45, 22].map((period) => (
                            <label key={period} className="flex items-center gap-2 cursor-pointer group">
                                <div className="relative flex items-center">
                                    <input
                                        type="checkbox"
                                        checked={lookbackPeriods[period]}
                                        onChange={() => handleLookbackChange(period)}
                                        className="peer h-5 w-5 cursor-pointer appearance-none rounded border border-zinc-600 bg-black/50 checked:bg-blue-600 checked:border-blue-600 transition-all"
                                    />
                                    <svg className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none opacity-0 peer-checked:opacity-100 text-white" viewBox="0 0 14 14" fill="none">
                                        <path d="M3 8L6 11L11 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                    </svg>
                                </div>
                                <span className="text-zinc-300 group-hover:text-white transition-colors">{period} bars</span>
                            </label>
                        ))}
                    </div>
                </div>
              </div>

              {/* Right Column: Execution Rules */}
              <div className="space-y-4">
                    <label className="flex items-start gap-3 p-4 rounded-xl border border-blue-500/20 bg-blue-500/5 cursor-pointer hover:bg-blue-500/10 transition-colors">
                        <input
                            type="checkbox"
                            checked={allowSingleTradePerDay}
                            onChange={(e) => setAllowSingleTradePerDay(e.target.checked)}
                            className="mt-1 h-4 w-4 rounded border-blue-500/50 bg-transparent text-blue-500 focus:ring-offset-0 focus:ring-2 focus:ring-blue-500"
                        />
                        <div>
                            <span className="block text-sm font-medium text-blue-400">Allow Only One Trade Per Bar</span>
                            <span className="block text-xs text-blue-400/70 mt-1">If multiple signals generate for the same bar, execute only the first one.</span>
                        </div>
                    </label>

                    <label className="flex items-start gap-3 p-4 rounded-xl border border-red-500/20 bg-red-500/5 cursor-pointer hover:bg-red-500/10 transition-colors">
                        <input
                            type="checkbox"
                            checked={preventOnLosses}
                            onChange={(e) => setPreventOnLosses(e.target.checked)}
                            className="mt-1 h-4 w-4 rounded border-red-500/50 bg-transparent text-red-500 focus:ring-offset-0 focus:ring-2 focus:ring-red-500"
                        />
                         <div>
                            <span className="block text-sm font-medium text-red-400">Prevent Trading After 2 Losses</span>
                            <span className="block text-xs text-red-400/70 mt-1">Pause trading after 2 consecutive losses until a hypothetical winner is observed.</span>
                        </div>
                    </label>

                    <label className="flex items-start gap-3 p-4 rounded-xl border border-yellow-500/20 bg-yellow-500/5 cursor-pointer hover:bg-yellow-500/10 transition-colors">
                        <input
                            type="checkbox"
                            checked={liquidateGroup}
                            onChange={(e) => setLiquidateGroup(e.target.checked)}
                            className="mt-1 h-4 w-4 rounded border-yellow-500/50 bg-transparent text-yellow-500 focus:ring-offset-0 focus:ring-2 focus:ring-yellow-500"
                        />
                         <div>
                            <span className="block text-sm font-medium text-yellow-400">Liquidate Group on First Loss</span>
                            <span className="block text-xs text-yellow-500/70 mt-1">If one trade hits stop-loss, close all open trades from the same start date.</span>
                        </div>
                    </label>
              </div>
          </div>

          <div className="flex justify-end pt-4 border-t border-zinc-800">
            <button
                type="submit"
                disabled={isLoading}
                className={`
                    px-8 py-3 rounded-lg font-semibold text-white shadow-lg shadow-blue-900/20
                    transition-all duration-200
                    ${isLoading 
                        ? 'bg-zinc-700 cursor-not-allowed opacity-70' 
                        : 'bg-blue-600 hover:bg-blue-500 hover:shadow-blue-500/30 active:transform active:scale-95'}
                `}
            >
                {isLoading ? (
                    <span className="flex items-center gap-2">
                        <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Simulating...
                    </span>
                ) : (
                    "Run Backtest"
                )}
            </button>
          </div>
        </form>

        {error && (
            <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-4 rounded-xl mb-8 flex items-center gap-3">
                <svg className="h-6 w-6 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {error}
            </div>
        )}
        
        {results && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <SummaryReport summary={results.summary} />
            <TradeLogTable tradeLog={results.tradeLog} />
          </div>
        )}
      </div>
    </div>
  );
}
