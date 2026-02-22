import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.VITE_SUPABASE_ANON_KEY
);

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
    const { data: assets } = await supabase.from('assets').select('*').eq('active', true);
    const timeframes = ['1h', '1d'];

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
                    const yahooInterval = tf === '1d' ? '1d' : '60m';
                    const lookbackDays = yahooInterval === '1d' ? 5 * 365 : 700;
                    const chartResult = await yf.chart(symbol, {
                        period1: Math.floor((Date.now() - lookbackDays * 24 * 60 * 60 * 1000) / 1000),
                        interval: yahooInterval
                    });

                    klines = (chartResult.quotes || []).map(q => [
                        q.date.getTime(), q.open, q.high, q.low, q.close, q.volume
                    ]);
                    console.log(`[Yahoo] Got ${klines.length} quotes`);
                } else {

                    const { data: binanceKlines } = await axios.get(`${baseUrl}/klines?symbol=${symbol}&interval=${tf}&limit=1000`);
                    klines = binanceKlines;
                }

                const rowsToInsert = klines.map(k => ({
                    asset_id: asset.id,
                    timeframe: tf.toUpperCase(),
                    timestamp: k[0],
                    open: parseFloat(k[1]),
                    high: parseFloat(k[2]),
                    low: parseFloat(k[3]),
                    close: parseFloat(k[4]),
                    volume: parseFloat(k[5])
                }));

                await supabase.from('historical_data').delete().eq('asset_id', asset.id).eq('timeframe', tf.toUpperCase());
                await supabase.from('historical_data').insert(rowsToInsert);
                console.log(`OK (${klines.length} rows)`);
            } catch (e) {
                console.log(`FAILED: ${e.message}`);
            }
        }
    }
    console.log("All updates complete.");
}

updateAll();
