import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createPlaidClient } from '@/lib/plaid/client'
import { syncPlaidItems } from '@/lib/plaid/sync-items'
import type { PlaidItem } from '@/lib/types'

export const runtime = 'nodejs'

export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const client = createPlaidClient()
    const { data: items } = await supabase.from('plaid_items').select('*')
    const { totals, errors, itemsSynced } = await syncPlaidItems(
      supabase,
      client,
      (items ?? []) as PlaidItem[],
    )
    // Preserve the manual endpoint's contract: a hard failure (no item synced
    // despite errors) is a 502, not a green 200 with empty totals. Per-item
    // isolation still benefits the headless daily job, which reads `errors`.
    if (itemsSynced === 0 && errors.length > 0) {
      return NextResponse.json({ error: 'Failed to sync', errors }, { status: 502 })
    }
    return NextResponse.json(totals)
  } catch {
    return NextResponse.json({ error: 'Failed to sync' }, { status: 502 })
  }
}
