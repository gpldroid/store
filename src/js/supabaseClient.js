import { createClient } from "@supabase/supabase-js";

const env = import.meta.env;
const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseKey = env.VITE_SUPABASE_ANON_KEY;

export const createOrderFunctionUrl = env.VITE_CREATE_ORDER_FUNCTION_URL;

if (!supabaseUrl || !supabaseKey) {
  console.warn("Supabase is not configured. Copy .env.example to .env.local and add public project values.");
}

export const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
  : null;

export function requireSupabase() {
  if (!supabase) {
    throw new Error("المتجر غير مهيأ بعد. يرجى ضبط إعدادات Supabase.");
  }
  return supabase;
}
