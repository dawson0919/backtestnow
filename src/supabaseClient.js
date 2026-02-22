import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

const isValid = (val) => val && val.trim() !== "" && val !== "undefined" && val !== "null";

export const supabase = (isValid(supabaseUrl) && isValid(supabaseAnonKey))
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;
