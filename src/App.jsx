import React, { useState, useEffect, useMemo } from 'react';
import { Play, Code, Upload, Database, Activity, LogOut, ChevronRight, Zap, Target, Sliders, Clock, TrendingUp, BarChart2, FileText, Settings, AlertCircle, ArrowRight, CheckCircle2, Shield, Sparkles, History, Trash2, Download } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Label } from 'recharts';
import { supabase } from './supabaseClient';
import { SignedIn, SignedOut, SignInButton, UserButton, useUser } from "@clerk/clerk-react";

const SAMPLE_STRATEGY_CODE = `//@version=5
strategy("三刀流 - 黃金 1H 趨勢策略", overlay=true, initial_capital=10000, default_qty_type=strategy.percent_of_equity, default_qty_value=100, commission_type=strategy.commission.cash_per_order, )

// --- 參數設定 ---
fast_len = input.int(8, "快線週期 (Fast EMA)", minval=1)
mid_len  = input.int(15, "中線週期 (Mid EMA)", minval=1)
slow_len = input.int(30, "慢線週期 (Slow EMA)", minval=1)

// --- 指標計算 ---
ema_fast = ta.ema(close, fast_len)
ema_mid  = ta.ema(close, mid_len)
ema_slow = ta.ema(close, slow_len)

// --- 多空排列邏輯 ---
// 多頭排列：快 > 中 > 慢
bullish_alignment = ema_fast > ema_mid and ema_mid > ema_slow
// 空頭排列：快 < 中 < 慢
bearish_alignment = ema_fast < ema_mid and ema_mid < ema_slow

// --- 進場與出場訊號 ---
// 進場：排列剛形成時
long_condition  = bullish_alignment and not bullish_alignment[1]
short_condition = bearish_alignment and not bearish_alignment[1]

// 出場：只要快線越過中線，即視為趨勢轉弱或反轉
exit_long_condition  = ema_fast < ema_mid
exit_short_condition = ema_fast > ema_mid

// --- 執行交易 ---
// 多單執行
if (long_condition)
    strategy.entry("三刀流-多", strategy.long, comment="三刀開路-多")

if (strategy.position_size > 0 and exit_long_condition)
    strategy.close("三刀流-多", comment="趨勢破位-平多")

// 空單執行
if (short_condition)
    strategy.entry("三刀流-空", strategy.short, comment="三刀開路-空")

if (strategy.position_size < 0 and exit_short_condition)
    strategy.close("三刀流-空", comment="趨勢破位-平空")

// --- 圖表視覺化 ---
plot(ema_fast, color=color.new(color.yellow, 0), title="快線 (EMA 8)", linewidth=2)
plot(ema_mid,  color=color.new(color.orange, 0), title="中線 (EMA 15)", linewidth=2)
plot(ema_slow, color=color.new(color.red, 0),    title="慢線 (EMA 30)", linewidth=2)

// 背景顏色填充
fill_color = bullish_alignment ? color.new(color.green, 90) : bearish_alignment ? color.new(color.red, 90) : na
bgcolor(fill_color, title="趨勢背景")

// 繪製進場標籤
plotshape(long_condition,  style=shape.triangleup,   location=location.belowbar, color=color.green, size=size.small, title="進場-多")
plotshape(short_condition, style=shape.triangledown, location=location.abovebar, color=color.red,   size=size.small, title="進場-空")

// --- 警報設定 ---
alertcondition(long_condition,  title="三刀流多頭進場", message="黃金 1H 多頭排列形成，建議做多")
alertcondition(short_condition, title="三刀流空頭進場", message="黃金 1H 空頭排列形成，建議做空")`;

const ADMIN_EMAIL = 'nbamoment@gmail.com';
const BASIC_LIMIT = 30;

