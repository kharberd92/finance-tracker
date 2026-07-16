'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { isCategory, SPLIT_CATEGORY } from '@/lib/finance/categories'
import { splitsMatchParent } from '@/lib/finance/split'

export type ActionState = { error?: string; success?: boolean }

const categoryField = z.string().refine(isCategory, 'Please choose a valid category')

const manualSchema = z.object({
  id: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A valid date is required'),
  merchant_name: z.string().min(1, 'Merchant is required'),
  category: categoryField,
  amount: z.coerce.number().positive('Amount must be greater than 0'),
  type: z.enum(['expense', 'income']),
  account_id: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  notes: z.string().optional().default(''),
})

export async function saveManualTransaction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }

  const parsed = manualSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { id, type, amount, account_id, date, merchant_name, category, notes } = parsed.data
  const signedAmount = type === 'expense' ? -Math.abs(amount) : Math.abs(amount)
  const row = {
    user_id: user.id,
    account_id,
    date,
    merchant_name,
    category,
    notes,
    amount: signedAmount,
    is_manual: true,
  }

  const { error } = id
    ? await supabase.from('transactions').update(row).eq('id', id).eq('is_manual', true)
    : await supabase.from('transactions').insert(row)

  if (error) return { error: 'Could not save the transaction.' }
  revalidatePath('/transactions')
  return { success: true }
}

const categorySchema = z.object({
  id: z.string().min(1),
  category: categoryField,
  notes: z.string().optional().default(''),
})

export async function updateTransactionCategory(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }

  const parsed = categorySchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { id, category, notes } = parsed.data
  const { error } = await supabase.from('transactions').update({ category, notes }).eq('id', id)
  if (error) return { error: 'Could not update the transaction.' }
  revalidatePath('/transactions')
  return { success: true }
}

export async function deleteManualTransaction(id: string): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }

  const { error } = await supabase.from('transactions').delete().eq('id', id).eq('is_manual', true)
  if (error) return { error: 'Could not delete the transaction.' }
  revalidatePath('/transactions')
  return { success: true }
}

const splitPartSchema = z.object({
  category: categoryField,
  amount: z.coerce.number().positive('Split amounts must be greater than 0'),
})

const splitsSchema = z.object({
  id: z.string().min(1),
  splits: z
    .string()
    .transform((s, ctx) => {
      try {
        return JSON.parse(s) as unknown
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Could not read the split parts.' })
        return z.NEVER
      }
    })
    .pipe(z.array(splitPartSchema).min(2, 'A split needs at least two categories')),
})

export async function saveTransactionSplits(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }

  const parsed = splitsSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const { id, splits } = parsed.data

  // Resolve the parent amount from the DB (never trust the client for it).
  const { data: txn, error: txnErr } = await supabase
    .from('transactions')
    .select('amount')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()
  if (txnErr || !txn) return { error: 'Could not find that transaction.' }

  const parentAmount = Number(txn.amount)
  if (!splitsMatchParent(parentAmount, splits)) {
    return { error: 'Split amounts must add up to the transaction total.' }
  }

  const sign = parentAmount < 0 ? -1 : 1
  const rows = splits.map((p) => ({
    user_id: user.id,
    transaction_id: id,
    category: p.category,
    amount: sign * Math.abs(p.amount),
  }))

  const { error: delErr } = await supabase.from('transaction_splits').delete().eq('transaction_id', id)
  if (delErr) return { error: 'Could not save the split.' }
  const { error: insErr } = await supabase.from('transaction_splits').insert(rows)
  if (insErr) return { error: 'Could not save the split.' }
  const { error: updErr } = await supabase
    .from('transactions')
    .update({ category: SPLIT_CATEGORY })
    .eq('id', id)
  if (updErr) return { error: 'Could not save the split.' }

  revalidatePath('/transactions')
  return { success: true }
}

export async function removeTransactionSplits(id: string): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }

  const { error: delErr } = await supabase.from('transaction_splits').delete().eq('transaction_id', id)
  if (delErr) return { error: 'Could not remove the split.' }
  const { error: updErr } = await supabase
    .from('transactions')
    .update({ category: 'Uncategorized' })
    .eq('id', id)
  if (updErr) return { error: 'Could not remove the split.' }

  revalidatePath('/transactions')
  return { success: true }
}
