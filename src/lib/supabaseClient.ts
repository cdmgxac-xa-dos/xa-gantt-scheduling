import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Standalone frontend, but the backend is the shared "XA DOS (by module)"
// Supabase project — this app's tables all live under the gantt_ prefix
// there, purely additive alongside XA DOS's own tables. See supabase/01_schema.sql.

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null

export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local.'
    )
  }
  return supabase
}
