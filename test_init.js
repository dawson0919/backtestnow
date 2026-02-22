
import dotenv from 'dotenv';
dotenv.config();

const _supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const _supabaseKey = (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "").trim();

console.log('URL:', _supabaseUrl ? 'EXISTS' : 'MISSING');
console.log('KEY:', _supabaseKey ? 'EXISTS' : 'MISSING');

if (_supabaseUrl && _supabaseKey) {
    console.log('Condition: TRUE - createClient would be called');
} else {
    console.log('Condition: FALSE - createClient skipped');
}
