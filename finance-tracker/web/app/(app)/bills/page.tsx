import { createClient } from '@/lib/supabase/server'
import { BillsView } from '@/components/bills/bills-view'
import type { Bill } from '@/lib/types'

export default async function BillsPage() {
  const supabase = await createClient()
  const { data: bills } = await supabase.from('bills').select('*').order('name')

  return <BillsView bills={(bills ?? []) as Bill[]} />
}
