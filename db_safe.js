import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load variables
dotenv.config();
dotenv.config({ path: '.env.local' });

const isValid = (val) => {
    if (!val) return false;
    const s = String(val).trim();
    return s !== "" && s !== "undefined" && s !== "null";
};

const url = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const key = (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "").trim();

let supabaseInstance = null;

if (isValid(url) && isValid(key)) {
    try {
        console.log('[DB] Found credentials, initializing Supabase...');
        supabaseInstance = createClient(url, key);
        console.log('[DB] Supabase initialized successfully.');
    } catch (e) {
        console.error('[DB] Initialization failed:', e.message);
    }
} else {
    console.warn('[DB] Credentials missing or invalid. Database features disabled.');
}

export const supabase = supabaseInstance;