export default function App() {
    const { user } = useUser();
    const [step, setStep] = useState(0); // 0: Landing, 1: Input, 2: Processing, 3: Results, 4: History, 5: Admin
    const [history, setHistory] = useState([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);

    // --- Membership State ---
    const [userRole, setUserRole] = useState('basic'); // 'basic', 'vip', 'admin'
    const [usageCount, setUsageCount] = useState(0);
    const [showApplyModal, setShowApplyModal] = useState(false);
    const [applyScreenshot, setApplyScreenshot] = useState(null);
    const [applyStatus, setApplyStatus] = useState(null); // null | 'uploading' | 'done' | 'error'
    const [applyMessage, setApplyMessage] = useState('');

    // --- Admin State ---
    const [adminApplications, setAdminApplications] = useState([]);
    const [isLoadingAdmin, setIsLoadingAdmin] = useState(false);


    // -------------------------------------------------------------------------
    // === 步驟 1 (Step 1)：環境與參數設定狀態 ===
    // -------------------------------------------------------------------------
    const [asset, setAsset] = useState('BTCUSDT');
    const [assetType, setAssetType] = useState('crypto');
    const [capitalConfig, setCapitalConfig] = useState({ mode: 'fixed', value: 10000 });
    const [code, setCode] = useState('//@version=5\nindicator("My Custom Strategy")\n');
    const [paramMode, setParamMode] = useState('manual'); // 'manual' 手動模式 或 'ai' AI代理模式
    const [iterations, setIterations] = useState(1000); // 蒙地卡羅/參數窮舉回測的迭代次數
    const [timeframe, setTimeframe] = useState('1H'); // K線時間週期

    // 資產清單 (自 Supabase 資料庫撈取)
    const [dbAssets, setDbAssets] = useState({ crypto: [], futures: [] });
    const [isLoadingAssets, setIsLoadingAssets] = useState(true);

    // Custom Param Constraints with AI recognition annotations
    const [params, setParams] = useState([
        { name: 'length', min: 10, max: 50, step: 1, desc: '技術指標的回溯週期，影響趨勢判定與交易訊號的靈敏度。' },
        { name: 'multiplier', min: 1.0, max: 4.0, step: 0.1, desc: 'ATR 或標準差的乘數，用以動態擴增止損範圍與信道寬度。' },
        { name: 'stopLoss', min: 1, max: 10, step: 0.5, desc: '硬性止損百分比 (Stop Loss %)，確保風控在單筆交易中的最大虧損界限。' },
        { name: 'takeProfit', min: 2, max: 20, step: 0.5, desc: '強制止盈百分比 (Take Profit %)，達到預期報酬即落袋為安。' },
        { name: 'holdingTime', min: 1, max: 24, step: 1, desc: '最長持倉根數 (Max Holding Bars)，避免因盤整耗損資金利用率。' },
        { name: 'trailingStop', min: 0.5, max: 5, step: 0.1, desc: '移動停利 (Trailing Stop %)，隨著利潤擴大逐步提高出場線保護利潤。' }
    ]);

    // -------------------------------------------------------------------------
    // === 步驟 2 (Step 2)：回測進度與終端機輸出 ===
    // -------------------------------------------------------------------------
    const [progress, setProgress] = useState(0); // 讀條進度 (0-100)
    const [logs, setLogs] = useState([]); // 給使用者看的操作日誌陣列

    // -------------------------------------------------------------------------
    // === 步驟 3 (Step 3)：回測結果與圖表介面 ===
    // -------------------------------------------------------------------------
    const [results, setResults] = useState(null); // 回測結果的資料結構
    const [activeTab, setActiveTab] = useState('summary'); // 當前選中的分析分頁

    const loadSampleStrategy = () => {
        setAssetType('futures');
        setAsset('GC!');
        setCapitalConfig({ mode: 'contracts', value: 1 });
        setTimeframe('1H');
        setCode(SAMPLE_STRATEGY_CODE);
        addLog("已加載範例策略：三刀流 - 黃金 1H 趨勢策略", "info");
    };

    const fetchHistory = async () => {
        if (!user || !supabase) return;
        setIsLoadingHistory(true);
        const { data, error } = await supabase
            .from('optimization_history')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(10);

        if (!error && data) {
            setHistory(data);
        }
        setIsLoadingHistory(false);
    };

    const saveToHistory = async (resultsData) => {
        if (!user || !supabase) return;

        // 1. Check current count
        const { count } = await supabase
            .from('optimization_history')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id);

        // 2. If >= 10, delete oldest
        if (count >= 10) {
            const { data: oldest } = await supabase
                .from('optimization_history')
                .select('id')
                .eq('user_id', user.id)
                .order('created_at', { ascending: true })
                .limit(1);

            if (oldest?.[0]) {
                await supabase.from('optimization_history').delete().eq('id', oldest[0].id);
            }
        }

        // 3. Insert new
        await supabase.from('optimization_history').insert({
            user_id: user.id,
            asset: resultsData.asset,
            timeframe: timeframe,
            code: code,
            net_profit_pct: resultsData.netProfitPct,
            top_params: resultsData.topStrategies[0].params
        });

        fetchHistory(); // Refresh
    };

    const deleteHistoryItem = async (e, id) => {
        e.stopPropagation();
        if (!supabase) return;
        await supabase.from('optimization_history').delete().eq('id', id);
        fetchHistory();
    };

    const loadHistoryItem = (item) => {
        setCode(item.code);
        setAsset(item.asset);
        setTimeframe(item.timeframe);
        addLog(`已還原歷史紀錄：${item.asset} (${item.created_at})`, "info");
        setStep(1);
    };


    // --- Fetch User Status (Membership) ---
    useEffect(() => {
        if (!user) return;
        fetchStatus();
    }, [user]);

    const fetchStatus = async () => {
        try {
            const resp = await fetch(`/api/user/status?userId=${user.id}&email=${user.primaryEmailAddress?.emailAddress || ''}`);
            const data = await resp.json();
            if (data) {
                setUserRole(data.role || 'basic');
                setUsageCount(data.usageCount || 0);
            }
        } catch (e) {
            console.error("Status check failed", e);
        }
    };

    // --- Fetch Admin Applications ---
    useEffect(() => {
        if (userRole === 'admin' && step === 5) {
            fetchAdminApplications();
        }
    }, [userRole, step]);

    const fetchAdminApplications = async () => {
        if (!supabase) return;
        setIsLoadingAdmin(true);
        try {
            const { data } = await supabase.from('vip_applications').select('*').order('created_at', { ascending: false });
            setAdminApplications(data || []);
        } catch (e) {
            console.error("Admin fetch failed", e);
        } finally {
            setIsLoadingAdmin(false);
        }
    };

    const handleAdminReview = async (applicationId, action) => {
        try {
            const apiBase = import.meta.env.PROD ? '' : 'http://localhost:3001';
            const email = user.primaryEmailAddress?.emailAddress || '';
            const res = await fetch(`${apiBase}/api/admin/review`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, applicationId, action })
            });
            const data = await res.json();
            if (data.success) fetchAdminApplications();
            else alert(data.error || '審核提交失敗');
        } catch (e) {
            alert('系統錯誤');
        }
    };


    // VIP Application: upload screenshot then submit
    const handleApplyVip = async () => {
        if (!applyScreenshot) { setApplyMessage('請先選擇截圖檔案'); return; }
        setApplyStatus('uploading');
        setApplyMessage('正在上傳截圖...');
        try {
            if (!supabase) throw new Error('Supabase configuration is missing');
            const file = applyScreenshot;
            const ext = file.name.split('.').pop();
            const path = `${user.id}_${Date.now()}.${ext}`;
            const { error: uploadError } = await supabase.storage
                .from('vip-screenshots')
                .upload(path, file, { upsert: true });

            if (uploadError) throw new Error(uploadError.message);

            if (!supabase) throw new Error('Supabase client missing');
            const { data: urlData } = supabase.storage.from('vip-screenshots').getPublicUrl(path);
            const screenshotUrl = urlData.publicUrl;

            const apiBase = import.meta.env.PROD ? '' : 'http://localhost:3001';
            const res = await fetch(`${apiBase}/api/user/apply-vip`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: user.id,
                    email: user.primaryEmailAddress?.emailAddress || '',
                    userName: user.fullName || user.firstName || '',
                    screenshotUrl
                })
            });
            const data = await res.json();
            setApplyStatus(data.success ? 'done' : 'error');
            setApplyMessage(data.success ? data.message : data.error);
        } catch (e) {
            setApplyStatus('error');
            setApplyMessage('上傳失敗：' + e.message);
        }
    };

    // 從 Supabase 抓取可交易的市場資產列表，這會在組件掛載時觸發一次
    useEffect(() => {
        // Fetch DB Assets
        const fetchAssets = async () => {
            if (!supabase) {
                console.warn("Supabase not initialized, using default assets.");
                setIsLoadingAssets(false);
                return;
            }
            try {
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
            } catch (e) {
                console.error("Failed to fetch assets", e);
            }
            setIsLoadingAssets(false);
        };

        fetchAssets();
    }, []);

    // -------------------------------------------------------------------------
    // === 核心功能：動態從 PineScript 程式碼中解析萃取使用者參數 ===
    // -------------------------------------------------------------------------
    useEffect(() => {
        // 這是作為回測常駐防禦與風控機制的「預設底層參數」，無論腳本長怎樣都會掛載
        const defaultRiskParams = [
            { name: 'stopLoss', min: 1, max: 10, step: 0.5, desc: '硬性止損百分比 (Stop Loss %)，確保風控在單筆交易中的最大虧損界限。' },
            { name: 'takeProfit', min: 2, max: 20, step: 0.5, desc: '強制止盈百分比 (Take Profit %)，達到預期報酬即落袋為安。' },
            { name: 'holdingTime', min: 1, max: 24, step: 1, desc: '最長持倉根數 (Max Holding Bars)，避免因盤整耗損資金利用率。' },
            { name: 'trailingStop', min: 0.5, max: 5, step: 0.1, desc: '移動停利 (Trailing Stop %)，隨著利潤擴大逐步提高出場線保護利潤。' }
        ];

        // 使用 setTimeout 防抖動處理 (Debounce)，避免使用者每打一個字就重新計算
        const timer = setTimeout(() => {
            const lines = code.split('\n'); // 將腳本按行切開
            const extractedParams = [];

            lines.forEach(line => {
                const trimmed = line.trim();
                // 忽略被註解掉的那一行程式碼
                if (trimmed.startsWith('//')) return;

                // 【強大正則匹配】：尋找 TradingView 變數賦值，例如 varName = input(123) 或是 varName = input.int(123, title="...")
                const match = trimmed.match(/([a-zA-Z0-9_]+)\s*=\s*input(?:\.(?:int|float))?\(/);

                if (match) {
                    const varName = match[1]; // 取出在腳本中宣告的變數名稱
                    // 嘗試尋找 title 屬性來作為畫面上的中文提示
                    const titleMatch = trimmed.match(/title\s*=\s*['"]([^'"]+)['"]/);
                    const desc = titleMatch ? `(自定義參數) ${titleMatch[1]}` : `(自定義腳本參數) ${varName}`;

                    let defVal = null;
                    // 嘗試在一開始或是透過 defval 找出預設數字
                    const firstArgMatch = trimmed.match(/input(?:\.\w+)?\(\s*([\d.]+)/);

                    if (firstArgMatch && !isNaN(parseFloat(firstArgMatch[1]))) {
                        defVal = parseFloat(firstArgMatch[1]);
                    } else {
                        const defvalMatch = trimmed.match(/defval\s*=\s*([\d.]+)/);
                        if (defvalMatch) defVal = parseFloat(defvalMatch[1]);
                    }

                    // 根據預設值大小，幫使用者生成一個合理的初始上下限掃描空間 (Min / Max Bound)
                    let min = 1;
                    let max = 100;
                    if (defVal !== null) {
                        min = defVal > 5 ? Math.floor(defVal * 0.5) : (defVal > 0 ? 0.1 : 0);
                        max = defVal > 5 ? Math.ceil(defVal * 2) : 10;
                        if (max <= min) max = min + 10;
                    }

                    // 如果使用者本就明確賦予腳本 minval 或 maxval 的標籤，優先依照使用者定義覆寫！
                    const explicitMin = trimmed.match(/minval\s*=\s*([-\d.]+)/);
                    if (explicitMin) min = parseFloat(explicitMin[1]);

                    const explicitMax = trimmed.match(/maxval\s*=\s*([-\d.]+)/);
                    if (explicitMax) max = parseFloat(explicitMax[1]);

                    extractedParams.push({
                        name: varName,
                        min: min,
                        max: max,
                        step: 1,
                        desc: desc
                    });
                }
            });

            // 如果什麼都沒抓到，就隨便配個兩組當做範例
            if (extractedParams.length === 0) {
                extractedParams.push(
                    { name: 'length', min: 10, max: 50, step: 1, desc: '技術指標的回溯週期，影響趨勢判定與交易訊號的靈敏度。' },
                    { name: 'multiplier', min: 1.0, max: 4.0, step: 0.1, desc: 'ATR 或標準差的乘數，用以動態擴增止損範圍與信道寬度。' }
                );
            }

            // 只有在參數長度變動或結構不一樣時才更新 React State，避免使用者在輸入框打字時因為反覆渲染而跳掉 (閃爍防呆機制)
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

    // -------------------------------------------------------------------------
    // === 介面輔助功能：計算並回傳預估執行時間字串 ===
    // -------------------------------------------------------------------------
    const totalCombinations = useMemo(() => {
        if (paramMode !== 'manual') return 0;
        let total = 1;
        params.forEach(p => {
            const range = Math.max(0, Number(p.max) - Number(p.min));
            // Check for valid step
            const stepVal = Number(p.step);
            const step = (isNaN(stepVal) || stepVal <= 0) ? 1 : stepVal;
            const count = Math.floor(range / step) + 1;
            total *= count;
        });
        return total;
    }, [params, paramMode]);

    const estimatedMinutes = useMemo(() => {
        // In manual mode, if combinations are reasonable, use them. Otherwise use iterations limit.
        const count = (paramMode === 'manual' && totalCombinations > 0) ? Math.min(totalCombinations, iterations) : iterations;
        const timeInSeconds = count * 0.1;
        if (timeInSeconds < 60) return `${Math.ceil(timeInSeconds)} 秒`;
        return `${Math.ceil(timeInSeconds / 60)} 分鐘`;
    }, [iterations, totalCombinations, paramMode]);

    // -------------------------------------------------------------------------
    // === 介面輔助功能：增加操作日誌至畫面輸出區 (Console Log 效果) ===
    // -------------------------------------------------------------------------
    const addLog = (msg, type = 'normal') => {
        const time = new Date().toLocaleTimeString('en-US', { hour12: false });
        setLogs(prev => [...prev, { time, msg, type }]);
    };

    // -------------------------------------------------------------------------
    // === 觸發：修改畫面當中單一輸入框的數值 ===
    // -------------------------------------------------------------------------
    const handleParamChange = (index, field, value) => {
        const newParams = [...params];
        newParams[index][field] = value;
        setParams(newParams);
    };

    // -------------------------------------------------------------------------
    // === 核心觸發器：啟動模擬回測工作串流 ===
    // -------------------------------------------------------------------------
    const handleStartBacktest = async () => {
        if (!code) {
            alert("請上傳或貼上 PineScript 程式碼！");
            return;
        }

        // 切換至第二步驟畫面 (載入與進度展示)
        setStep(2);
        setProgress(0);
        setLogs([]);

        addLog("正在初始化回測引擎 Ver. 2.4.1", "info");

        if (paramMode === 'ai') {
            addLog("AI 正在將自定義趨勢/動能洞察注入邊界優化中...", "highlight");
        }

        await new Promise(res => setTimeout(res, 1000));
        setProgress(15);
        addLog(`正在獲取 ${asset} 的深度歷史數據...`);
        addLog(`正在整合多個時間週期 (1D, 4H, 1H, 15m) 以確保最大真實度。`);

        await new Promise(res => setTimeout(res, 1500));
        setProgress(30);
        addLog(`正編譯 PineScript v5 邏輯...`, 'info');

        await new Promise(res => setTimeout(res, 2000));
        setProgress(45);
        if (paramMode === 'ai') {
            addLog(`AI 模式已啟用：自動掃描參數維度與關聯性...`, 'highlight');
        } else {
            addLog(`手動模式：將邊界與間距限制在用戶定義的範圍內...`);
        }

        const actualIterations = (paramMode === 'manual' && totalCombinations > 0) ? Math.min(totalCombinations, iterations) : iterations;
        addLog(`開始進行 ${actualIterations.toLocaleString()} 次迭代的優化搜尋！`, "highlight");

        await new Promise(res => setTimeout(res, 2000));
        setProgress(75);
        addLog(`[Batch 1-${Math.floor(iterations / 2)}] 已評估。正在連接回測引擎...`);

        await new Promise(res => setTimeout(res, 2000));
        setProgress(90);
        addLog(`正在透過 ${assetType === 'crypto' ? '幣安 (Binance)' : 'Yahoo Finance'} 數據生成真實歷史交易...`);

        // 發送真實歷史回測請求到本地後端引擎
        try {
            const paramConfig = {};
            params.forEach(p => {
                paramConfig[p.name] = Math.floor((Number(p.min) + Number(p.max)) / 2);
            });

            const apiBase = import.meta.env.PROD ? '' : 'http://localhost:3001';
            const res = await fetch(`${apiBase}/api/backtest`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    asset,
                    timeframe,
                    paramConfig,
                    capitalConfig,
                    userId: user?.id,
                    userEmail: user?.primaryEmailAddress?.emailAddress || ''
                })
            });

            const data = await res.json();

            if (!data.success) {
                if (data.error === 'USAGE_LIMIT_EXCEEDED') {
                    setStep(1);
                    setShowApplyModal(true);
                    return;
                }
                alert("回測引擎發生錯誤: " + data.error);
                setStep(1);
                return;
            }

            // Refresh usage count after successful backtest
            setUsageCount(prev => prev + 1);

            const {
                trades, chartData, netProfit, netProfitPct, grossProfit, grossLoss,
                maxDrawdownPct, maxDrawdownAbs, totalTrades, winningTrades, buyAndHoldReturn,
                sharpeRatio, sortinoRatio, profitFactor, winRateStr,
                topStrategies: serverTopStrategies, paramConfig: bestParams, avgBarsInTrade
            } = data;

            setProgress(100);

            // --- Rewrite PineScript with the actual best parameters found by the engine ---
            const rewrittenCode = (() => {
                let optimizedCode = code;
                const optimizedParams = bestParams || paramConfig;
                const notInjected = {};

                // Replace existing input() declarations with optimized values
                Object.entries(optimizedParams).forEach(([varName, optimizedValue]) => {
                    const lineRegex = new RegExp(
                        `^(\\s*${varName}\\s*=\\s*input(?:\\.(?:int|float|bool))?)\\(([^,)]+)`,
                        'gm'
                    );
                    const newCode = optimizedCode.replace(lineRegex, (match, prefix, _oldVal) => {
                        return `${prefix}(${optimizedValue}`;
                    });
                    if (newCode === optimizedCode) {
                        notInjected[varName] = optimizedValue;
                    }
                    optimizedCode = newCode;
                });

                // Build header with OPTIMIZED values
                const header = [
                    `//@version=5`,
                    `// ═══════════════════════════════════════════════════════════`,
                    `// 🤖 AI 優化版 PineScript`,
                    `// 標的     : ${asset}`,
                    `// 優化時間 : ${new Date().toLocaleString('zh-TW')}`,
                    `// 優化參數 : ${Object.entries(optimizedParams).map(([k, v]) => `${k}=${v}`).join(', ')}`,
                    `// ═══════════════════════════════════════════════════════════`,
                    ``
                ].join('\n');

                const codeWithoutVersion = optimizedCode.replace(/^\/\/@version=\d+\s*/m, '');

                // If risk params have no matching input() lines, inject them AFTER strategy() call
                if (Object.keys(notInjected).length > 0) {
                    const sl = notInjected.stopLoss ?? 2;
                    const tp = notInjected.takeProfit ?? 5;
                    const ts = notInjected.trailingStop ?? 1;
                    const ht = notInjected.holdingTime ?? 8;

                    const inputDecls = Object.entries(notInjected).map(([k, v]) => {
                        const isInt = Number.isInteger(Number(v));
                        const fn = isInt ? 'input.int' : 'input.float';
                        const step = isInt ? 1 : 0.5;
                        return `${k} = ${fn}(${v}, title="${k} (AI 優化)", step=${step})`;
                    }).join('\n');

                    const exitBlock = [
                        ``,
                        `// ── AI 注入的風控退場邏輯 ──`,
                        `// 以下程式碼使用上方 AI 優化後的風控參數，自動設定停損/停利/移動停利/最長持倉`,
                        `if strategy.position_size > 0`,
                        `    strategy.exit("AI_Exit_Long",`,
                        `        from_entry = "Long",`,
                        `        stop   = strategy.position_avg_price * (1 - ${sl}/100),`,
                        `        limit  = strategy.position_avg_price * (1 + ${tp}/100),`,
                        `        trail_offset = strategy.position_avg_price * ${ts}/100 / syminfo.mintick)`,
                        `if strategy.position_size < 0`,
                        `    strategy.exit("AI_Exit_Short",`,
                        `        from_entry = "Short",`,
                        `        stop   = strategy.position_avg_price * (1 + ${sl}/100),`,
                        `        limit  = strategy.position_avg_price * (1 - ${tp}/100),`,
                        `        trail_offset = strategy.position_avg_price * ${ts}/100 / syminfo.mintick)`,
                        `// 最長持倉 ${ht} 根K棒強制出場`,
                        `if strategy.position_size != 0 and bar_index - strategy.opentrades.entry_bar_index(0) >= ${ht}`,
                        `    strategy.close_all("AI_MaxHold")`,
                    ].join('\n');

                    // Insert input declarations right after strategy() / indicator() call
                    const lines = codeWithoutVersion.split('\n');
                    let insertIdx = 0;
                    let depth = 0;
                    let foundCall = false;
                    for (let i = 0; i < lines.length; i++) {
                        const t = lines[i].trim();
                        if (!foundCall && (t.startsWith('strategy(') || t.startsWith('indicator('))) {
                            foundCall = true;
                        }
                        if (foundCall) {
                            for (const ch of lines[i]) {
                                if (ch === '(') depth++;
                                else if (ch === ')') depth--;
                            }
                            if (depth <= 0) { insertIdx = i + 1; break; }
                        }
                    }

                    const injected = [
                        ...lines.slice(0, insertIdx),
                        ``,
                        `// ── AI 注入的風控輸入參數 ──`,
                        inputDecls,
                        ...lines.slice(insertIdx),
                    ].join('\n');

                    return header + injected + exitBlock;
                }

                return header + codeWithoutVersion;
            })();
            const currencySymbol = assetType === 'crypto' ? 'USDT' : 'USD';
            const defaultCapital = assetType === 'crypto' ? 10000 : 50000;
            const actualInitialCapital = capitalConfig?.mode === 'fixed' && capitalConfig?.value
                ? Number(capitalConfig.value)
                : defaultCapital;
            const backtestDate = new Date().toLocaleString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

            setResults({
                asset,
                iterationsUsed: actualIterations,
                capitalConfig,
                assetType,
                rewrittenCode,
                backtestDate,
                initialCapital: actualInitialCapital,
                currencySymbol,
                chartData: chartData,
                netProfit: `${netProfit > 0 ? '+' : ''}${netProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currencySymbol}`,
                netProfitPct: `${netProfit > 0 ? '+' : ''}${netProfitPct}%`,
                grossProfit: grossProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                grossLoss: `-${grossLoss.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                maxDrawdown: `${maxDrawdownPct.toFixed(2)}%`,
                maxDrawdownAbsolute: `-${maxDrawdownAbs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currencySymbol}`,
                buyAndHoldReturn: `${Number(buyAndHoldReturn) >= 0 ? '+' : ''}${buyAndHoldReturn}%`,
                sharpeRatio,
                sortinoRatio,
                profitFactor,
                winRate: `${winRateStr}%`,
                totalTrades: totalTrades.toString(),
                avgTrade: totalTrades > 0 ? `${netProfit > 0 ? '+' : ''}${(netProfit / totalTrades).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currencySymbol}` : '0',
                avgBarsInTrade: avgBarsInTrade ?? '無資料',
                topStrategies: serverTopStrategies || [],
                trades: trades
            });

            // Auto save to history
            saveToHistory({
                asset,
                netProfitPct: `${netProfit > 0 ? '+' : ''}${netProfitPct}%`,
                topStrategies: [
                    { params: paramConfig }
                ]
            });

            setStep(3);

        } catch (err) {
            alert('後端連線失敗: 確保 server.js 有開啟! ' + err.message);
            setStep(1);
        }
    };

    return (
        <>
            <SignedOut>
                <div className="landing-page">
                    <header>
                        <div className="logo">
                            <Activity color="var(--accent)" />
                            BacktestNOW
                        </div>
                        <SignInButton mode="modal">
                            <button className="btn btn-primary">登入 / 註冊</button>
                        </SignInButton>
                    </header>

                    <section className="hero">
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'rgba(41, 98, 255, 0.1)', padding: '0.5rem 1rem', borderRadius: '2rem', color: 'var(--accent)', fontSize: '0.85rem', fontWeight: '600', marginBottom: '2rem' }}>
                            <Sparkles size={16} /> 2024 AI 策略優化引擎全新進化
                        </div>
                        <h1>BacktestNow<br />AI 強力驅動回測</h1>
                        <p>將您的 TradingView PineScript 策略優化至極致。運用自動化參數掃描與深度數據分析，助您在多變市場中精準點擊，奪得交易先機。</p>
                        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
                            <SignInButton mode="modal">
                                <button className="btn btn-primary btn-xl">
                                    立即開始免費體驗 <ArrowRight size={20} />
                                </button>
                            </SignInButton>
                        </div>
                    </section>

                    <h2 className="section-title">網站核心功能</h2>
                    <section className="features-grid">
                        <div className="feature-card">
                            <Zap className="feature-icon" color="var(--accent)" />
                            <h3>AI 參數自動遍歷</h3>
                            <p>告別手動調整！AI 引擎自動執行數千次迭代，精確找出各種市場狀況下的最佳參數範圍。</p>
                        </div>
                        <div className="feature-card">
                            <Database className="feature-icon" color="var(--success)" />
                            <h3>數據整合</h3>
                            <p>整合幣安等主流交易所數據，確保回測結果最接近真實市場反應。</p>
                        </div>
                        <div className="feature-card">
                            <Target className="feature-icon" color="var(--danger)" />
                            <h3>多維度績效評估</h3>
                            <p>提供 Sharpe Ratio、Sortino、最大回撤等專業指標，全方位衡量策略穩定性。</p>
                        </div>
                    </section>
                </div>
            </SignedOut>

            <SignedIn>
                <div className="app-container">
                    <header>
                        <div className="logo" onClick={() => setStep(0)} style={{ cursor: 'pointer' }}>
                            <Activity color="var(--accent)" />
                            BacktestNOW
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            {/* Usage badge */}
                            {userRole === 'basic' && (
                                <div
                                    onClick={() => setShowApplyModal(true)}
                                    style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '0.35rem 0.75rem', borderRadius: '2rem', background: usageCount >= BASIC_LIMIT ? 'rgba(239,83,80,0.15)' : 'rgba(41,98,255,0.1)', border: `1px solid ${usageCount >= BASIC_LIMIT ? 'var(--danger)' : 'var(--accent)'}`, cursor: 'pointer', fontSize: '0.8rem', color: usageCount >= BASIC_LIMIT ? 'var(--danger)' : 'var(--accent)', fontWeight: '600' }}
                                    title="點擊申請 VIP 解鎖無限次數"
                                >
                                    <Zap size={14} /> {usageCount}/{BASIC_LIMIT} 次 · 申請升級
                                </div>
                            )}
                            {userRole === 'vip' && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '0.35rem 0.75rem', borderRadius: '2rem', background: 'rgba(0,195,124,0.1)', border: '1px solid var(--success)', fontSize: '0.8rem', color: 'var(--success)', fontWeight: '600' }}>
                                    <Shield size={14} /> VIP · 無限次數
                                </div>
                            )}
                            {userRole === 'admin' && (
                                <button className="btn" onClick={() => { fetchAdminApplications(); setStep(5); }} style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}>
                                    <Settings size={14} /> 管理後台
                                </button>
                            )}
                            <button className="btn btn-history" onClick={() => { fetchHistory(); setStep(4); }}>
                                <History size={18} /> 歷史紀錄
                            </button>
                            <span style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>{user?.fullName || user?.firstName || 'Trader'}</span>
                            <UserButton />
                        </div>
                    </header>

                    {step === 0 && (
                        <div className="landing-page">
                            <section className="hero">
                                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'rgba(41, 98, 255, 0.1)', padding: '0.5rem 1rem', borderRadius: '2rem', color: 'var(--accent)', fontSize: '0.85rem', fontWeight: '600', marginBottom: '2rem' }}>
                                    <Sparkles size={16} /> 2024 AI 策略優化引擎全新進化
                                </div>
                                <h1>BacktestNow<br />AI 強力驅動回測</h1>
                                <p>將您的 TradingView PineScript 策略優化至極致。運用自動化參數掃描與深度數據分析，助您在多變市場中精準點擊，奪得交易先機。</p>
                                <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
                                    <button className="btn btn-primary btn-xl" onClick={() => setStep(1)}>
                                        立即啟動優化 <ArrowRight size={20} />
                                    </button>
                                </div>
                            </section>

                            <h2 className="section-title">網站核心功能</h2>
                            <section className="features-grid">
                                <div className="feature-card">
                                    <Zap className="feature-icon" color="var(--accent)" />
                                    <h3>AI 參數自動遍歷</h3>
                                    <p>告別手動調整！AI 引擎自動執行數千次迭代，精確找出各種市場狀況下的最佳參數範圍。</p>
                                </div>
                                <div className="feature-card">
                                    <Database className="feature-icon" color="var(--success)" />
                                    <h3>深度歷史數據整合</h3>
                                    <p>整合幣安 (Binance) 等主流交易所的深度 Tick 級數據，確保回測結果最接近真實市場反應。</p>
                                </div>
                                <div className="feature-card">
                                    <Target className="feature-icon" color="var(--danger)" />
                                    <h3>多維度績效評估</h3>
                                    <p>不只是 ROI。我們提供 Sharpe Ratio、Sortino、最大回撤等專業指標，全方位衡量策略穩定性。</p>
                                </div>
                            </section>

                            <h2 className="section-title">三步啟動您的優化</h2>
                            <section className="steps-container">
                                <div className="step-card">
                                    <h4>Step 1</h4>
                                    <h3 style={{ color: 'var(--text-highlight)', marginBottom: '1rem' }}>上傳腳本</h3>
                                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>貼上您的 TradingView PineScript，系統會自動解析可調參數。</p>
                                </div>
                                <div className="step-card">
                                    <h4>Step 2</h4>
                                    <h3 style={{ color: 'var(--text-highlight)', marginBottom: '1rem' }}>定義區間</h3>
                                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>設定您感興趣的參數範圍與測試間距，AI 將為您安排搜尋路徑。</p>
                                </div>
                                <div className="step-card">
                                    <h4>Step 3</h4>
                                    <h3 style={{ color: 'var(--text-highlight)', marginBottom: '1rem' }}>獲得解法</h3>
                                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>在數分鐘內獲取前三大最優參數組，並直接匯出優化後的代碼。</p>
                                </div>
                            </section>

                            <h2 className="section-title">選擇適合您的方案</h2>
                            <section className="pricing">
                                <div className="pricing-grid">
                                    <div className="price-card">
                                        <h3>一般會員</h3>
                                        <div className="price">免費 <span>/ 註冊即享</span></div>
                                        <ul className="price-features">
                                            <li><CheckCircle2 size={18} color="var(--success)" /> <strong>每月 30 次</strong> 回測額度</li>
                                            <li><CheckCircle2 size={18} color="var(--success)" /> AI 參數優化建議</li>
                                            <li><CheckCircle2 size={18} color="var(--success)" /> 深度歷史數據回溯</li>
                                            <li><CheckCircle2 size={18} color="var(--success)" /> 完整績效報告輸出</li>
                                            <li><CheckCircle2 size={18} color="var(--success)" /> 一鍵匯出優化腳本代碼</li>
                                        </ul>
                                        <button className="btn btn-outline" style={{ width: '100%', justifyContent: 'center' }} onClick={() => setStep(1)}>開始免費體驗</button>
                                    </div>
                                    <div className="price-card featured">
                                        <h3>進階會員 (VIP)</h3>
                                        <div className="price">免費 <span>/ 申請解鎖</span></div>
                                        <ul className="price-features">
                                            <li><CheckCircle2 size={18} color="var(--success)" /> <strong>無限次數</strong> 回測額度</li>
                                            <li><CheckCircle2 size={18} color="var(--success)" /> AI 參數優化建議</li>
                                            <li><CheckCircle2 size={18} color="var(--success)" /> 深度歷史數據回溯</li>
                                            <li><CheckCircle2 size={18} color="var(--success)" /> 完整績效報告輸出</li>
                                            <li><CheckCircle2 size={18} color="var(--success)" /> 一鍵匯出優化腳本代碼</li>
                                        </ul>
                                        <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => setStep(1)}>申請解鎖 VIP</button>
                                    </div>
                                </div>
                                <p style={{ marginTop: '3rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                                    <AlertCircle size={14} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                                    上傳您的交易平台帳號截圖申請 VIP，經管理員審核通過後即可享受無限次回測。
                                </p>
                            </section>
                        </div>
                    )}

                    {step === 1 && (
                        <div className="layout-split">
                            <div className="glass-panel">
                                <h2 style={{ marginBottom: '2rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-highlight)' }}>
                                    <Code size={22} color="var(--accent)" /> 策略配置
                                </h2>

                                <div className="form-group" style={{ display: 'flex', gap: '1rem' }}>
                                    <div style={{ flex: 1 }}>
                                        <label className="form-label">資產類型</label>
                                        <select className="form-select" value={assetType} onChange={e => {
                                            setAssetType(e.target.value);
                                            setAsset(e.target.value === 'crypto' ? 'BTCUSDT' : 'GC!');
                                            setCapitalConfig(e.target.value === 'crypto'
                                                ? { mode: 'fixed', value: 100 }
                                                : { mode: 'contracts', value: 1 });
                                        }}>
                                            <option value="crypto">加密貨幣 (Crypto)</option>
                                            <option value="futures">傳統期貨 (Traditional Futures)</option>
                                        </select>
                                    </div>
                                    <div style={{ flex: 2 }}>
                                        <label className="form-label">資產交易對</label>
                                        <select className="form-select" value={asset} onChange={e => setAsset(e.target.value)}>
                                            {assetType === 'crypto' ? (
                                                <>
                                                    {dbAssets.crypto.map(assetItem => (
                                                        <option key={assetItem.id} value={assetItem.symbol}>{assetItem.symbol} ({assetItem.name})</option>
                                                    ))}
                                                    {dbAssets.crypto.length === 0 && <option value="BTCUSDT">正在下載資產清單...</option>}
                                                </>
                                            ) : (
                                                <>
                                                    {dbAssets.futures.map(assetItem => (
                                                        <option key={assetItem.id} value={assetItem.symbol}>{assetItem.symbol} ({assetItem.name})</option>
                                                    ))}
                                                    {dbAssets.futures.length === 0 && <option value="GC!">正在下載資產清單...</option>}
                                                </>
                                            )}
                                        </select>
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <label className="form-label">Timeframe (週期)</label>
                                        <select className="form-select" value={timeframe} onChange={e => setTimeframe(e.target.value)}>
                                            <option value="1H">1H</option>
                                            <option value="4H">4H</option>
                                            <option value="D">DAILY</option>
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
                                                    <option value="fixed">固定投資金額 (USDT)</option>
                                                    <option value="percent_equity">資產百分比 (%)</option>
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
                                    <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span>PineScript 腳本代碼</span>
                                        <div style={{ display: 'flex', gap: '1rem' }}>
                                            <span
                                                onClick={loadSampleStrategy}
                                                style={{ color: 'var(--success)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem', fontWeight: 'bold', background: 'rgba(8, 153, 129, 0.1)', padding: '0.2rem 0.6rem', borderRadius: '4px' }}
                                            >
                                                <Sparkles size={14} /> 載入範例策略
                                            </span>
                                            <span style={{ color: 'var(--accent)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem' }}>
                                                <Upload size={14} /> 上傳 .pine 檔案
                                            </span>
                                        </div>
                                    </label>
                                    <textarea
                                        className="form-textarea"
                                        value={code}
                                        onChange={e => setCode(e.target.value)}
                                        style={{ height: '300px' }}
                                        placeholder="貼上您的 TradingView PineScript v5 腳本..."
                                    ></textarea>
                                </div>
                            </div>

                            <div className="glass-panel">
                                <h2 style={{ marginBottom: '2rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-highlight)' }}>
                                    <Settings size={22} color="var(--accent)" /> 優化設定
                                </h2>

                                <div className="form-group">
                                    <label className="form-label">參數選取模式</label>
                                    <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                                        <button
                                            className={`btn ${paramMode === 'manual' ? 'btn-primary' : 'btn-outline'}`}
                                            style={{ flex: 1, justifyContent: 'center' }}
                                            onClick={() => setParamMode('manual')}
                                        >
                                            <Sliders size={16} /> 手動範圍限制
                                        </button>
                                        <button
                                            className={`btn ${paramMode === 'ai' ? 'btn-primary' : 'btn-outline'}`}
                                            style={{ flex: 1, justifyContent: 'center' }}
                                            onClick={() => setParamMode('ai')}
                                        >
                                            <Zap size={16} /> AI 自動推薦 (最大 ROI)
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
                                                        <div className="param-row" style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                                <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginLeft: '2px' }}>MIN</span>
                                                                <input type="number" className="form-input" style={{ width: '70px', textAlign: 'center' }} value={p.min} onChange={e => handleParamChange(idx, 'min', e.target.value)} />
                                                            </div>
                                                            <span style={{ color: 'var(--text-secondary)', marginTop: '12px' }}>—</span>
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                                <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginLeft: '2px' }}>MAX</span>
                                                                <input type="number" className="form-input" style={{ width: '70px', textAlign: 'center' }} value={p.max} onChange={e => handleParamChange(idx, 'max', e.target.value)} />
                                                            </div>
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginLeft: '8px' }}>
                                                                <span style={{ fontSize: '0.7rem', color: 'var(--accent)', marginLeft: '2px', fontWeight: 'bold' }}>STEP</span>
                                                                <input type="number" className="form-input" style={{ width: '60px', textAlign: 'center', borderColor: 'var(--accent)' }} value={p.step} onChange={e => handleParamChange(idx, 'step', e.target.value)} />
                                                            </div>
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
                                            <Zap size={20} /> <strong>AI 導引搜尋已啟動</strong>
                                        </div>
                                        <p style={{ fontSize: '0.9rem', color: 'var(--text-primary)', lineHeight: '1.5' }}>
                                            AI 引擎將分析您的腳本結構，並自動確定最可能的參數組合與維度，在不產生過度擬合 (Overfitting) 的情況下發掘最高 ROI。
                                        </p>
                                    </div>
                                )}

                                <div className="form-group" style={{ marginTop: '2.5rem' }}>
                                    <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                                        <span>回測迭代次數 (計算上限)</span>
                                        <div style={{ textAlign: 'right' }}>
                                            {paramMode === 'manual' && (
                                                <div style={{ fontSize: '0.75rem', color: 'var(--accent)', marginBottom: '2px' }}>
                                                    間距組合總數: {totalCombinations.toLocaleString()}
                                                </div>
                                            )}
                                            <span style={{ color: 'var(--text-highlight)', fontWeight: 'bold' }}>
                                                預計測試: {(paramMode === 'manual' && totalCombinations > 0) ? Math.min(totalCombinations, iterations).toLocaleString() : Number(iterations).toLocaleString()}
                                            </span>
                                        </div>
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
                                        <span>10,000 (最大限制)</span>
                                    </div>

                                    <div className="time-estimation">
                                        <Clock size={16} /> 預計處理時間: ~{estimatedMinutes}
                                    </div>
                                </div>

                                <div style={{ marginTop: '3rem' }}>
                                    <button className="btn btn-primary" onClick={handleStartBacktest} style={{ width: '100%', justifyContent: 'center', padding: '1.2rem', fontSize: '1.1rem' }}>
                                        <Play size={20} /> 開始回測與優化
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
                            <h2 style={{ textAlign: 'center', marginBottom: '0.5rem', color: 'var(--text-highlight)', fontSize: '1.8rem' }}>數據處理中</h2>
                            <p style={{ textAlign: 'center', color: 'var(--text-secondary)', marginBottom: '3rem' }}>
                                正在跨歷史數據集測試 <strong>{(paramMode === 'manual' && totalCombinations > 0) ? Math.min(totalCombinations, iterations).toLocaleString() : iterations.toLocaleString()}</strong> 組參數組合。
                            </p>

                            <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', color: 'var(--text-highlight)' }}>
                                <span style={{ fontWeight: '600' }}>總體進度</span>
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
                                    <TrendingUp size={28} color="var(--accent)" /> 策略回測報表
                                </h2>
                                <button className="btn" onClick={() => setStep(1)}>
                                    <ChevronRight size={16} style={{ transform: 'rotate(180deg)' }} /> 返回配置
                                </button>
                            </div>

                            {/* --- Report Metadata Bar --- */}
                            <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', marginBottom: '1.5rem', padding: '0.75rem 1rem', background: 'rgba(255,255,255,0.04)', borderRadius: '0.6rem', border: '1px solid var(--border-color)', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                <span>🕐 <strong style={{ color: 'var(--text-primary)' }}>回測時間：</strong>{results.backtestDate || '-'}</span>
                                <span>📊 <strong style={{ color: 'var(--text-primary)' }}>標的：</strong>{results.asset}</span>
                                <span>💰 <strong style={{ color: 'var(--text-primary)' }}>初始本金：</strong>{results.initialCapital?.toLocaleString()} {results.currencySymbol}</span>
                                <span>🏦 <strong style={{ color: 'var(--text-primary)' }}>資產類型：</strong>{results.assetType === 'crypto' ? '加密貨幣' : '傳統期貨'}</span>
                            </div>

                            <div className="tv-tabs">
                                <div className={`tv-tab ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>總覽</div>
                                <div className={`tv-tab ${activeTab === 'summary' ? 'active' : ''}`} onClick={() => setActiveTab('summary')}>績效摘要</div>
                                <div className={`tv-tab ${activeTab === 'trades' ? 'active' : ''}`} onClick={() => setActiveTab('trades')}>交易列表</div>
                                <div className={`tv-tab ${activeTab === 'export' ? 'active' : ''}`} onClick={() => setActiveTab('export')}>匯出腳本</div>
                            </div>

                            {activeTab === 'overview' && (
                                <div className="glass-panel" style={{ padding: '0' }}>
                                    <div style={{ padding: '2rem' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem' }}>
                                            <div>
                                                <h3 style={{ color: 'var(--text-highlight)', fontSize: '1.2rem', marginBottom: '0.2rem' }}>{results.asset} 優化結果</h3>
                                                <p style={{ color: 'var(--text-secondary)' }}>已完成 {results.iterationsUsed.toLocaleString()} 組參數優化測試</p>
                                            </div>
                                            <div style={{ textAlign: 'right' }}>
                                                <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--success)' }}>{results.netProfitPct}</div>
                                                <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>淨利 (Net Profit)</div>
                                            </div>
                                        </div>

                                        <div className="chart-placeholder" style={{ height: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <ResponsiveContainer width="100%" height="100%">
                                                <AreaChart
                                                    data={results.chartData}
                                                    margin={{ top: 10, right: 30, left: 20, bottom: 0 }}
                                                >
                                                    <defs>
                                                        <linearGradient id="colorEquity" x1="0" y1="0" x2="0" y2="1">
                                                            <stop offset="5%" stopColor="#2962ff" stopOpacity={0.4} />
                                                            <stop offset="95%" stopColor="#2962ff" stopOpacity={0} />
                                                        </linearGradient>
                                                    </defs>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                                    <XAxis dataKey="name" stroke="var(--text-secondary)" fontSize={12} tickLine={false} axisLine={false} />
                                                    <YAxis stroke="var(--text-secondary)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `$${value}`}>
                                                        <Label value="權益數" angle={-90} position="insideLeft" style={{ textAnchor: 'middle', fill: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: '500' }} offset={-10} />
                                                    </YAxis>
                                                    <Tooltip
                                                        contentStyle={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)' }}
                                                        itemStyle={{ color: 'var(--accent)' }}
                                                    />
                                                    <Area type="monotone" dataKey="equity" name="權益數" stroke="#2962ff" strokeWidth={3} fillOpacity={1} fill="url(#colorEquity)" />
                                                </AreaChart>
                                            </ResponsiveContainer>
                                        </div>

                                        <div style={{ marginTop: '2rem' }}>
                                            <h4 style={{ color: 'var(--text-highlight)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <Target size={18} color="var(--accent)" /> AI 挖掘的前三大回測參數組
                                            </h4>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                                {results.topStrategies.map((strategy, idx) => (
                                                    <div key={idx} style={{ background: 'var(--bg-panel)', padding: '1.5rem', borderRadius: '0.5rem', border: `1px solid ${idx === 0 ? 'var(--success)' : 'var(--border-color)'}`, position: 'relative' }}>
                                                        {idx === 0 && <div style={{ position: 'absolute', top: 0, right: 0, background: 'var(--success)', color: '#000', padding: '0.2rem 1rem', fontSize: '0.8rem', fontWeight: 'bold', borderBottomLeftRadius: '0.5rem', borderTopRightRadius: '0.5rem' }}>最佳回測 ROI</div>}
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                                            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--text-highlight)' }}>排名 #{idx + 1}</div>
                                                            <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: idx === 0 ? 'var(--success)' : 'var(--text-secondary)' }}>{strategy.roi} 淨利</div>
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
                                            <span className="tv-metric-title">淨利 (Net Profit)</span>
                                            <span className="tv-metric-value up">{results.netProfit} <span style={{ fontSize: '1rem' }}>({results.netProfitPct})</span></span>
                                        </div>
                                        <div className="tv-metric">
                                            <span className="tv-metric-title">毛利 (Gross Profit)</span>
                                            <span className="tv-metric-value up">{results.grossProfit}</span>
                                        </div>
                                        <div className="tv-metric">
                                            <span className="tv-metric-title">毛損 (Gross Loss)</span>
                                            <span className="tv-metric-value down">{results.grossLoss}</span>
                                        </div>
                                        <div className="tv-metric">
                                            <span className="tv-metric-title">最大回撤 (Max Drawdown)</span>
                                            <span className="tv-metric-value down">{results.maxDrawdownAbsolute} <span style={{ fontSize: '1rem' }}>({results.maxDrawdown})</span></span>
                                        </div>
                                    </div>

                                    <table className="tv-table">
                                        <tbody>
                                            <tr>
                                                <td>買入持有報酬率</td>
                                                <td style={{ color: 'var(--success)' }}>{results.buyAndHoldReturn}</td>
                                                <td>夏普比率 (Sharpe Ratio)</td>
                                                <td>{results.sharpeRatio}</td>
                                            </tr>
                                            <tr>
                                                <td>獲利因子 (Profit Factor)</td>
                                                <td>{results.profitFactor}</td>
                                                <td>索提諾比率 (Sortino Ratio)</td>
                                                <td>{results.sortinoRatio}</td>
                                            </tr>
                                            <tr>
                                                <td>勝率 (Win Rate)</td>
                                                <td>{results.winRate}</td>
                                                <td>最大持有合約數</td>
                                                <td>1</td>
                                            </tr>
                                            <tr>
                                                <td>總成交單數</td>
                                                <td>{results.totalTrades}</td>
                                                <td>平均持倉 K 線數</td>
                                                <td>{results.avgBarsInTrade}</td>
                                            </tr>
                                            <tr>
                                                <td>每筆交易平均損益</td>
                                                <td style={{ color: 'var(--success)' }}>{results.avgTrade}</td>
                                                <td>追加保證金次數</td>
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
                                                <th style={{ padding: '1rem 2rem' }}>交易序號 #</th>
                                                <th>類型</th>
                                                <th>信號名稱</th>
                                                <th>日期 / 時間</th>
                                                <th>成交價格</th>
                                                <th>淨損益 (P&L)</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {results.trades.map(trade => (
                                                <tr key={trade.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                                                    <td style={{ paddingLeft: '2rem', color: 'var(--text-secondary)' }}>{trade.id}</td>
                                                    <td style={{ color: trade.typeColor, fontWeight: '500' }}>{trade.type}</td>
                                                    <td style={{ color: 'var(--text-primary)' }}>{trade.signal}</td>
                                                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{trade.timeStr || trade.dateStr || '-'}</td>
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

                            {activeTab === 'export' && (
                                <div className="glass-panel" style={{ padding: '2rem' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                        <h3 style={{ color: 'var(--text-highlight)' }}>🤖 AI 優化後的 Pine Script</h3>
                                        <button className="btn btn-outline" onClick={() => {
                                            navigator.clipboard.writeText(results.rewrittenCode);
                                            alert('代碼已複製到剪貼簿！');
                                        }}>
                                            <FileText size={16} /> 複製代碼
                                        </button>
                                    </div>

                                    {/* Optimized Parameters Summary */}
                                    <div style={{ marginBottom: '1.5rem', padding: '1rem', background: 'rgba(0,195,124,0.07)', border: '1px solid rgba(0,195,124,0.3)', borderRadius: '0.5rem' }}>
                                        <p style={{ color: 'var(--success)', fontWeight: 'bold', marginBottom: '0.5rem', fontSize: '0.9rem' }}>✅ 以下參數已自動替換為最佳化值：</p>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                            {Object.entries(results.topStrategies?.[0]?.params || {}).map(([k, v]) => (
                                                <span key={k} style={{ padding: '0.2rem 0.7rem', background: 'rgba(0,195,124,0.15)', borderRadius: '1rem', fontSize: '0.82rem', fontFamily: 'monospace', color: 'var(--text-primary)' }}>
                                                    {k} = <strong style={{ color: 'var(--success)' }}>{v}</strong>
                                                </span>
                                            ))}
                                        </div>
                                    </div>

                                    <pre style={{ background: '#0a0e17', padding: '1.5rem', borderRadius: '0.5rem', overflowX: 'auto', border: '1px solid var(--border-color)', color: '#d4d4d4', fontSize: '0.9rem', lineHeight: '1.5' }}>
                                        {results.rewrittenCode}
                                    </pre>
                                    <p style={{ marginTop: '1rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                        將此腳本貼回 TradingView，參數已根據回測最高 ROI 結果自動更新。
                                    </p>
                                </div>
                            )}

                        </div>
                    )}

                    {step === 4 && (
                        <div className="glass-panel">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                                <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-highlight)' }}>
                                    <History size={24} color="var(--accent)" /> 優化歷史紀錄 (至多 10 筆)
                                </h2>
                                <button className="btn" onClick={() => setStep(1)}>回配置頁</button>
                            </div>

                            {isLoadingHistory ? (
                                <div className="history-empty">正在讀取歷史紀錄...</div>
                            ) : history.length === 0 ? (
                                <div className="history-empty">
                                    <Clock size={48} style={{ opacity: 0.2, marginBottom: '1rem' }} />
                                    <p>目前尚無優化紀錄。開始您的第一次回測吧！</p>
                                </div>
                            ) : (
                                <div className="history-grid">
                                    {history.map(item => (
                                        <div key={item.id} className="history-card" onClick={() => loadHistoryItem(item)}>
                                            <h4>
                                                <span>{item.asset}</span>
                                                <Trash2
                                                    size={16}
                                                    className="btn-icon"
                                                    style={{ color: 'var(--danger)', opacity: 0.6 }}
                                                    onClick={(e) => deleteHistoryItem(e, item.id)}
                                                />
                                            </h4>
                                            <div className="meta">
                                                <span>{item.timeframe} 週期</span>
                                                <span>{new Date(item.created_at).toLocaleDateString()}</span>
                                            </div>
                                            <div className="profit" style={{ color: item.net_profit_pct.startsWith('+') ? 'var(--success)' : 'var(--danger)' }}>
                                                ROI: {item.net_profit_pct}
                                            </div>
                                            <div className="params-preview">
                                                {item.top_params && Object.entries(item.top_params).slice(0, 3).map(([k, v]) => (
                                                    <span key={k} className="history-tag">{k}: {v}</span>
                                                ))}
                                                {Object.keys(item.top_params || {}).length > 3 && <span className="history-tag">...</span>}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}


                    {/* ── Admin Panel (Step 5) ── */}
                    {step === 5 && (
                        <div className="glass-panel">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                                <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-highlight)' }}>
                                    <Settings size={24} color="var(--accent)" /> VIP 申請管理後台
                                </h2>
                                <button className="btn" onClick={() => setStep(1)}>返回</button>
                            </div>
                            {isLoadingAdmin ? (
                                <p style={{ color: 'var(--text-secondary)' }}>載入中...</p>
                            ) : adminApplications.length === 0 ? (
                                <div className="history-empty"><AlertCircle size={40} style={{ opacity: 0.2, marginBottom: '1rem' }} /><p>目前沒有任何申請</p></div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                    {adminApplications.map(app => (
                                        <div key={app.id} style={{ background: 'var(--bg-panel)', border: `1px solid ${app.status === 'approved' ? 'var(--success)' : app.status === 'rejected' ? 'var(--danger)' : 'var(--border-color)'}`, borderRadius: '0.75rem', padding: '1.5rem' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
                                                <div>
                                                    <div style={{ fontWeight: 'bold', color: 'var(--text-highlight)', marginBottom: '0.25rem' }}>{app.user_name || '未知用戶'}</div>
                                                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{app.user_email}</div>
                                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>{new Date(app.created_at).toLocaleString('zh-TW')}</div>
                                                </div>
                                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                                    <span style={{ padding: '0.2rem 0.8rem', borderRadius: '1rem', fontSize: '0.8rem', fontWeight: 'bold', background: app.status === 'approved' ? 'rgba(0,195,124,0.15)' : app.status === 'rejected' ? 'rgba(239,83,80,0.15)' : 'rgba(255,193,7,0.15)', color: app.status === 'approved' ? 'var(--success)' : app.status === 'rejected' ? 'var(--danger)' : '#ffc107' }}>
                                                        {app.status === 'approved' ? '已核准' : app.status === 'rejected' ? '已拒絕' : '待審核'}
                                                    </span>
                                                    {app.status === 'pending' && (
                                                        <>
                                                            <button className="btn btn-primary" style={{ padding: '0.3rem 1rem', fontSize: '0.85rem' }} onClick={() => handleAdminReview(app.id, 'approved')}>
                                                                <CheckCircle2 size={14} /> 核准
                                                            </button>
                                                            <button className="btn" style={{ padding: '0.3rem 1rem', fontSize: '0.85rem', borderColor: 'var(--danger)', color: 'var(--danger)' }} onClick={() => handleAdminReview(app.id, 'rejected')}>
                                                                <Trash2 size={14} /> 拒絕
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                            {app.screenshot_url && (
                                                <div style={{ marginTop: '1rem' }}>
                                                    <a href={app.screenshot_url} target="_blank" rel="noreferrer">
                                                        <img src={app.screenshot_url} alt="交易平台截圖" style={{ maxWidth: '100%', maxHeight: '300px', borderRadius: '0.5rem', border: '1px solid var(--border-color)', objectFit: 'contain' }} />
                                                    </a>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── VIP Application Modal ── */}
                    {showApplyModal && (
                        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
                            <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: '1rem', padding: '2rem', width: '100%', maxWidth: '480px', position: 'relative' }}>
                                <button onClick={() => { setShowApplyModal(false); setApplyStatus(null); setApplyMessage(''); setApplyScreenshot(null); }} style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1.5rem', lineHeight: 1 }}>×</button>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                    <Shield size={22} color="var(--success)" />
                                    <h3 style={{ color: 'var(--text-highlight)', margin: 0 }}>申請 VIP 解鎖無限回測</h3>
                                </div>
                                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.5rem', lineHeight: 1.6 }}>
                                    上傳您目前使用的交易平台帳號截圖（需清楚顯示帳號），管理員審核通過後即可享受無限次回測。
                                </p>

                                {applyStatus === 'done' ? (
                                    <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                                        <CheckCircle2 size={48} color="var(--success)" style={{ marginBottom: '1rem' }} />
                                        <p style={{ color: 'var(--success)', fontWeight: 'bold' }}>{applyMessage}</p>
                                    </div>
                                ) : (
                                    <>
                                        <div style={{ border: '2px dashed var(--border-color)', borderRadius: '0.75rem', padding: '1.5rem', textAlign: 'center', marginBottom: '1rem', cursor: 'pointer', background: applyScreenshot ? 'rgba(0,195,124,0.05)' : 'transparent' }}
                                            onClick={() => document.getElementById('vip-file-input').click()}>
                                            <input id="vip-file-input" type="file" accept="image/*" style={{ display: 'none' }} onChange={e => setApplyScreenshot(e.target.files[0])} />
                                            {applyScreenshot ? (
                                                <>
                                                    <CheckCircle2 size={32} color="var(--success)" style={{ marginBottom: '0.5rem' }} />
                                                    <p style={{ color: 'var(--success)', fontSize: '0.9rem' }}>{applyScreenshot.name}</p>
                                                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>點擊重新選擇</p>
                                                </>
                                            ) : (
                                                <>
                                                    <Upload size={32} color="var(--text-secondary)" style={{ marginBottom: '0.5rem' }} />
                                                    <p style={{ color: 'var(--text-primary)', fontSize: '0.9rem' }}>點擊選擇截圖</p>
                                                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>支援 JPG / PNG，最大 5MB</p>
                                                </>
                                            )}
                                        </div>
                                        {applyMessage && (
                                            <p style={{ color: applyStatus === 'error' ? 'var(--danger)' : 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1rem' }}>{applyMessage}</p>
                                        )}
                                        <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}
                                            disabled={applyStatus === 'uploading'}
                                            onClick={handleApplyVip}>
                                            {applyStatus === 'uploading' ? '上傳中...' : <><ArrowRight size={16} /> 送出申請</>}
                                        </button>
                                    </>
                                )}
                            </div>
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
