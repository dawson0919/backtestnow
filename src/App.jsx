import React, { useState, useEffect, useMemo } from 'react';
import { Play, Code, Upload, Database, Activity, LogOut, ChevronRight, Zap, Target, Sliders, Clock, TrendingUp, BarChart2, FileText, Settings, AlertCircle } from 'lucide-react';

export default function App() {
    const [user, setUser] = useState(null);
    const [step, setStep] = useState(1); // 1: Input, 2: Processing, 3: Results

    // Step 1 Form state
    const [asset, setAsset] = useState('BTCUSDT');
    const [assetType, setAssetType] = useState('crypto'); // 'crypto' or 'futures'
    const [capitalConfig, setCapitalConfig] = useState({ mode: 'fixed', value: 100 });
    const [code, setCode] = useState('//@version=5\nindicator("My Custom Strategy")\n');
    const [paramMode, setParamMode] = useState('manual'); // 'manual' or 'ai'
    const [iterations, setIterations] = useState(1000);

    // Custom Param Constraints
    const [params, setParams] = useState([
        { name: 'length', min: 10, max: 50 },
        { name: 'multiplier', min: 1.0, max: 4.0 },
        { name: 'stopLoss', min: 1, max: 10 }
    ]);

    // Step 2 Progress state
    const [progress, setProgress] = useState(0);
    const [logs, setLogs] = useState([]);

    // Step 3 Results state
    const [results, setResults] = useState(null);
    const [activeTab, setActiveTab] = useState('summary'); // 'overview' | 'summary' | 'trades'

    const handleGoogleLogin = () => {
        // Mock Google Login
        setUser({
            name: 'Pro Trader',
            email: 'pro@trading.com',
            avatar: 'https://ui-avatars.com/api/?name=Pro+Trader&background=2962ff&color=fff'
        });
    };

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
                bestParams: {
                    length: paramMode === 'ai' ? 21 : Math.floor((Number(params[0].min) + Number(params[0].max)) / 2),
                    multiplier: paramMode === 'ai' ? 2.6 : 2.5,
                    stopLoss: "3.5%",
                    takeProfit: "8.2%"
                }
            });
            setStep(3);
        }, 10000); // Demo completes in 10s regardless of requested time for UX
    };

    if (!user) {
        return (
            <div className="app-container">
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
                    <div style={{ padding: '3rem', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '1.5rem', boxShadow: '0 20px 50px rgba(0,0,0,0.5)', maxWidth: '500px', width: '100%' }}>
                        <Activity size={72} color="var(--accent)" style={{ marginBottom: '1.5rem' }} />
                        <h1 style={{ fontSize: '2.5rem', marginBottom: '1rem', color: 'var(--text-highlight)' }}>BacktestNOW<span style={{ color: 'var(--accent)' }}>.</span></h1>
                        <p style={{ color: 'var(--text-secondary)', marginBottom: '3rem', lineHeight: '1.6' }}>
                            Upload your PineScript. Harness Deep AI Optimization over maximum historical K-lines (1D to 15m) to uncover the highest ROI parameters instantly.
                        </p>
                        <button className="btn btn-primary" onClick={handleGoogleLogin} style={{ width: '100%', justifyContent: 'center', padding: '1.2rem', fontSize: '1.1rem' }}>
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style={{ marginRight: '10px' }}>
                                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                            </svg>
                            Sign in with Google
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="app-container">
            <header>
                <div className="logo">
                    <Activity color="var(--accent)" />
                    BacktestNOW
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <img src={user.avatar} alt="Avatar" style={{ width: 32, height: 32, borderRadius: '50%' }} />
                        <span style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>{user.name}</span>
                    </div>
                    <button className="btn" onClick={() => setUser(null)}>
                        <LogOut size={16} /> Logout
                    </button>
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
                                            <option value="BTCUSDT">BTC/USDT (Bitcoin)</option>
                                            <option value="ETHUSDT">ETH/USDT (Ethereum)</option>
                                            <option value="SOLUSDT">SOL/USDT (Solana)</option>
                                            <option value="BNBUSDT">BNB/USDT (Binance)</option>
                                            <option value="XAUTUSDT">XAUT/USDT (Tether Gold - 加密期貨概念)</option>
                                        </>
                                    ) : (
                                        <>
                                            <option value="GC!">GC! (Gold Futures / 黃金)</option>
                                            <option value="ES!">ES! (E-mini S&P 500)</option>
                                            <option value="NQ!">NQ! (Nasdaq 100)</option>
                                            <option value="CL!">CL! (Crude Oil)</option>
                                        </>
                                    )}
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
                                <label className="form-label" style={{ marginBottom: '1rem' }}>Define Limits (Min / Max)</label>
                                {params.map((p, idx) => (
                                    <div key={idx} className="param-row">
                                        <span style={{ width: '80px', fontSize: '0.9rem', color: 'var(--text-primary)' }}>{p.name}</span>
                                        <input type="number" className="form-input" value={p.min} onChange={e => handleParamChange(idx, 'min', e.target.value)} placeholder="Min" />
                                        <span style={{ color: 'var(--text-secondary)' }}>—</span>
                                        <input type="number" className="form-input" value={p.max} onChange={e => handleParamChange(idx, 'max', e.target.value)} placeholder="Max" />
                                    </div>
                                ))}
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

                                <div className="chart-placeholder">
                                    [ Interactive Equity Curve Chart Placeholder ]
                                </div>

                                <div style={{ background: 'var(--bg-panel)', padding: '1.5rem', borderRadius: '0.5rem', border: '1px solid var(--border-color)' }}>
                                    <h4 style={{ color: 'var(--text-highlight)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <Target size={18} color="var(--accent)" /> AI Discovered Best Parameters
                                    </h4>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
                                        {Object.entries(results.bestParams).map(([key, val]) => (
                                            <div key={key} style={{ background: 'var(--bg-surface)', padding: '1rem', borderRadius: '0.5rem', border: '1px solid rgba(255,255,255,0.05)' }}>
                                                <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', textTransform: 'uppercase', marginBottom: '0.5rem' }}>{key}</div>
                                                <div style={{ color: 'var(--text-highlight)', fontSize: '1.2rem', fontWeight: 'bold' }}>{val}</div>
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
                        <div className="glass-panel" style={{ padding: '2rem' }}>
                            <table className="tv-table">
                                <thead>
                                    <tr>
                                        <th>Trade #</th>
                                        <th>Type</th>
                                        <th>Signal</th>
                                        <th>Date / Time</th>
                                        <th>Price</th>
                                        <th>Profit/Loss</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {/* Mock data */}
                                    <tr><td>452</td><td style={{ color: 'var(--danger)' }}>Exit Short</td><td>Take Profit</td><td>2026-02-21 14:30</td><td>$61,240.50</td><td style={{ color: 'var(--success)' }}>+340.20</td></tr>
                                    <tr><td>451</td><td style={{ color: 'var(--danger)' }}>Entry Short</td><td>AI Trend</td><td>2026-02-21 08:15</td><td>$61,580.70</td><td>-</td></tr>
                                    <tr><td>450</td><td style={{ color: 'var(--success)' }}>Exit Long</td><td>Trailing Stop</td><td>2026-02-19 22:00</td><td>$60,100.00</td><td style={{ color: 'var(--success)' }}>+850.50</td></tr>
                                    <tr><td>449</td><td style={{ color: 'var(--success)' }}>Entry Long</td><td>MA Cross</td><td>2026-02-18 10:45</td><td>$59,249.50</td><td>-</td></tr>
                                    <tr><td>448</td><td style={{ color: 'var(--danger)' }}>Exit Short</td><td>Stop Loss</td><td>2026-02-15 16:30</td><td>$58,400.00</td><td style={{ color: 'var(--danger)' }}>-150.00</td></tr>
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
    );
}
