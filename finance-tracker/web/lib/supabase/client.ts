import { createBrowserClient } from '@supabase/ssr'

/** Supabase client for Client Components (e.g. the future Plaid Link button). */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
