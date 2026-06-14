'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { isSpendingCategory } from '@/lib/finance/categories'

export type ActionState = { error?: string; success?: boolean }

const budgetSchema = z.object({
  category: z.string().refine(isSpendingCategory, 'Please choose a spending category'),
  monthly_limit: z.coerce.number().positive('Limit must be greater than 0'),
})

export async function saveBudget(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }

  const parsed = budgetSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { category, monthly_limit } = parsed.data
  const { error } = await supabase
    .from('budgets')
    .upsert({ user_id: user.id, category, monthly_limit }, { onConflict: 'user_id,category' })

  if (error) return { error: 'Could not save the budget.' }
  revalidatePath('/budgets')
  return { success: true }
}

export async function deleteBudget(id: string): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }

  const { error } = await supabase.from('budgets').delete().eq('id', id)
  if (error) return { error: 'Could not delete the budget.' }
  revalidatePath('/budgets')
  return { success: true }
}
