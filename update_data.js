import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config(); // Load from .env or system env (Railway)

const isValid = (val) => val && val.trim() !== "" && val !== "undefined" && val !== "null";
const _url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const _key = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

let supabase = null;
if (isValid(_url) && isValid(_key)) {
    supabase = createClient(_url, _key);
}

import yahooFinanceClass from 'yahoo-finance2';
const yf = new yahooFinanceClass();


// Matches server.js routing: all traditional finance → Yahoo Finance
const binanceMap = {}; // only raw crypto (e.g. BTCUSDT) go to Binance
const yahooMap = {
    'NQ!': 'NQ=F',
    'ES!': 'ES=F',
    'YM!': 'YM=F',
    'RTY!': 'RTY=F',
    'GC!': 'GC=F',
    'SIL!': 'SI=F',
    'CL!': 'CL=F',
    'NG!': 'NG=F',
    'HG!': 'HG=F',
    'ZB!': 'ZB=F',
    'ZN!': 'ZN=F',
    'DX!': 'DX-Y.NYB',
};

async function updateAll() {
    if (!supabase) {
        console.error("Supabase config missing. Aborting sync.");
        return;
    }
    const { data: assets } = await supabase.from('assets').select('*').eq('active', true);
    const timeframes = ['1H', 'D'];

    for (const asset of assets) {
        for (const tf of timeframes) {
            const isYahoo = !!yahooMap[asset.symbol];
            const symbol = yahooMap[asset.symbol] || asset.symbol;
            const baseUrl = 'https://api.binance.com/api/v3';


            try {
                process.stdout.write(`Updating ${asset.symbol} (${symbol}) ${tf} via ${isYahoo ? 'Yahoo' : 'Binance'}... `);

                let klines = [];
                if (isYahoo) {
                    console.log(`[Yahoo] Fetching ${symbol}...`);
                    const yahooInterval = tf === 'D' ? '1d' : '60m';
                    const lookbackDays = yahooInterval === '1d' ? 5 * 365 : 365;
                    const chartResult = await yf.chart(symbol, {
                        period1: Math.floor((Date.now() - lookbackDays * 24 * 60 * 60 * 1000) / 1000),
                        interval: yahooInterval
                    });

                    klines = (chartResult.quotes || []).map(q => [
                        q.date.getTime(), q.open, q.high, q.low, q.close, q.volume
                    ]);
                    if (klines.length > 0) {
                        const lastDate = new Date(klines[klines.length - 1][0]).toISOString();
                        console.log(`[Yahoo] Got ${klines.length} quotes. Latest: ${lastDate}`);
                    } else {
                        console.log(`[Yahoo] Got 0 quotes`);
                    }
                } else {
                    const binanceInterval = tf === 'D' ? '1d' : tf.toLowerCase();
                    console.log(`[Binance] Fetching ${symbol} ${binanceInterval}...`);
                    const { data: binanceKlines } = await axios.get(`${baseUrl}/klines?symbol=${symbol}&interval=${binanceInterval}&limit=1000`);
                    klines = binanceKlines;
                    if (klines.length > 0) {
                        const lastDate = new Date(klines[klines.length - 1][0]).toISOString();
                        console.log(`[Binance] Got ${klines.length} quotes. Latest: ${lastDate}`);
                    }
                }

                const allRows = klines.map(k => ({
                    asset_id: asset.id,
                    timeframe: tf,
                    timestamp: k[0],
                    open: parseFloat(k[1]),
                    high: parseFloat(k[2]),
                    low: parseFloat(k[3]),
                    close: parseFloat(k[4]),
                    volume: parseFloat(k[5])
                }));
                const rowsToInsert = allRows.filter(r => !isNaN(r.close) && r.close !== 0);
                console.log(`[Filter] ${allRows.length} total -> ${rowsToInsert.length} valid rows`);
                if (rowsToInsert.length > 0) {
                    const lastValid = rowsToInsert[rowsToInsert.length - 1];
                    console.log(`[Debug] Last VALID quote date: ${new Date(lastValid.timestamp).toISOString()}`);
                }

                // Upsert with batching
                const batchSize = 1000;
                for (let i = 0; i < rowsToInsert.length; i += batchSize) {
                    const batch = rowsToInsert.slice(i, i + batchSize);
                    const { error } = await supabase.from('historical_data').upsert(batch, { onConflict: 'asset_id, timeframe, timestamp' });
                    if (error) throw new Error(`Upsert failed: ${error.message}`);
                }
                console.log(`OK - Sync complete.`);
            } catch (e) {
                console.log(`FAILED: ${e.message}`);
            }
        }
    }
    console.log("All updates complete.");
}

updateAll();
