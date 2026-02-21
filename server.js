import express from 'express';
import cors from 'cors';
import axios from 'axios';
import { SMA } from 'technicalindicators';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3001;

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

        // Convert to Binance Symbol format, if the symbol is anything custom try to normalize
        const symbol = asset === 'GC!' ? 'XAUUSDT' : asset;
        const interval = mapInterval(timeframe);

        // Fetch up to 1000 K-lines (maximum for a single binance request)
        const { data: klines } = await axios.get(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=1000`);

        const closes = klines.map(k => parseFloat(k[4]));
        const highs = klines.map(k => parseFloat(k[2]));
        const lows = klines.map(k => parseFloat(k[3]));
        const dates = klines.map(k => new Date(k[0]));

        // Setup real trading parameters according to the provided ones in UI
        const fastLen = Math.floor(paramConfig.fast_len || paramConfig.length || 10);
        const slowLen = Math.floor(paramConfig.slow_len || fastLen * 2);
        const stopLoss = paramConfig.stopLoss || 5;
        const takeProfit = paramConfig.takeProfit || 10;

        // Perform SMA crossover
        const fastSma = SMA.calculate({ period: fastLen, values: closes });
        const slowSma = SMA.calculate({ period: slowLen, values: closes });

        // Align arrays because technical indicators shortens the output array
        const paddedFastSma = Array(fastLen - 1).fill(null).concat(fastSma);
        const paddedSlowSma = Array(slowLen - 1).fill(null).concat(slowSma);

        let initialCapital = capitalConfig?.value ? Number(capitalConfig.value) : 10000;
        let capital = initialCapital;

        let position = null;
        let trades = [];
        let chartData = [];

        let peakCapital = capital;
        let maxDrawdownAbs = 0;
        let grossProfit = 0;
        let grossLoss = 0;
        let winningTrades = 0;

        for (let i = 1; i < klines.length; i++) {
            const currentClose = closes[i];
            const currentHigh = highs[i];
            const currentLow = lows[i];
            const currentDate = dates[i];
            const currentFast = paddedFastSma[i];
            const currentSlow = paddedSlowSma[i];

            const prevFast = paddedFastSma[i - 1];
            const prevSlow = paddedSlowSma[i - 1];

            if (currentFast === null || currentSlow === null || prevFast === null || prevSlow === null) {
                chartData.push({
                    name: currentDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                    equity: Number(capital.toFixed(2))
                });
                continue;
            }

            // Resolution Logic (Exit)
            if (position) {
                let exitPrice = null;
                let signal = '';

                const priceDropPct = (position.entryPrice - currentLow) / position.entryPrice * 100;
                const priceGainPct = (currentHigh - position.entryPrice) / position.entryPrice * 100;

                if (priceDropPct >= stopLoss) {
                    exitPrice = position.entryPrice * (1 - (stopLoss / 100)); // Executed at Stop
                    signal = 'Stop Loss';
                } else if (priceGainPct >= takeProfit) {
                    exitPrice = position.entryPrice * (1 + (takeProfit / 100)); // Executed at TP
                    signal = 'Take Profit';
                } else if (prevFast >= prevSlow && currentFast < currentSlow) {
                    exitPrice = currentClose; // Executed on Signal Reverse
                    signal = 'MA Cross';
                }

                if (exitPrice) {
                    const pnlRatio = (exitPrice - position.entryPrice) / position.entryPrice;
                    const pnlVal = capital * pnlRatio;

                    capital += pnlVal;

                    if (pnlVal > 0) {
                        winningTrades++;
                        grossProfit += pnlVal;
                    } else {
                        grossLoss += Math.abs(pnlVal);
                    }

                    trades.push({
                        id: trades.length + 1,
                        isWin: pnlVal > 0,
                        isLong: true,
                        dateObject: currentDate,
                        dateStr: currentDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                        timeStr: currentDate.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }),
                        price: `$${exitPrice.toFixed(2)}`,
                        pnlValue: pnlVal,
                        pnl: pnlVal > 0 ? `+${pnlVal.toFixed(2)}` : `${pnlVal.toFixed(2)}`,
                        signal: signal,
                        type: 'Exit Long',
                        typeColor: pnlVal > 0 ? 'var(--success)' : 'var(--danger)'
                    });

                    position = null;
                }
            }

            // Entry Logic
            if (!position) {
                if (prevFast <= prevSlow && currentFast > currentSlow) {
                    position = {
                        type: 'long',
                        entryPrice: currentClose,
                        entryTime: currentDate,
                    };

                    trades.push({
                        id: trades.length + 1,
                        isWin: false,
                        isLong: true,
                        dateObject: currentDate,
                        dateStr: currentDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                        timeStr: currentDate.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }),
                        price: `$${currentClose.toFixed(2)}`,
                        pnlValue: 0,
                        pnl: '-',
                        signal: 'MA Cross',
                        type: 'Entry Long',
                        typeColor: 'var(--success)'
                    });
                }
            }

            if (capital > peakCapital) peakCapital = capital;
            const drawdownAbs = peakCapital - capital;
            if (drawdownAbs > maxDrawdownAbs) {
                maxDrawdownAbs = drawdownAbs;
            }

            chartData.push({
                name: currentDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                equity: Number(capital.toFixed(2))
            });
        }

        const totalClosed = trades.filter(t => t.type.includes('Exit')).length;
        const netProfit = capital - initialCapital;
        const netProfitPct = ((netProfit / initialCapital) * 100).toFixed(2);
        let maxDrawdownPct = peakCapital > 0 ? (maxDrawdownAbs / peakCapital) * 100 : 0;

        let buyHoldReturn = ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100;

        res.json({
            success: true,
            trades: trades.reverse(), // Frontend parses history backwards usually (recent up top)
            chartData: chartData.filter((_, idx) => idx % Math.ceil(chartData.length / 50) === 0 || idx === chartData.length - 1),
            netProfit,
            netProfitPct,
            grossProfit,
            grossLoss,
            maxDrawdownPct,
            maxDrawdownAbs,
            totalTrades: totalClosed,
            winningTrades: winningTrades,
            buyAndHoldReturn: buyHoldReturn.toFixed(2)
        });

    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, error: e.message });
    }
});

app.listen(PORT, () => console.log(`Backend Engine running natively on http://localhost:${PORT}`));
