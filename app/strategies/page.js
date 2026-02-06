
'use client';

import { useEffect, useState } from 'react';

export default function StrategyDashboard() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch('/api/strategy-dashboard')
            .then(res => res.json())
            .then(d => {
                setData(d);
                setLoading(false);
            })
            .catch(err => {
                console.error(err);
                setLoading(false);
            });
    }, []);

    if (loading) return (
        <div className="min-h-screen bg-black text-white flex items-center justify-center font-mono">
            <div className="animate-pulse">Loading AlgoCore Engines...</div>
        </div>
    );

    return (
        <div className="min-h-screen bg-black text-white font-mono p-8">
            {/* HEADER */}
            <div className="border-b border-gray-800 pb-6 mb-8">
                <h1 className="text-3xl font-bold text-green-500 mb-2">ALGO-CORE DASHBOARD</h1>
                <p className="text-gray-400">Live Strategy Monitor • Verified Engines (2020-2025)</p>
            </div>

            {/* PERFORMANCE SUMMARY CARDS (STATIC VERIFIED DATA) */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-12">
                <StatCard label="5-Year Return" value="+208%" sub="Verified" color="green" />
                <StatCard label="Win Rate" value="74%" sub="Vol Trap Engine" color="blue" />
                <StatCard label="Profit Factor" value="2.22" sub="Robustness" color="purple" />
                <StatCard label="Max Drawdown" value="-34%" sub="System Survival" color="red" />
            </div>

            {/* LIVE MARKET SCANNER */}
            <h2 className="text-xl font-bold mb-4 text-white">📡 LIVE MARKET SCANNER</h2>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-12">
                {data.marketAnalysis.map((asset) => (
                    <AssetCard key={asset.ticker} asset={asset} />
                ))}
            </div>

            {/* ENGINE SPECS */}
            <h2 className="text-xl font-bold mb-4 text-gray-500">⚙️ ENGINE SPECIFICATIONS</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {data.strategies.map((s, i) => (
                    <div key={i} className="bg-gray-900 border border-gray-800 p-4 rounded-lg">
                        <h3 className="font-bold text-white mb-1">{s.name}</h3>
                        <p className="text-sm text-gray-400 mb-2">{s.description}</p>
                        <div className="text-xs bg-gray-800 inline-block px-2 py-1 rounded text-green-400">
                            Verified Win Rate: {s.verifiedWinRate}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function StatCard({ label, value, sub, color }) {
    const colorClasses = {
        green: "text-green-500",
        blue: "text-blue-500",
        purple: "text-purple-500",
        red: "text-red-500"
    };
    return (
        <div className="bg-gray-900 border border-gray-800 p-6 rounded-lg text-center">
            <div className="text-gray-500 text-sm mb-1">{label}</div>
            <div className={`text-4xl font-bold mb-1 ${colorClasses[color]}`}>{value}</div>
            <div className="text-xs text-gray-600 uppercase tracking-wider">{sub}</div>
        </div>
    );
}

function AssetCard({ asset }) {
    const isBuy = asset.currentAction === 'BUY';
    
    return (
        <div className={`border ${isBuy ? 'border-green-500 shadow-[0_0_20px_rgba(34,197,94,0.2)]' : 'border-gray-800'} bg-gray-900 rounded-xl overflow-hidden`}>
            {/* Header */}
            <div className="p-4 border-b border-gray-800 flex justify-between items-center bg-gray-950">
                <div>
                    <h3 className="text-2xl font-bold">{asset.ticker}</h3>
                    <div className="text-sm text-gray-500">${asset.currentPrice.toFixed(2)}</div>
                </div>
                <div className={`px-4 py-2 rounded font-bold ${isBuy ? 'bg-green-600 text-black' : 'bg-gray-800 text-gray-500'}`}>
                    {asset.currentAction}
                </div>
            </div>
            
            {/* Recent Signals List */}
            <div className="p-4 h-64 overflow-y-auto custom-scrollbar">
                <div className="text-xs text-gray-500 mb-2 font-bold uppercase">Recent Signals (30 Days)</div>
                {asset.recentSignals.length === 0 ? (
                    <div className="text-gray-600 text-sm italic py-4 text-center">No signals detected recently.</div>
                ) : (
                    <div className="space-y-2">
                        {asset.recentSignals.map((sig, i) => (
                            <div key={i} className="flex justify-between items-center text-sm border-b border-gray-800 pb-2 last:border-0">
                                <div>
                                    <div className="text-green-400 font-bold">{sig.strategy}</div>
                                    <div className="text-xs text-gray-500">{sig.date}</div>
                                </div>
                                <div className="text-right">
                                    <div className="text-white">${sig.price.toFixed(2)}</div>
                                    <div className="text-xs text-red-400">Stop: ${sig.stop.toFixed(2)}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
