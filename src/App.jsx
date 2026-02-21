import React, { useState, useEffect, useMemo } from 'react';
import { Play, Code, Upload, Database, Activity, LogOut, ChevronRight, Zap, Target, Sliders, Clock, TrendingUp, BarChart2, FileText, Settings, AlertCircle } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { supabase } from './supabaseClient';
import { SignedIn, SignedOut, SignInButton, UserButton, useUser } from "@clerk/clerk-react";

export default function App() {
    const { user } = useUser();
    const [step, setStep] = useState(1); // 1: Input, 2: Processing, 3: Results

    // Step 1 Form state
    const [asset, setAsset] = useState('BTCUSDT');
    const [assetType, setAssetType] = useState('crypto'); // 'crypto' or 'futures'
    const [capitalConfig, setCapitalConfig] = useState({ mode: 'fixed', value: 100 });
    const [code, setCode] = useState('//@version=5\nindicator("My Custom Strategy")\n');
    const [paramMode, setParamMode] = useState('manual'); // 'manual' or 'ai'
    const [iterations, setIterations] = useState(1000);
    const [timeframe, setTimeframe] = useState('1H');

    const [dbAssets, setDbAssets] = useState({ crypto: [], futures: [] });
    const [isLoadingAssets, setIsLoadingAssets] = useState(true);

    // Custom Param Constraints with AI recognition annotations
    const [params, setParams] = useState([
        { name: 'length', min: 10, max: 50, desc: '技術指標的回溯週期，影響趨勢判定與交易訊號的靈敏度。' },
        { name: 'multiplier', min: 1.0, max: 4.0, desc: 'ATR 或標準差的乘數，用以動態擴增止損範圍與信道寬度。' },
        { name: 'stopLoss', min: 1, max: 10, desc: '硬性止損百分比 (Stop Loss %)，確保風控在單筆交易中的最大虧損界限。' },
        { name: 'takeProfit', min: 2, max: 20, desc: '強制止盈百分比 (Take Profit %)，達到預期報酬即落袋為安。' },
        { name: 'holdingTime', min: 1, max: 24, desc: '最長持倉根數 (Max Holding Bars)，避免因盤整耗損資金利用率。' },
        { name: 'trailingStop', min: 0.5, max: 5, desc: '移動停利 (Trailing Stop %)，隨著利潤擴大逐步提高出場線保護利潤。' }
    ]);

    // Step 2 Progress state
    const [progress, setProgress] = useState(0);
    const [logs, setLogs] = useState([]);

    // Step 3 Results state
    const [results, setResults] = useState(null);
    const [activeTab, setActiveTab] = useState('summary'); // 'overview' | 'summary' | 'trades'

    useEffect(() => {
        // Fetch DB Assets
        const fetchAssets = async () => {
            const { data, error } = await supabase
                .from('assets')
                .select('*')
                .eq('active', true);

            if (data && !error) {
                const crypto = data.filter(a => a.type === 'crypto');
                const futures = data.filter(a => a.type === 'futures');
                setDbAssets({ crypto, futures });

                // set default if lists are populated
                if (assetType === 'crypto' && crypto.length > 0) setAsset(crypto[0].symbol);
                if (assetType === 'futures' && futures.length > 0) setAsset(futures[0].symbol);
            }
            setIsLoadingAssets(false);
        };

        fetchAssets();
    }, []);

    // Extract dynamic parameters from PineScript code
    useEffect(() => {
        const defaultRiskParams = [
            { name: 'stopLoss', min: 1, max: 10, desc: '硬性止損百分比 (Stop Loss %)，確保風控在單筆交易中的最大虧損界限。' },
            { name: 'takeProfit', min: 2, max: 20, desc: '強制止盈百分比 (Take Profit %)，達到預期報酬即落袋為安。' },
            { name: 'holdingTime', min: 1, max: 24, desc: '最長持倉根數 (Max Holding Bars)，避免因盤整耗損資金利用率。' },
            { name: 'trailingStop', min: 0.5, max: 5, desc: '移動停利 (Trailing Stop %)，隨著利潤擴大逐步提高出場線保護利潤。' }
        ];

        const timer = setTimeout(() => {
            const lines = code.split('\n');
            const extractedParams = [];

            lines.forEach(line => {
                const trimmed = line.trim();
                // Ignore comments
                if (trimmed.startsWith('//')) return;

                // Match PineScript input assignments: varName = input(123) or varName = input.int(123, title="...")
                // Pattern: matches identifier, equals, input, optional dot int/float, parameters
                const match = trimmed.match(/([a-zA-Z0-9_]+)\s*=\s*input(?:\.(?:int|float))?\(/);

                if (match) {
                    const varName = match[1];
                    const titleMatch = trimmed.match(/title\s*=\s*['"]([^'"]+)['"]/);
                    const desc = titleMatch ? `(自定義參數) ${titleMatch[1]}` : `(自定義腳本參數) ${varName}`;

                    // Try to guess default value to form min/max ranges
                    let defVal = null;
                    const firstArgMatch = trimmed.match(/input(?:\.\w+)?\(\s*([\d.]+)/);

                    if (firstArgMatch && !isNaN(parseFloat(firstArgMatch[1]))) {
                        defVal = parseFloat(firstArgMatch[1]);
                    } else {
                        const defvalMatch = trimmed.match(/defval\s*=\s*([\d.]+)/);
                        if (defvalMatch) defVal = parseFloat(defvalMatch[1]);
                    }

                    // Generate sensible min/max bounds based on the default value found
                    let min = 1;
                    let max = 100;
                    if (defVal !== null) {
                        min = defVal > 5 ? Math.floor(defVal * 0.5) : (defVal > 0 ? 0.1 : 0);
                        max = defVal > 5 ? Math.ceil(defVal * 2) : 10;
                        if (max <= min) max = min + 10;
                    }

                    // Look for explicit minval/maxval overrides
                    const explicitMin = trimmed.match(/minval\s*=\s*([-\d.]+)/);
                    if (explicitMin) min = parseFloat(explicitMin[1]);

                    const explicitMax = trimmed.match(/maxval\s*=\s*([-\d.]+)/);
                    if (explicitMax) max = parseFloat(explicitMax[1]);

                    extractedParams.push({
                        name: varName,
                        min: min,
                        max: max,
                        desc: desc
                    });
                }
            });

            // If nothing extracted, provide defaults
            if (extractedParams.length === 0) {
                extractedParams.push(
                    { name: 'length', min: 10, max: 50, desc: '技術指標的回溯週期，影響趨勢判定與交易訊號的靈敏度。' },
                    { name: 'multiplier', min: 1.0, max: 4.0, desc: 'ATR 或標準差的乘數，用以動態擴增止損範圍與信道寬度。' }
                );
            }

            // Only update if the parameter naming structurally changes to prevent jumping UI inputs
            setParams(prev => {
                const updatedList = [...extractedParams, ...defaultRiskParams];
                const currentNames = prev.map(p => p.name).join(',');
                const newNames = updatedList.map(p => p.name).join(',');
                if (currentNames !== newNames) {
                    return updatedList;
                }
                return prev;
            });

        }, 500);

        return () => clearTimeout(timer);
    }, [code]);

    const estimatedMinutes = useMemo(() => {
        // mock estimation: 0.1s per backtest group
        // total time in seconds = iterations * 0.1
        // let's cap the visual processing demo so it doesn't take 16 minutes in real life for the demo
        const timeInSeconds = iterations * 0.1;
        if (timeInSeconds < 60) return `${Math.ceil(timeInSeconds)} 秒`;
        return `${Math.ceil(timeInSeconds / 60)} 分鐘`;
    }, [iterations]);

    const addLog = (msg, type = 'normal') => {
        const time = new Date().toLocaleTimeString('en-US', { hour12: false });
        setLogs(prev => [...prev, { time, msg, type }]);
    };

    const handleParamChange = (index, field, value) => {
        const newParams = [...params];
        newParams[index][field] = value;
        setParams(newParams);
    };

    const handleStartBacktest = () => {
        if (!code) {
            alert("請上傳或貼上 PineScript 程式碼！");
            return;
        }

        setStep(2);
        setProgress(0);
        setLogs([]);

        // The demo animation sequence (much faster than indicated time)
        addLog("Initializing Backtest Engine Ver. 2.4.1", "info");

        if (paramMode === 'ai') {
            addLog("AI is injecting custom trend/momentum insights into boundary optimization...", "highlight");
        }

        setTimeout(() => {
            setProgress(15);
            addLog(`Fetching deep historical data for ${asset}...`);
            addLog(`Aggregating multiple timeframes (1D, 4H, 1H, 15m) for maximum fidelity.`);
        }, 1000);

        setTimeout(() => {
            setProgress(30);
            addLog(`Compiling PineScript v5 logic...`, 'info');
        }, 2500);

        setTimeout(() => {
            setProgress(45);
            if (paramMode === 'ai') {
                addLog(`AI Mode Enabled: Automatically scanning parameter dimensions and relationships...`, 'highlight');
            } else {
                addLog(`Manual Mode: Constraining boundaries to user-defined limits...`);
            }
            addLog(`Commencing Monte Carlo Optimization with ${iterations} iterations!`, "highlight");
        }, 4500);

        // Simulate batch progress
        setTimeout(() => {
            setProgress(75);
            addLog(`[Batch 1-${Math.floor(iterations / 2)}] Evaluated. Highest ROI so far: 184.2%`);
        }, 6500);

        setTimeout(() => {
            setProgress(90);
            addLog(`[Batch ${Math.floor(iterations / 2)}-${iterations}] Evaluated. Identifying global maximum...`);
        }, 8500);

        setTimeout(() => {
            setProgress(100);
            addLog(`Optimization Complete! Generating TradingView-style performance report.`, 'success');

            const currencySymbol = assetType === 'crypto' ? 'USDT' : 'USD';

            setResults({
                asset,
                iterationsUsed: iterations,
                capitalConfig,
                assetType,
                netProfit: `+38,450.20 ${currencySymbol}`,
                netProfitPct: "+384.50%",
                grossProfit: "64,210.00",
                grossLoss: "-25,759.80",
                maxDrawdown: "12.4%",
                maxDrawdownAbsolute: `-1,240.00 ${currencySymbol}`,
                buyAndHoldReturn: "+152.00%",
                sharpeRatio: "2.84",
                sortinoRatio: "4.12",
                profitFactor: "2.49",
                winRate: "68.4%",
                totalTrades: "452",
                avgTrade: `+45.20 ${currencySymbol}`,
                avgBarsInTrade: "45",
                topStrategies: [
                    {
                        roi: "+384.50%",
                        params: {
                            length: paramMode === 'ai' ? 21 : Math.floor((Number(params[0].min) + Number(params[0].max)) / 2),
                            multiplier: paramMode === 'ai' ? 2.6 : 2.5,
                            stopLoss: "3.5%",
                            takeProfit: "8.2%",
                            holdingTime: "12 bars",
                            trailingStop: "1.5%"
                        }
                    },
                    {
                        roi: "+310.20%",
                        params: {
                            length: paramMode === 'ai' ? 18 : Math.floor((Number(params[0].min) + Number(params[0].max)) / 2) - 2,
                            multiplier: paramMode === 'ai' ? 2.2 : 2.1,
                            stopLoss: "4.0%",
                            takeProfit: "7.0%",
                            holdingTime: "8 bars",
                            trailingStop: "2.0%"
                        }
                    },
                    {
                        roi: "+285.45%",
                        params: {
                            length: paramMode === 'ai' ? 25 : Math.floor((Number(params[0].min) + Number(params[0].max)) / 2) + 5,
                            multiplier: paramMode === 'ai' ? 3.0 : 2.8,
                            stopLoss: "2.5%",
                            takeProfit: "10.0%",
                            holdingTime: "16 bars",
                            trailingStop: "1.2%"
                        }
                    }
                ],
                // Generate a mock trade history matching the total trades
                trades: Array.from({ length: 452 }).map((_, i) => {
                    const isWin = Math.random() > 0.3;
                    const isLong = Math.random() > 0.5;
                    const price = (60000 + (Math.random() * 5000 - 2500)).toFixed(2);
                    const pnl = isWin ? +(Math.random() * 800 + 100).toFixed(2) : -(Math.random() * 300 + 50).toFixed(2);
                    // generate a realistic receding date starting from today
                    const d = new Date(Date.now() - (452 - i) * 60480000);
                    return {
                        id: 452 - i,
                        type: isLong ? 'Entry Long' : (i % 2 === 0 ? 'Exit Short' : 'Exit Long'),
                        typeColor: isLong ? 'var(--success)' : 'var(--danger)',
                        signal: isWin ? 'Take Profit' : (isLong ? 'MA Cross' : 'Stop Loss'),
                        date: d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }),
                        price: `$${price}`,
                        pnl: pnl > 0 ? `+${pnl}` : pnl
                    };
                }).reverse()
            });
            setStep(3);
        }, 10000); // Demo completes in 10s regardless of requested time for UX
    };

    return (
        <>
            <SignedOut>
                <div className="app-container">
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
                        <div style={{ padding: '3rem', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '1.5rem', boxShadow: '0 20px 50px rgba(0,0,0,0.5)', maxWidth: '500px', width: '100%' }}>
                            <Activity size={72} color="var(--accent)" style={{ marginBottom: '1.5rem' }} />
                            <h1 style={{ fontSize: '2.5rem', marginBottom: '1rem', color: 'var(--text-highlight)' }}>BacktestNOW<span style={{ color: 'var(--accent)' }}>.</span></h1>
                            <p style={{ color: 'var(--text-secondary)', marginBottom: '3rem', lineHeight: '1.6' }}>
                                Upload your PineScript. Harness Deep AI Optimization over maximum historical K-lines (1D to 15m) to uncover the highest ROI parameters instantly.
                            </p>
                            <SignInButton mode="modal">
                                <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '1.2rem', fontSize: '1.1rem' }}>
                                    Sign In with Clerk
                                </button>
                            </SignInButton>
                        </div>
                    </div>
                </div>
            </SignedOut>

            <SignedIn>
                <div className="app-container">
                    <header>
                        <div className="logo">
                            <Activity color="var(--accent)" />
                            BacktestNOW
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>{user?.fullName || user?.firstName || 'Trader'}</span>
                            </div>
                            <UserButton />
                        </div>
                    </header>

                    {step === 1 && (
                        <div className="layout-split">
                            <div className="glass-panel">
                                <h2 style={{ marginBottom: '2rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-highlight)' }}>
                                    <Code size={22} color="var(--accent)" /> Strategy Config
                                </h2>

                                <div className="form-group" style={{ display: 'flex', gap: '1rem' }}>
                                    <div style={{ flex: 1 }}>
                                        <label className="form-label">Asset Type</label>
                                        <select className="form-select" value={assetType} onChange={e => {
                                            setAssetType(e.target.value);
                                            setAsset(e.target.value === 'crypto' ? 'BTCUSDT' : 'GC!');
                                            setCapitalConfig(e.target.value === 'crypto'
                                                ? { mode: 'fixed', value: 100 }
                                                : { mode: 'contracts', value: 1 });
                                        }}>
                                            <option value="crypto">Crypto (加密貨幣)</option>
                                            <option value="futures">Traditional Futures (傳統期貨)</option>
                                        </select>
                                    </div>
                                    <div style={{ flex: 2 }}>
                                        <label className="form-label">Asset Pair</label>
                                        <select className="form-select" value={asset} onChange={e => setAsset(e.target.value)}>
                                            {assetType === 'crypto' ? (
                                                <>
                                                    {dbAssets.crypto.map(assetItem => (
                                                        <option key={assetItem.id} value={assetItem.symbol}>{assetItem.symbol} ({assetItem.name})</option>
                                                    ))}
                                                    {dbAssets.crypto.length === 0 && <option value="BTCUSDT">Loading assets...</option>}
                                                </>
                                            ) : (
                                                <>
                                                    {dbAssets.futures.map(assetItem => (
                                                        <option key={assetItem.id} value={assetItem.symbol}>{assetItem.symbol} ({assetItem.name})</option>
                                                    ))}
                                                    {dbAssets.futures.length === 0 && <option value="GC!">Loading assets...</option>}
                                                </>
                                            )}
                                        </select>
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <label className="form-label">Timeframe (週期)</label>
                                        <select className="form-select" value={timeframe} onChange={e => setTimeframe(e.target.value)}>
                                            <option value="1H">1H</option>
                                            <option value="4H">4H</option>
                                            <option value="DAILY">DAILY</option>
                                        </select>
                                    </div>
                                </div>

                                <div className="form-group" style={{ background: 'var(--bg-panel)', padding: '1rem', borderRadius: '0.5rem', border: '1px solid var(--border-color)' }}>
                                    <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <Database size={16} /> Initial Capital & Order Size (回測單位與資金)
                                    </label>
                                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                                        {assetType === 'crypto' ? (
                                            <>
                                                <select
                                                    className="form-select"
                                                    style={{ flex: 1 }}
                                                    value={capitalConfig.mode}
                                                    onChange={e => setCapitalConfig({ ...capitalConfig, mode: e.target.value })}
                                                >
                                                    <option value="fixed">Fixed Amount (USDT)</option>
                                                    <option value="percent_equity">% of Equity</option>
                                                </select>
                                                <input
                                                    type="number"
                                                    className="form-input"
                                                    style={{ flex: 1 }}
                                                    value={capitalConfig.value}
                                                    onChange={e => setCapitalConfig({ ...capitalConfig, value: parseInt(e.target.value) || 0 })}
                                                />
                                                <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                                    {capitalConfig.mode === 'fixed' ? 'USDT / order' : '% (Max 100)'}
                                                </span>
                                            </>
                                        ) : (
                                            <>
                                                <div style={{ flex: 1.5, color: 'var(--text-highlight)', fontSize: '0.95rem', padding: '0.8rem 1rem', background: 'rgba(255,255,255,0.05)', borderRadius: '0.5rem' }}>
                                                    Fixed Contracts Mode (固定口數)
                                                </div>
                                                <input
                                                    type="number"
                                                    className="form-input"
                                                    style={{ flex: 1 }}
                                                    value={capitalConfig.value}
                                                    onChange={e => setCapitalConfig({ ...capitalConfig, value: parseInt(e.target.value) || 0 })}
                                                />
                                                <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', flex: 0.5 }}>Contracts (口)</span>
                                            </>
                                        )}
                                    </div>
                                </div>

                                <div className="form-group" style={{ marginTop: '2rem' }}>
                                    <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <span>PineScript Code</span>
                                        <span style={{ color: 'var(--accent)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <Upload size={14} /> Upload .pine File
                                        </span>
                                    </label>
                                    <textarea
                                        className="form-textarea"
                                        value={code}
                                        onChange={e => setCode(e.target.value)}
                                        style={{ height: '300px' }}
                                    ></textarea>
                                </div>
                            </div>

                            <div className="glass-panel">
                                <h2 style={{ marginBottom: '2rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-highlight)' }}>
                                    <Settings size={22} color="var(--accent)" /> Optimization Settings
                                </h2>

                                <div className="form-group">
                                    <label className="form-label">Parameter Selection Mode</label>
                                    <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                                        <button
                                            className={`btn ${paramMode === 'manual' ? 'btn-primary' : 'btn-outline'}`}
                                            style={{ flex: 1, justifyContent: 'center' }}
                                            onClick={() => setParamMode('manual')}
                                        >
                                            <Sliders size={16} /> Manual Constraints
                                        </button>
                                        <button
                                            className={`btn ${paramMode === 'ai' ? 'btn-primary' : 'btn-outline'}`}
                                            style={{ flex: 1, justifyContent: 'center' }}
                                            onClick={() => setParamMode('ai')}
                                        >
                                            <Zap size={16} /> AI Auto-Suggest (Max ROI)
                                        </button>
                                    </div>
                                </div>

                                {paramMode === 'manual' && (
                                    <div className="form-group" style={{ background: 'var(--bg-panel)', padding: '1.5rem', borderRadius: '0.5rem', border: '1px solid var(--border-color)' }}>
                                        <label className="form-label" style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <Settings size={18} /> Define Limits (AI 智能輔助解析參數)
                                        </label>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                                            {params.map((p, idx) => (
                                                <div key={idx} style={{ background: 'var(--bg-surface)', padding: '1.2rem', borderRadius: '0.5rem', border: '1px solid rgba(255,255,255,0.05)' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.8rem' }}>
                                                        <span style={{ fontSize: '1rem', fontWeight: 'bold', color: 'var(--text-highlight)', textTransform: 'uppercase' }}>{p.name}</span>
                                                        <div className="param-row" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                                            <input type="number" className="form-input" style={{ width: '80px', textAlign: 'center' }} value={p.min} onChange={e => handleParamChange(idx, 'min', e.target.value)} placeholder="Min" />
                                                            <span style={{ color: 'var(--text-secondary)' }}>—</span>
                                                            <input type="number" className="form-input" style={{ width: '80px', textAlign: 'center' }} value={p.max} onChange={e => handleParamChange(idx, 'max', e.target.value)} placeholder="Max" />
                                                        </div>
                                                    </div>
                                                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: '1.5', paddingLeft: '0.5rem', borderLeft: '2px solid var(--accent)' }}>
                                                        {p.desc}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {paramMode === 'ai' && (
                                    <div className="form-group" style={{ background: 'rgba(8, 153, 129, 0.1)', padding: '1.5rem', borderRadius: '0.5rem', border: '1px solid var(--success)' }}>
                                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', color: 'var(--success)', marginBottom: '0.5rem' }}>
                                            <Zap size={20} /> <strong>AI Guided Search Active</strong>
                                        </div>
                                        <p style={{ fontSize: '0.9rem', color: 'var(--text-primary)', lineHeight: '1.5' }}>
                                            The AI Engine will analyze your script structure and automatically determine the most probable parameter combinations and dimensions to yield the highest ROI without overfitting.
                                        </p>
                                    </div>
                                )}

                                <div className="form-group" style={{ marginTop: '2.5rem' }}>
                                    <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <span>Backtest Iterations (Groups)</span>
                                        <span style={{ color: 'var(--text-highlight)' }}>{iterations.toLocaleString()}</span>
                                    </label>
                                    <input
                                        type="range"
                                        min="100"
                                        max="10000"
                                        step="100"
                                        value={iterations}
                                        onChange={e => setIterations(e.target.value)}
                                        className="range-slider"
                                    />
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                        <span>100</span>
                                        <span>10,000</span>
                                    </div>

                                    <div className="time-estimation">
                                        <Clock size={16} /> Estimated Processing Time: ~{estimatedMinutes}
                                    </div>
                                </div>

                                <div style={{ marginTop: '3rem' }}>
                                    <button className="btn btn-primary" onClick={handleStartBacktest} style={{ width: '100%', justifyContent: 'center', padding: '1.2rem', fontSize: '1.1rem' }}>
                                        <Play size={20} /> Run Backtest & Optimize
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {step === 2 && (
                        <div className="glass-panel narrow">
                            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.5rem' }}>
                                <Activity size={48} color="var(--accent)" className="pulse-anim" style={{ animation: 'pulse 2s infinite' }} />
                            </div>
                            <h2 style={{ textAlign: 'center', marginBottom: '0.5rem', color: 'var(--text-highlight)', fontSize: '1.8rem' }}>Processing Data</h2>
                            <p style={{ textAlign: 'center', color: 'var(--text-secondary)', marginBottom: '3rem' }}>
                                Testing <strong>{iterations.toLocaleString()}</strong> parameter groups across historic maximum dataset.
                            </p>

                            <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', color: 'var(--text-highlight)' }}>
                                <span style={{ fontWeight: '600' }}>Overall Progress</span>
                                <span>{progress}%</span>
                            </div>

                            <div style={{ width: '100%', height: '8px', background: 'var(--bg-panel)', borderRadius: '4px', overflow: 'hidden' }}>
                                <div style={{ height: '100%', background: 'linear-gradient(90deg, var(--accent), #1e53e5)', width: `${progress}%`, transition: 'width 0.3s ease' }}></div>
                            </div>

                            <div className="console-output">
                                {logs.map((log, i) => (
                                    <div key={i} className="console-line">
                                        <span style={{ color: 'var(--text-secondary)', marginRight: '10px' }}>{log.time}</span>
                                        <span className={log.type === 'highlight' ? 'console-highlight' : log.type === 'info' ? 'console-info' : ''}>
                                            {log.msg}
                                        </span>
                                    </div>
                                ))}
                                {progress < 100 && <div className="console-line blink" style={{ marginTop: '0.5rem' }}>_</div>}
                            </div>
                        </div>
                    )}

                    {step === 3 && results && (
                        <div style={{ width: '100%' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                                <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-highlight)', fontSize: '1.8rem' }}>
                                    <TrendingUp size={28} color="var(--accent)" /> Strategy Tester Report
                                </h2>
                                <button className="btn" onClick={() => setStep(1)}>
                                    <ChevronRight size={16} style={{ transform: 'rotate(180deg)' }} /> Back to Config
                                </button>
                            </div>

                            <div className="tv-tabs">
                                <div className={`tv-tab ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>Overview</div>
                                <div className={`tv-tab ${activeTab === 'summary' ? 'active' : ''}`} onClick={() => setActiveTab('summary')}>Performance Summary</div>
                                <div className={`tv-tab ${activeTab === 'trades' ? 'active' : ''}`} onClick={() => setActiveTab('trades')}>List of Trades</div>
                            </div>

                            {activeTab === 'overview' && (
                                <div className="glass-panel" style={{ padding: '0' }}>
                                    <div style={{ padding: '2rem' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem' }}>
                                            <div>
                                                <h3 style={{ color: 'var(--text-highlight)', fontSize: '1.2rem', marginBottom: '0.2rem' }}>{results.asset} Optimization</h3>
                                                <p style={{ color: 'var(--text-secondary)' }}>Tested over {results.iterationsUsed.toLocaleString()} parameter groups.</p>
                                            </div>
                                            <div style={{ textAlign: 'right' }}>
                                                <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--success)' }}>{results.netProfitPct}</div>
                                                <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Net Profit</div>
                                            </div>
                                        </div>

                                        <div className="chart-placeholder" style={{ height: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <ResponsiveContainer width="100%" height="100%">
                                                <AreaChart
                                                    data={[
                                                        { name: 'Start', equity: 1000 },
                                                        { name: 'Trade 50', equity: 10500 },
                                                        { name: 'Trade 100', equity: 22000 },
                                                        { name: 'Trade 150', equity: 18000 },
                                                        { name: 'Trade 200', equity: 35000 },
                                                        { name: 'Trade 250', equity: 29000 },
                                                        { name: 'End', equity: 38450 }
                                                    ]}
                                                    margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                                                >
                                                    <defs>
                                                        <linearGradient id="colorEquity" x1="0" y1="0" x2="0" y2="1">
                                                            <stop offset="5%" stopColor="#2962ff" stopOpacity={0.4} />
                                                            <stop offset="95%" stopColor="#2962ff" stopOpacity={0} />
                                                        </linearGradient>
                                                    </defs>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                                    <XAxis dataKey="name" stroke="var(--text-secondary)" fontSize={12} tickLine={false} axisLine={false} />
                                                    <YAxis stroke="var(--text-secondary)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `$${value}`} />
                                                    <Tooltip
                                                        contentStyle={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)' }}
                                                        itemStyle={{ color: 'var(--accent)' }}
                                                    />
                                                    <Area type="monotone" dataKey="equity" stroke="#2962ff" strokeWidth={3} fillOpacity={1} fill="url(#colorEquity)" />
                                                </AreaChart>
                                            </ResponsiveContainer>
                                        </div>

                                        <div style={{ marginTop: '2rem' }}>
                                            <h4 style={{ color: 'var(--text-highlight)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <Target size={18} color="var(--accent)" /> Top 3 AI Discovered Parameter Sets
                                            </h4>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                                {results.topStrategies.map((strategy, idx) => (
                                                    <div key={idx} style={{ background: 'var(--bg-panel)', padding: '1.5rem', borderRadius: '0.5rem', border: `1px solid ${idx === 0 ? 'var(--success)' : 'var(--border-color)'}`, position: 'relative' }}>
                                                        {idx === 0 && <div style={{ position: 'absolute', top: 0, right: 0, background: 'var(--success)', color: '#000', padding: '0.2rem 1rem', fontSize: '0.8rem', fontWeight: 'bold', borderBottomLeftRadius: '0.5rem', borderTopRightRadius: '0.5rem' }}>BEST ROI</div>}
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                                            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--text-highlight)' }}>Rank #{idx + 1}</div>
                                                            <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: idx === 0 ? 'var(--success)' : 'var(--text-secondary)' }}>{strategy.roi} Net Profit</div>
                                                        </div>
                                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '1rem' }}>
                                                            {Object.entries(strategy.params).map(([key, val]) => (
                                                                <div key={key} style={{ background: 'var(--bg-surface)', padding: '0.8rem', borderRadius: '0.5rem', border: '1px solid rgba(255,255,255,0.02)' }}>
                                                                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', textTransform: 'uppercase', marginBottom: '0.3rem' }}>{key}</div>
                                                                    <div style={{ color: 'var(--text-highlight)', fontSize: '1.1rem', fontWeight: 'bold' }}>{val}</div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {activeTab === 'summary' && (
                                <div className="glass-panel" style={{ padding: '2rem' }}>
                                    <div className="tv-report-grid">
                                        <div className="tv-metric">
                                            <span className="tv-metric-title">Net Profit</span>
                                            <span className="tv-metric-value up">{results.netProfit} <span style={{ fontSize: '1rem' }}>({results.netProfitPct})</span></span>
                                        </div>
                                        <div className="tv-metric">
                                            <span className="tv-metric-title">Gross Profit</span>
                                            <span className="tv-metric-value up">{results.grossProfit}</span>
                                        </div>
                                        <div className="tv-metric">
                                            <span className="tv-metric-title">Gross Loss</span>
                                            <span className="tv-metric-value down">{results.grossLoss}</span>
                                        </div>
                                        <div className="tv-metric">
                                            <span className="tv-metric-title">Max Drawdown</span>
                                            <span className="tv-metric-value down">{results.maxDrawdownAbsolute} <span style={{ fontSize: '1rem' }}>({results.maxDrawdown})</span></span>
                                        </div>
                                    </div>

                                    <table className="tv-table">
                                        <tbody>
                                            <tr>
                                                <td>Buy & Hold Return</td>
                                                <td style={{ color: 'var(--success)' }}>{results.buyAndHoldReturn}</td>
                                                <td>Sharpe Ratio</td>
                                                <td>{results.sharpeRatio}</td>
                                            </tr>
                                            <tr>
                                                <td>Profit Factor</td>
                                                <td>{results.profitFactor}</td>
                                                <td>Sortino Ratio</td>
                                                <td>{results.sortinoRatio}</td>
                                            </tr>
                                            <tr>
                                                <td>Percentage Profitable</td>
                                                <td>{results.winRate}</td>
                                                <td>Max Contracts Held</td>
                                                <td>1</td>
                                            </tr>
                                            <tr>
                                                <td>Total Closed Trades</td>
                                                <td>{results.totalTrades}</td>
                                                <td>Avg Bars in Trade</td>
                                                <td>{results.avgBarsInTrade}</td>
                                            </tr>
                                            <tr>
                                                <td>Avg Trade</td>
                                                <td style={{ color: 'var(--success)' }}>{results.avgTrade}</td>
                                                <td>Margin Calls</td>
                                                <td>0</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            {activeTab === 'trades' && (
                                <div className="glass-panel" style={{ padding: '0', maxHeight: '600px', overflowY: 'auto' }}>
                                    <table className="tv-table" style={{ margin: 0 }}>
                                        <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-panel)', zIndex: 10, borderBottom: '1px solid var(--border-color)' }}>
                                            <tr>
                                                <th style={{ padding: '1rem 2rem' }}>Trade #</th>
                                                <th>Type</th>
                                                <th>Signal Name</th>
                                                <th>Date / Time</th>
                                                <th>Price Executed</th>
                                                <th>Net P&L</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {results.trades.map(trade => (
                                                <tr key={trade.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                                                    <td style={{ paddingLeft: '2rem', color: 'var(--text-secondary)' }}>{trade.id}</td>
                                                    <td style={{ color: trade.typeColor, fontWeight: '500' }}>{trade.type}</td>
                                                    <td style={{ color: 'var(--text-primary)' }}>{trade.signal}</td>
                                                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{trade.date}</td>
                                                    <td style={{ fontFamily: 'monospace' }}>{trade.price}</td>
                                                    <td style={{
                                                        color: trade.pnl.toString().includes('+') ? 'var(--success)' : (trade.pnl === '-' ? 'inherit' : 'var(--danger)'),
                                                        fontWeight: 'bold'
                                                    }}>
                                                        {trade.pnl}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                        </div>
                    )}

                    {/* Basic Pulse Animation Keyframes */}
                    <style dangerouslySetInnerHTML={{
                        __html: `
        @keyframes pulse {
          0% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.1); opacity: 0.7; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}} />
                </div>
            </SignedIn>
        </>
    );
}
