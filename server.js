import express from 'express';
import cors from 'cors';
import axios from 'axios';
import { SMA } from 'technicalindicators';
import yahooFinanceClass from 'yahoo-finance2';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { supabase } from './db_safe.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const yf = new yahooFinanceClass();
const app = express();

app.use(cors());
app.use(express.json());

// Log every incoming request
app.use((req, res, next) => {
    console.log(`[==> REQ] ${req.method} ${req.originalUrl}`);
    next();
});

// Global Error Handlers for process
process.on('uncaughtException', (err) => {
    console.error('[CRITICAL] Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('[CRITICAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

const PORT = process.env.PORT || 3001;

// Health check
app.get('/health', (req, res) => res.send('OK'));

function mapInterval(timeframe) {
    const map = {
        '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m',
        '1H': '1h', '2H': '2h', '4H': '4h', 'D': '1d'
    };
    return map[timeframe] || '1h';
}

const ADMIN_EMAIL = 'nbamoment@gmail.com';
const BASIC_MONTHLY_LIMIT = 30;

// ── In-memory fallback tracking (used when Supabase is unavailable) ──
// Resets on server restart; Supabase is the source of truth when online.
const _memUsage = new Map();   // key: "userId:YYYY-MM" → count
const _memRoles = new Map();   // key: userId → role

function _memKey(userId) {
    const month = new Date().toISOString().slice(0, 7);
    return `${userId}:${month}`;
}

// Helper: get or create user role
async function getUserRole(userId, email) {
    if (!supabase) {
        if (_memRoles.has(userId)) return _memRoles.get(userId);
        const role = email === ADMIN_EMAIL ? 'admin' : 'basic';
        _memRoles.set(userId, role);
        return role;
    }
    const { data } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .maybeSingle();

    if (data) return data.role;

    const role = email === ADMIN_EMAIL ? 'admin' : 'basic';
    await supabase.from('user_roles').upsert({ user_id: userId, email, role });
    return role;
}

// Helper: get this month's usage count
async function getMonthlyUsage(userId) {
    if (!supabase) return _memUsage.get(_memKey(userId)) || 0;
    const month = new Date().toISOString().slice(0, 7);
    const { data } = await supabase
        .from('usage_tracking')
        .select('count')
        .eq('user_id', userId)
        .eq('month', month)
        .maybeSingle();
    return data ? data.count : 0;
}

// Helper: increment monthly usage
async function incrementUsage(userId) {
    if (!supabase) {
        const key = _memKey(userId);
        _memUsage.set(key, (_memUsage.get(key) || 0) + 1);
        return;
    }
    const month = new Date().toISOString().slice(0, 7);
    const { data } = await supabase
        .from('usage_tracking')
        .select('id, count')
        .eq('user_id', userId)
        .eq('month', month)
        .maybeSingle();

    if (data) {
        await supabase.from('usage_tracking').update({ count: data.count + 1 }).eq('id', data.id);
    } else {
        await supabase.from('usage_tracking').insert({ user_id: userId, month, count: 1 });
    }
}

// GET /api/user/status — role + monthly usage
app.get('/api/user/status', async (req, res) => {
    try {
        const { userId, email } = req.query;
        if (!userId) return res.json({ role: 'basic', usageCount: 0, limit: BASIC_MONTHLY_LIMIT });

        const role = await getUserRole(userId, email || '');
        const usageCount = await getMonthlyUsage(userId);
        res.json({ role, usageCount, limit: BASIC_MONTHLY_LIMIT });
    } catch (e) {
        res.json({ role: 'basic', usageCount: 0, limit: BASIC_MONTHLY_LIMIT });
    }
});

// POST /api/user/apply-vip — submit VIP application
app.post('/api/user/apply-vip', async (req, res) => {
    try {
        const { userId, email, userName, screenshotUrl } = req.body;
        if (!userId || !screenshotUrl) return res.status(400).json({ success: false, error: '缺少必要欄位' });

        if (!supabase) return res.status(503).json({ success: false, error: 'Database disconnected' });

        // Check if already applied (pending or approved)
        const { data: existing } = await supabase
            .from('vip_applications')
            .select('status')
            .eq('user_id', userId)
            .in('status', ['pending', 'approved'])
            .single();

        if (existing) {
            return res.json({ success: false, error: existing.status === 'approved' ? '您已是 VIP 會員' : '申請審核中，請耐心等候' });
        }

        await supabase.from('vip_applications').insert({
            user_id: userId, user_email: email, user_name: userName, screenshot_url: screenshotUrl
        });

        res.json({ success: true, message: '申請已送出，管理員審核後將為您解鎖 VIP 功能' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// GET /api/admin/applications — list all applications (admin only)
app.get('/api/admin/applications', async (req, res) => {
    try {
        const { email } = req.query;
        if (email !== ADMIN_EMAIL) return res.status(403).json({ success: false, error: '無權限' });
        if (!supabase) return res.status(503).json({ success: false, error: 'Database disconnected' });

        const { data } = await supabase
            .from('vip_applications')
            .select('*')
            .order('created_at', { ascending: false });

        res.json({ success: true, applications: data || [] });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// POST /api/admin/review — approve or reject application
app.post('/api/admin/review', async (req, res) => {
    try {
        const { email, applicationId, action, adminNote } = req.body;
        if (email !== ADMIN_EMAIL) return res.status(403).json({ success: false, error: '無權限' });
        if (!['approved', 'rejected'].includes(action)) return res.status(400).json({ success: false, error: '無效操作' });
        if (!supabase) return res.status(503).json({ success: false, error: 'Database disconnected' });

        // Get application
        const { data: appP } = await supabase
            .from('vip_applications')
            .select('user_id, user_email')
            .eq('id', applicationId)
            .single();

        if (!appP) return res.status(404).json({ success: false, error: '申請不存在' });

        // Update application status
        await supabase.from('vip_applications').update({
            status: action,
            admin_note: adminNote || '',
            reviewed_at: new Date().toISOString()
        }).eq('id', applicationId);

        // If approved, upgrade user role to VIP
        if (action === 'approved') {
            await supabase.from('user_roles').upsert({
                user_id: appP.user_id,
                email: appP.user_email,
                role: 'vip',
                updated_at: new Date().toISOString()
            });
        }

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/backtest', async (req, res) => {
    try {
        const { asset, timeframe, paramConfig, capitalConfig, userId, userEmail } = req.body;

        // --- Usage Limit Check ---
        if (userId) {
            const role = await getUserRole(userId, userEmail || '');
            if (role === 'basic') {
                const usageCount = await getMonthlyUsage(userId);
                if (usageCount >= BASIC_MONTHLY_LIMIT) {
                    return res.json({ success: false, error: 'USAGE_LIMIT_EXCEEDED', usageCount, limit: BASIC_MONTHLY_LIMIT });
                }
            }
        }

        // Traditional finance → Yahoo Finance; Crypto → Binance (default)
        const yahooMap = {
            // Index Futures
            'NQ!': 'NQ=F',      // Nasdaq 100
            'ES!': 'ES=F',      // S&P 500
            'YM!': 'YM=F',      // Dow Jones
            'RTY!': 'RTY=F',    // Russell 2000
            // Commodity Futures
            'GC!': 'GC=F',      // Gold
            'SIL!': 'SI=F',     // Silver
            'CL!': 'CL=F',      // Crude Oil (WTI)
            'NG!': 'NG=F',      // Natural Gas
            'HG!': 'HG=F',      // Copper
            // Bonds
            'ZB!': 'ZB=F',      // 30Y Treasury Bond
            'ZN!': 'ZN=F',      // 10Y Treasury Note
            // FX Futures
            'DX!': 'DX-Y.NYB',  // US Dollar Index
        };

        const symbol = yahooMap[asset] || asset;
        const interval = mapInterval(timeframe);

        // Determine source
        const isYahoo = !!yahooMap[asset];
        const isBinanceFutures = false;
        const baseUrl = 'https://api.binance.com/api/v3';

        // --- Caching Logic: Fetch from Supabase or Update from Binance ---
        let klines = [];

        // 1. Check if Supabase is connected
        const assetData = supabase ? (await supabase
            .from('assets')
            .select('id')
            .eq('symbol', asset)
            .single()).data : null;

        if (supabase && assetData) {
            const assetId = assetData.id;
            // 2. Check last update
            const { data: lastRecord } = await supabase
                .from('historical_data')
                .select('timestamp, created_at, asset_id')
                .eq('asset_id', assetId)
                .eq('timeframe', timeframe)
                .order('timestamp', { ascending: false })
                .limit(1);

            // Cache freshness window: match the timeframe
            const cacheWindowMs = {
                '1m': 1, '3m': 3, '5m': 5, '15m': 15, '30m': 30,
                '1H': 60, '2H': 120, '4H': 240, 'D': 1440
            };
            const windowMs = (cacheWindowMs[timeframe] || 60) * 60 * 1000;
            const cacheThreshold = new Date(Date.now() - windowMs).toISOString();

            if (lastRecord && lastRecord.length > 0 && lastRecord[0].created_at > cacheThreshold) {
                // Fetch from DB
                console.log(`[Cache] Fetching ${asset} ${timeframe} from Database...`);
                const { data: dbKlines } = await supabase
                    .from('historical_data')
                    .select('*')
                    .eq('asset_id', lastRecord[0].asset_id)
                    .eq('timeframe', timeframe)
                    .order('timestamp', { ascending: true })
                    .limit(10000); // Increased limit to get enough data for backtesting

                klines = dbKlines.map(k => [
                    k.timestamp, k.open, k.high, k.low, k.close, k.volume,
                    null, null, null, null, null // padding
                ]);
            } else {
                // Fetch from Network and Update DB
                if (isYahoo) {
                    console.log(`[Network] Cache expired or missing. Fetching ${asset} (${symbol}) ${timeframe} from Yahoo Finance...`);
                    // Map timeframe to Yahoo Finance interval
                    const yahooInterval = interval === '1d' ? '1d' : '60m';
                    // Yahoo Finance limits: 1H data max 730 days, 1D has no such limit
                    const lookbackDays = yahooInterval === '1d' ? 5 * 365 : 700;
                    const periodStart = Math.floor((Date.now() - lookbackDays * 24 * 60 * 60 * 1000) / 1000);
                    const chartResult = await yf.chart(symbol, {
                        period1: periodStart,
                        interval: yahooInterval
                    });

                    if (chartResult && chartResult.quotes) {
                        klines = chartResult.quotes.map(q => [
                            q.date.getTime(),
                            q.open,
                            q.high,
                            q.low,
                            q.close,
                            q.volume,
                            null, null, null, null, null
                        ]);
                    }
                } else {
                    console.log(`[Network] Cache expired or missing. Fetching ${asset} (${symbol}) ${timeframe} from Binance ${isBinanceFutures ? 'Futures' : 'Spot'} API...`);
                    const { data: binanceKlines } = await axios.get(`${baseUrl}/klines?symbol=${symbol}&interval=${interval}&limit=1000`);
                    klines = binanceKlines;
                }

                // Async Update DB (if supabase is connected)
                if (supabase && klines.length > 0) {
                    const rowsToInsert = klines.map(k => ({
                        asset_id: assetId,
                        timeframe: timeframe,
                        timestamp: k[0],
                        open: parseFloat(k[1]) || 0,
                        high: parseFloat(k[2]) || 0,
                        low: parseFloat(k[3]) || 0,
                        close: parseFloat(k[4]) || 0,
                        volume: parseFloat(k[5]) || 0
                    }));

                    try {
                        await supabase.from('historical_data').delete().eq('asset_id', assetId).eq('timeframe', timeframe);
                        await supabase.from('historical_data').insert(rowsToInsert);
                    } catch (dbErr) {
                        console.warn('[DB Refresh] Failed to update cache:', dbErr.message);
                    }
                }
            }
        } else {
            // Fallback for missing asset config
            if (isYahoo) {
                const yahooInterval = interval === '1d' ? '1d' : '60m';
                const lookbackDays = yahooInterval === '1d' ? 5 * 365 : 700;
                const periodStart = Math.floor((Date.now() - lookbackDays * 24 * 60 * 60 * 1000) / 1000);
                const chartResult = await yf.chart(symbol, {
                    period1: periodStart,
                    interval: yahooInterval
                });

                klines = (chartResult.quotes || []).map(q => [
                    q.date.getTime(), q.open, q.high, q.low, q.close, q.volume, null, null, null, null, null
                ]);
            } else {
                const { data: binanceKlines } = await axios.get(`${baseUrl}/klines?symbol=${symbol}&interval=${interval}&limit=1000`);
                klines = binanceKlines;
            }
        }

        // --- Futures Contract Specs ---
        const contractSpecs = {
            'NQ!': { tickSize: 0.25, tickValue: 5, pointValue: 20 },
            'MNQ!': { tickSize: 0.25, tickValue: 0.50, pointValue: 2 },
            'ES!': { tickSize: 0.25, tickValue: 12.50, pointValue: 50 },
            'MES!': { tickSize: 0.25, tickValue: 1.25, pointValue: 5 },
            'YM!': { tickSize: 1, tickValue: 5, pointValue: 5 },
            'MYM!': { tickSize: 1, tickValue: 0.50, pointValue: 0.5 },
            'RTY!': { tickSize: 0.10, tickValue: 5, pointValue: 50 },
            'GC!': { tickSize: 0.10, tickValue: 10, pointValue: 100 },
            'MGC!': { tickSize: 0.10, tickValue: 1, pointValue: 10 },
            'SIL!': { tickSize: 0.005, tickValue: 25, pointValue: 5000 },
            'CL!': { tickSize: 0.01, tickValue: 10, pointValue: 1000 },
            'NG!': { tickSize: 0.001, tickValue: 10, pointValue: 10000 },
            'HG!': { tickSize: 0.0005, tickValue: 12.50, pointValue: 25000 },
            'ZB!': { tickSize: 0.03125, tickValue: 31.25, pointValue: 1000 },
            'ZN!': { tickSize: 0.015625, tickValue: 15.625, pointValue: 1000 },
        };

        const spec = contractSpecs[asset] || null;
        const numContracts = capitalConfig?.mode === 'contracts' ? (Number(capitalConfig.value) || 1) : 1;

        const validKlines = klines.filter(k => {
            const c = parseFloat(k[4]);
            return !isNaN(c) && c > 0;
        });

        if (validKlines.length < 10) {
            return res.json({ success: false, error: '歷史數據不足，請稍後再試' });
        }

        const closes = validKlines.map(k => parseFloat(k[4]));
        const highs = validKlines.map(k => parseFloat(k[2]));
        const lows = validKlines.map(k => parseFloat(k[3]));
        const dates = validKlines.map(k => new Date(k[0]));

        // --- Core Simulation Function ---
        function runSimulation(params) {
            const fastLen = Math.floor(params.fast_len || params.length || 10);
            const slowLen = Math.floor(params.slow_len || Math.max(fastLen * 2, fastLen + 5));
            const stopLoss = params.stopLoss || 5;
            const takeProfit = params.takeProfit || 10;

            if (fastLen >= slowLen || fastLen < 2 || slowLen < 3) return null;

            const fastSma = SMA.calculate({ period: fastLen, values: closes });
            const slowSma = SMA.calculate({ period: slowLen, values: closes });

            const paddedFastSma = Array(fastLen - 1).fill(null).concat(fastSma);
            const paddedSlowSma = Array(slowLen - 1).fill(null).concat(slowSma);

            const defaultCapital = isYahoo ? 50000 : 10000;
            let initialCapital = (capitalConfig?.mode === 'fixed' && capitalConfig?.value && Number(capitalConfig.value) > 0)
                ? Number(capitalConfig.value)
                : defaultCapital;
            let capital = initialCapital;
            let position = null;
            let currentTrades = [];
            let chartDataArr = [];
            let peakCapital = capital;
            let maxDrawdownAbs = 0;
            let grossProfit = 0;
            let grossLoss = 0;
            let winningTrades = 0;
            let totalBarsHeld = 0;
            let closedTradeCount = 0;

            for (let i = 1; i < closes.length; i++) {
                const currentClose = closes[i];
                const currentHigh = highs[i];
                const currentLow = lows[i];
                const currentFast = paddedFastSma[i];
                const currentSlow = paddedSlowSma[i];
                const prevFast = paddedFastSma[i - 1];
                const prevSlow = paddedSlowSma[i - 1];

                if (currentFast === null || currentSlow === null || prevFast === null || prevSlow === null) continue;

                if (position) {
                    let exitPrice = null;
                    let signal = '';

                    if (position.type === 'long') {
                        if (spec) {
                            if (position.entryPrice - currentLow >= stopLoss) {
                                exitPrice = position.entryPrice - stopLoss;
                                signal = '止損 (Stop Loss)';
                            } else if (currentHigh - position.entryPrice >= takeProfit) {
                                exitPrice = position.entryPrice + takeProfit;
                                signal = '止盈 (Take Profit)';
                            }
                        } else {
                            if ((position.entryPrice - currentLow) / position.entryPrice * 100 >= stopLoss) {
                                exitPrice = position.entryPrice * (1 - (stopLoss / 100));
                                signal = '止損 (Stop Loss)';
                            } else if ((currentHigh - position.entryPrice) / position.entryPrice * 100 >= takeProfit) {
                                exitPrice = position.entryPrice * (1 + (takeProfit / 100));
                                signal = '止盈 (Take Profit)';
                            }
                        }
                        if (!exitPrice && prevFast >= prevSlow && currentFast < currentSlow) {
                            exitPrice = currentClose;
                            signal = 'MA 交叉 (MA Cross)';
                        }
                    } else {
                        if (spec) {
                            if (currentHigh - position.entryPrice >= stopLoss) {
                                exitPrice = position.entryPrice + stopLoss;
                                signal = '止損 (Stop Loss)';
                            } else if (position.entryPrice - currentLow >= takeProfit) {
                                exitPrice = position.entryPrice - takeProfit;
                                signal = '止盈 (Take Profit)';
                            }
                        } else {
                            if ((currentHigh - position.entryPrice) / position.entryPrice * 100 >= stopLoss) {
                                exitPrice = position.entryPrice * (1 + (stopLoss / 100));
                                signal = '止損 (Stop Loss)';
                            } else if ((position.entryPrice - currentLow) / position.entryPrice * 100 >= takeProfit) {
                                exitPrice = position.entryPrice * (1 - (takeProfit / 100));
                                signal = '止盈 (Take Profit)';
                            }
                        }
                        if (!exitPrice && prevFast <= prevSlow && currentFast > currentSlow) {
                            exitPrice = currentClose;
                            signal = 'MA 交叉 (MA Cross)';
                        }
                    }

                    if (exitPrice) {
                        const priceDiff = position.type === 'long' ? exitPrice - position.entryPrice : position.entryPrice - exitPrice;
                        const pnlVal = spec ? (priceDiff * spec.pointValue * numContracts) : (capital * (priceDiff / position.entryPrice));

                        capital += pnlVal;
                        totalBarsHeld += (i - position.entryIndex);
                        closedTradeCount++;
                        if (pnlVal > 0) { winningTrades++; grossProfit += pnlVal; } else { grossLoss += Math.abs(pnlVal); }

                        currentTrades.push({
                            id: currentTrades.length + 1,
                            type: position.type === 'long' ? 'Long Exit' : 'Short Exit',
                            signal,
                            price: exitPrice.toLocaleString(),
                            pnl: `${pnlVal > 0 ? '+' : ''}${pnlVal.toFixed(2)}`,
                            pnlValue: pnlVal,
                            timeStr: dates[i].toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
                            typeColor: pnlVal > 0 ? 'var(--success)' : 'var(--danger)'
                        });
                        position = null;
                    }
                } else {
                    if (prevFast < prevSlow && currentFast >= currentSlow) {
                        position = { type: 'long', entryPrice: currentClose, entryIndex: i };
                        currentTrades.push({
                            id: currentTrades.length + 1,
                            type: 'Long Entry',
                            signal: 'MA 交叉 (MA Cross)',
                            price: currentClose.toLocaleString(),
                            pnl: '-',
                            timeStr: dates[i].toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
                            typeColor: 'var(--text-highlight)'
                        });
                    } else if (prevFast > prevSlow && currentFast <= currentSlow) {
                        position = { type: 'short', entryPrice: currentClose, entryIndex: i };
                        currentTrades.push({
                            id: currentTrades.length + 1,
                            type: 'Short Entry',
                            signal: 'MA 交叉 (MA Cross)',
                            price: currentClose.toLocaleString(),
                            pnl: '-',
                            timeStr: dates[i].toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
                            typeColor: 'var(--text-highlight)'
                        });
                    }
                }
                if (capital > peakCapital) peakCapital = capital;
                const ddAbs = peakCapital - capital;
                if (ddAbs > maxDrawdownAbs) maxDrawdownAbs = ddAbs;

                chartDataArr.push({
                    name: dates[i].toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                    equity: Number(capital.toFixed(2))
                });
            }

            const netProfit = capital - initialCapital;
            return {
                netProfit,
                netProfitPct: ((netProfit / initialCapital) * 100).toFixed(2),
                grossProfit,
                grossLoss,
                maxDrawdownAbs,
                maxDrawdownPct: peakCapital > 0 ? (maxDrawdownAbs / peakCapital) * 100 : 0,
                totalTrades: currentTrades.length,
                winningTrades,
                avgBarsInTrade: closedTradeCount > 0 ? (totalBarsHeld / closedTradeCount).toFixed(1) : '0',
                trades: currentTrades,
                chartData: chartDataArr,
                params
            };
        }

        const results_list = [];
        const baseFast = Math.max(2, Math.floor(paramConfig.fast_len || paramConfig.length || 10));
        const baseSlow = Math.max(baseFast + 3, Math.floor(paramConfig.slow_len || baseFast * 2));
        const fastMin = Math.max(2, baseFast - 5);
        const fastMax = baseFast + 5;
        const slowMin = Math.max(fastMax + 1, baseSlow - 10);
        const slowMax = baseSlow + 10;

        for (let f = fastMin; f <= fastMax; f += 2) {
            for (let s = slowMin; s <= slowMax; s += 5) {
                const result = runSimulation({ ...paramConfig, fast_len: f, slow_len: s });
                if (result) results_list.push(result);
            }
        }

        if (results_list.length === 0) {
            return res.json({ success: false, error: '無法生成有效的回測結果，請調整參數範圍' });
        }

        results_list.sort((a, b) => b.netProfit - a.netProfit);
        const best = results_list[0];
        const top3 = results_list.slice(0, 3).map(r => ({
            roi: `${Number(r.netProfitPct) >= 0 ? '+' : ''}${r.netProfitPct}%`,
            params: r.params
        }));

        const totalClosed = best.trades.filter(t => t.type.includes('Exit')).length;
        const winRatePct = totalClosed > 0 ? (best.winningTrades / totalClosed * 100).toFixed(1) : '0.0';
        const profitFactor = best.grossLoss > 0 ? (best.grossProfit / best.grossLoss).toFixed(2) : best.grossProfit > 0 ? '∞' : '0.00';
        const buyAndHoldReturn = (((closes[closes.length - 1] - closes[0]) / closes[0]) * 100).toFixed(2);

        // Downsample chartData
        const raw = best.chartData;
        const step = Math.max(1, Math.ceil(raw.length / 200));
        const chartData = raw.filter((_, idx) => idx % step === 0 || idx === raw.length - 1);

        if (userId) await incrementUsage(userId);

        res.json({
            success: true,
            asset,
            initialCapital: best.initialCapital,
            trades: best.trades.reverse(),
            chartData,
            netProfit: best.netProfit,
            netProfitPct: best.netProfitPct,
            grossProfit: best.grossProfit,
            grossLoss: best.grossLoss,
            maxDrawdownPct: best.maxDrawdownPct,
            maxDrawdownAbs: best.maxDrawdownAbs,
            totalTrades: best.totalTrades,
            winningTrades: best.winningTrades,
            avgBarsInTrade: best.avgBarsInTrade,
            buyAndHoldReturn,
            winRateStr: winRatePct,
            profitFactor,
            topStrategies: top3,
            paramConfig: best.params
        });

    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Serve built Vite frontend (production)
if (existsSync(join(__dirname, 'dist'))) {
    app.use(express.static(join(__dirname, 'dist')));
    app.use((req, res, next) => {
        if (!req.path.startsWith('/api')) {
            res.sendFile(join(__dirname, 'dist', 'index.html'));
        } else {
            next();
        }
    });
}

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend Engine successfully started!`);
    console.log(`- Port: ${PORT} (Bound to 0.0.0.0)`);
    console.log(`- Mode: ${process.env.NODE_ENV || 'development'}`);
});
