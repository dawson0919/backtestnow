import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import yahooFinanceClass from 'yahoo-finance2';
const yf = new yahooFinanceClass();

const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.VITE_SUPABASE_ANON_KEY
);

async function updateNQ() {
    const symbol = 'NQ=F';
    const timeframe = '1H';

    // Find asset_id for NQ!
    const { data: assetData } = await supabase.from('assets').select('id').eq('symbol', 'NQ!').single();
    if (!assetData) {
        console.error("NQ! not found in assets table");
        return;
    }
    const assetId = assetData.id;

    try {
        console.log(`Fetching ${symbol} ${timeframe}...`);
        const chartResult = await yf.chart(symbol, {
            period1: Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000),
            interval: '1h'
        });
        console.log("Chart keys:", Object.keys(chartResult));


        const klines = (chartResult.quotes || []).map(q => [
            q.date.getTime(), q.open, q.high, q.low, q.close, q.volume
        ]);

        console.log(`Got ${klines.length} rows`);

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
        const { error } = await supabase.from('historical_data').insert(rowsToInsert);
        if (error) throw error;
        console.log("Successfully inserted into Supabase");
    } catch (e) {
        console.error("FULL ERROR:", e);
    }
}

updateNQ();
