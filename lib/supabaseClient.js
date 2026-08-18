import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Supabase võtmed puuduvad (NEXT_PUBLIC_SUPABASE_URL / ANON_KEY).');
}

export const supabase = createClient(supabaseUrl || 'https://example.supabase.co', supabaseAnonKey || 'missing', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

