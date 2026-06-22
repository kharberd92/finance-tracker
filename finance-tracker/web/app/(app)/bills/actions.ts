'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { isSpendingCategory } from '@/lib/finance/categories'

export type ActionState = { error?: string; success?: boolean }

const billSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().trim().min(1, 'Please enter a name'),
    amount: z.coerce.number().positive('Amount must be greater than 0'),
    category: z.string().refine(isSpendingCategory, 'Please choose a spending category'),
    frequency: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']),
    due_day: z.coerce.number().int('Day must be a whole number'),
    due_month: z.preprocess(
      (v) => (v === '' || v == null ? undefined : v),
      z.coerce.number().int().min(1).max(12).optional(),
    ),
  })
  .superRefine((val, ctx) => {
    const min = val.frequency === 'weekly' ? 0 : 1
    const max = val.frequency === 'weekly' ? 6 : 31
    if (val.due_day < min || val.due_day > max) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['due_day'], message: 'Invalid due day for this frequency' })
    }
    if ((val.frequency === 'quarterly' || val.frequency === 'yearly') && val.due_month == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['due_month'], message: 'Please choose a month' })
    }
  })

export async function saveBill(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }

  const parsed = billSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { id, name, amount, category, frequency, due_day, due_month } = parsed.data
  const anchored = frequency === 'quarterly' || frequency === 'yearly'
  const row = {
    name,
    amount,
    category,
    frequency,
    due_day,
    due_month: anchored ? due_month : null,
  }

  const { error } = id
    ? await supabase.from('bills').update(row).eq('id', id)
    : await supabase.from('bills').insert({ user_id: user.id, ...row })

  if (error) return { error: 'Could not save the bill.' }
  revalidatePath('/bills')
  return { success: true }
}

export async function setBillPaid(id: string, paid: boolean): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }

  const last_paid_date = paid ? new Date().toISOString().slice(0, 10) : null
  const { error } = await supabase.from('bills').update({ last_paid_date }).eq('id', id)
  if (error) return { error: 'Could not update the bill.' }
  revalidatePath('/bills')
  return { success: true }
}

export async function deleteBill(id: string): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }

  const { error } = await supabase.from('bills').delete().eq('id', id)
  if (error) return { error: 'Could not delete the bill.' }
  revalidatePath('/bills')
  return { success: true }
}
