import { createClient } from '@/lib/supabase/server'
import { GoalsView } from '@/components/goals/goals-view'
import type { Goal } from '@/lib/types'

export default async function GoalsPage() {
  const supabase = await createClient()
  const { data: goals } = await supabase.from('goals').select('*').order('name')

  return <GoalsView goals={(goals ?? []) as Goal[]} />
}
