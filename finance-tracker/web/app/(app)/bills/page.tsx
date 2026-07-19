import { createClient } from '@/lib/supabase/server'
import { BillsView } from '@/components/bills/bills-view'
import { detectRecurring, matchCandidates } from '@/lib/finance/recurring'
import type { Bill, RecurringDismissal, Transaction } from '@/lib/types'

export default async function BillsPage() {
  const supabase = await createClient()
  const today = new Date()
  const windowStart = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 13, today.getUTCDate()),
  )
    .toISOString()
    .slice(0, 10)

  const [{ data: bills }, { data: txns }, { data: dismissals }] = await Promise.all([
    supabase.from('bills').select('*').order('name'),
    supabase.from('transactions').select('*').gte('date', windowStart),
    supabase.from('recurring_dismissals').select('*'),
  ])

  const billRows = (bills ?? []) as Bill[]
  const candidates = detectRecurring((txns ?? []) as Transaction[], today)
  const { open, dismissed } = matchCandidates(
    candidates,
    billRows,
    ((dismissals ?? []) as RecurringDismissal[]).map((d) => d.merchant_name),
  )

  return <BillsView bills={billRows} detectedOpen={open} detectedDismissed={dismissed} />
}
