import express from 'express';
import cors from 'cors';
import axios from 'axios';
import { SMA } from 'technicalindicators';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import yahooFinanceClass from 'yahoo-finance2';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
const __dirname = dirname(fileURLToPath(import.meta.url));
const yf = new yahooFinanceClass();

const app = express();

app.use(cors());
app.use(express.json());

const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.VITE_SUPABASE_ANON_KEY
);


const PORT = process.env.PORT || 3001;

function mapInterval(timeframe) {
    const map = {
        '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m',
        '1H': '1h', '2H': '2h', '4H': '4h', 'D': '1d'
    };
    return map[timeframe] || '1h';
}

app.post('/api/backtest', async (req, res) => {
    try {
        const { asset, timeframe, paramConfig, capitalConfig } = req.body;

        // Traditional finance → Yahoo Finance; Crypto → Binance (default)
        const binanceMap = {}; // pure crypto pairs (e.g. BTCUSDT) need no mapping
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

        // 1. Find asset_id
        const { data: assetData } = await supabase
            .from('assets')
            .select('id')
            .eq('symbol', asset)
            .single();

        if (assetData) {
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
                    .order('timestamp', { ascending: true });

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

                // Async Update DB
                if (klines.length > 0) {
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

                    await supabase.from('historical_data').delete().eq('asset_id', assetId).eq('timeframe', timeframe);
                    await supabase.from('historical_data').insert(rowsToInsert);
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
        // tickSize: minimum price movement
        // tickValue: USD value per tick per contract
        // pointValue: USD value per 1 full point (index point or dollar) per contract
        const contractSpecs = {
            'NQ!': { tickSize: 0.25, tickValue: 5, pointValue: 20 }, // Nasdaq E-mini: $20/pt
            'MNQ!': { tickSize: 0.25, tickValue: 0.50, pointValue: 2 }, // Micro Nasdaq: $2/pt
            'ES!': { tickSize: 0.25, tickValue: 12.50, pointValue: 50 }, // S&P 500 E-mini: $50/pt
            'MES!': { tickSize: 0.25, tickValue: 1.25, pointValue: 5 }, // Micro S&P: $5/pt
            'YM!': { tickSize: 1, tickValue: 5, pointValue: 5 }, // Dow E-mini: $5/pt
            'MYM!': { tickSize: 1, tickValue: 0.50, pointValue: 0.5 }, // Micro Dow: $0.50/pt
            'RTY!': { tickSize: 0.10, tickValue: 5, pointValue: 50 }, // Russell 2000: $50/pt
            'GC!': { tickSize: 0.10, tickValue: 10, pointValue: 100 }, // Gold: $100/pt (100 oz)
            'MGC!': { tickSize: 0.10, tickValue: 1, pointValue: 10 }, // Micro Gold: $10/pt
            'SIL!': { tickSize: 0.005, tickValue: 25, pointValue: 5000 }, // Silver: $5000/pt (5000 oz)
            'CL!': { tickSize: 0.01, tickValue: 10, pointValue: 1000 }, // Crude Oil: $1000/pt
            'NG!': { tickSize: 0.001, tickValue: 10, pointValue: 10000 }, // Nat Gas: $10000/pt
            'HG!': { tickSize: 0.0005, tickValue: 12.50, pointValue: 25000 }, // Copper: $250/0.01
            'ZB!': { tickSize: 0.03125, tickValue: 31.25, pointValue: 1000 }, // 30Y Bond
            'ZN!': { tickSize: 0.015625, tickValue: 15.625, pointValue: 1000 }, // 10Y Note
        };

        const spec = contractSpecs[asset] || null;
        const numContracts = capitalConfig?.mode === 'contracts' ? (Number(capitalConfig.value) || 1) : 1;


        // Filter out null/NaN/zero entries (Yahoo Finance includes them for market-closed hours)
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

        const defaultCapital = isYahoo ? 50000 : 10000;
        let initialCapital = (capitalConfig?.mode === 'fixed' && capitalConfig?.value && Number(capitalConfig.value) > 0)
            ? Number(capitalConfig.value)
            : defaultCapital;

        // --- Real Parameter Optimization Loop ---
        console.log(`Starting real optimization for ${asset}...`);
        const results_list = [];

        // Derive base fast/slow from paramConfig, falling back to sensible defaults
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

        // Sort by net profit descending
        results_list.sort((a, b) => b.netProfit - a.netProfit);
        const best = results_list[0];
        const top3 = results_list.slice(0, 3).map(r => ({
            roi: `${Number(r.netProfitPct) >= 0 ? '+' : ''}${r.netProfitPct}%`,
            params: r.params
        }));

        // --- Summary Stats for the best strategy ---
        const totalClosed = best.trades.filter(t => t.type.includes('Exit')).length;
        const winRatePct = totalClosed > 0 ? (best.winningTrades / totalClosed * 100).toFixed(1) : '0.0';
        const profitFactor = best.grossLoss > 0 ? (best.grossProfit / best.grossLoss).toFixed(2) : best.grossProfit > 0 ? '∞' : '0.00';

        const closedTradePnls = best.trades.filter(t => t.type.includes('Exit')).map(t => t.pnlValue);
        const avgPnl = closedTradePnls.length > 0 ? closedTradePnls.reduce((a, b) => a + b, 0) / closedTradePnls.length : 0;
        const stdPnl = closedTradePnls.length > 1 ? Math.sqrt(closedTradePnls.map(p => Math.pow(p - avgPnl, 2)).reduce((a, b) => a + b, 0) / closedTradePnls.length) : 0;
        const sharpeRatio = stdPnl > 0 ? (avgPnl / stdPnl).toFixed(2) : '0.00';

        const downPnls = closedTradePnls.filter(p => p < 0);
        const downStd = downPnls.length > 1
            ? Math.sqrt(downPnls.map(p => p * p).reduce((a, b) => a + b, 0) / downPnls.length)
            : 0;
        const sortinoRatio = downStd > 0 ? (avgPnl / downStd).toFixed(2) : avgPnl > 0 ? '∞' : '0.00';

        const buyAndHoldReturn = (((closes[closes.length - 1] - closes[0]) / closes[0]) * 100).toFixed(2);

        // Downsample chartData to at most 200 points for the frontend
        const raw = best.chartData;
        const step = Math.max(1, Math.ceil(raw.length / 200));
        const chartData = raw.filter((_, idx) => idx % step === 0 || idx === raw.length - 1);

        res.json({
            success: true,
            asset,
            initialCapital,
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
            sharpeRatio,
            sortinoRatio,
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
    app.get('*', (req, res) => {
        if (!req.path.startsWith('/api')) {
            res.sendFile(join(__dirname, 'dist', 'index.html'));
        }
    });
}

app.listen(PORT, () => console.log(`Backend Engine running natively on http://localhost:${PORT}`));
