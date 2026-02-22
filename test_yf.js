import yahooFinanceClass from 'yahoo-finance2';
const yf = new yahooFinanceClass();

async function test() {
    try {
        const symbols = ['GC=F', 'NQ=F', 'ES=F', 'BTC-USD'];
        for (const symbol of symbols) {
            const interval = '60m';
            const lookbackDays = 7;
            const period1 = Math.floor((Date.now() - lookbackDays * 24 * 60 * 60 * 1000) / 1000);

            console.log(`Fetching ${symbol}, period1: ${new Date(period1 * 1000).toISOString()}`);

            const result = await yf.chart(symbol, { period1, interval });
            if (result && result.quotes && result.quotes.length > 0) {
                const last = result.quotes[result.quotes.length - 1];
                console.log(`[${symbol}] Last quote date: ${last.date.toISOString()}, close: ${last.close}`);
            } else {
                console.log(`[${symbol}] No quotes returned.`);
            }
        }
    } catch (e) {
        console.error(e);
    }
}

test();
