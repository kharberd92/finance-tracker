import { createClient } from '@supabase/supabase-js'

/**
 * Service-role Supabase client for headless jobs (the daily-sync script, and a
 * future Vercel cron route). Bypasses Row Level Security — NEVER import this
 * from client/browser code. Reads SUPABASE_SERVICE_ROLE_KEY from the env.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}
