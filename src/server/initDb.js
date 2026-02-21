import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = join(__dirname, 'backtestnow.db');
const dbExists = fs.existsSync(dbPath);

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
    }
});

// Initialize the database structure
const initDb = () => {
    db.serialize(() => {
        // 1. Create Assets Table
        db.run(`
      CREATE TABLE IF NOT EXISTS assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL, -- 'crypto' or 'futures'
        name TEXT NOT NULL,
        base_currency TEXT NOT NULL,
        quote_currency TEXT NOT NULL,
        pip_value REAL DEFAULT 1,
        contract_size REAL DEFAULT 1,
        active BOOLEAN DEFAULT 1
      )
    `);

        // 2. Clear existing entries to rerun seed cleanly during development
        db.run(`DELETE FROM assets`);

        // 3. Seed initial assets based on user request
        const stmt = db.prepare(`
      INSERT INTO assets (symbol, type, name, base_currency, quote_currency) 
      VALUES (?, ?, ?, ?, ?)
    `);

        const initialAssets = [
            // Crypto (加密貨幣)
            ['BTCUSDT', 'crypto', 'Bitcoin', 'BTC', 'USDT'],
            ['ETHUSDT', 'crypto', 'Ethereum', 'ETH', 'USDT'],
            ['SOLUSDT', 'crypto', 'Solana', 'SOL', 'USDT'],
            ['BNBUSDT', 'crypto', 'Binance Coin', 'BNB', 'USDT'],
            ['XAUTUSDT', 'crypto', 'Tether Gold', 'XAUT', 'USDT'], // requested XAUT cryptocurrency

            // Traditional Futures (傳統期貨 - For testing fixed contract mode)
            ['GC!', 'futures', 'Gold Futures', 'GC', 'USD'],
            ['ES!', 'futures', 'E-mini S&P 500', 'ES', 'USD']
        ];

        console.log('Seeding predefined assets...');
        for (const asset of initialAssets) {
            stmt.run(asset);
        }
        stmt.finalize();

        // 4. Create Historical Data Table (K-line raw data schema)
        // Structure required to accommodate 1D, 4H, 1H, 15m large datasets
        db.run(`
      CREATE TABLE IF NOT EXISTS historical_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        asset_id INTEGER NOT NULL,
        timeframe TEXT NOT NULL, -- '15m', '1H', '4H', '1D'
        timestamp INTEGER NOT NULL,
        open REAL NOT NULL,
        high REAL NOT NULL,
        low REAL NOT NULL,
        close REAL NOT NULL,
        volume REAL NOT NULL,
        FOREIGN KEY(asset_id) REFERENCES assets(id),
        UNIQUE(asset_id, timeframe, timestamp)
      )
    `);

        // Create indexes for fast querying of deep histories
        db.run(`CREATE INDEX IF NOT EXISTS idx_historical_data_asset_timeframe ON historical_data(asset_id, timeframe)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_historical_data_timestamp ON historical_data(timestamp)`);

        console.log('Database schema and seed completed successfully.');
    });
};

initDb();

// Close connection safely
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error(err.message);
        }
        console.log('Database connection closed.');
        process.exit(0);
    });
});

export default db;
