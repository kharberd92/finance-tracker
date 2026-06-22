'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { isGoalIcon, isGoalColor } from '@/lib/finance/goal-presets'

export type ActionState = { error?: string; success?: boolean }

const goalSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, 'Please enter a name'),
  target_amount: z.coerce.number().positive('Target must be greater than 0'),
  current_amount: z.coerce.number().min(0, 'Current amount cannot be negative'),
  target_date: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  icon: z.string().refine(isGoalIcon, 'Please choose an icon'),
  color_hex: z.string().refine(isGoalColor, 'Please choose a color'),
})

export async function saveGoal(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }

  const parsed = goalSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { id, name, target_amount, current_amount, target_date, icon, color_hex } = parsed.data
  const row = { name, target_amount, current_amount, target_date, icon, color_hex }

  const { error } = id
    ? await supabase.from('goals').update(row).eq('id', id)
    : await supabase.from('goals').insert({ user_id: user.id, ...row })

  if (error) return { error: 'Could not save the goal.' }
  revalidatePath('/goals')
  return { success: true }
}

export async function addContribution(id: string, amount: number): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }

  if (!(amount > 0)) return { error: 'Contribution must be greater than 0.' }

  const { data: goal, error: readErr } = await supabase
    .from('goals')
    .select('current_amount')
    .eq('id', id)
    .single()
  if (readErr || !goal) return { error: 'Could not find the goal.' }

  const { error } = await supabase
    .from('goals')
    .update({ current_amount: Number(goal.current_amount) + amount })
    .eq('id', id)
  if (error) return { error: 'Could not add the contribution.' }
  revalidatePath('/goals')
  return { success: true }
}

export async function deleteGoal(id: string): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }

  const { error } = await supabase.from('goals').delete().eq('id', id)
  if (error) return { error: 'Could not delete the goal.' }
  revalidatePath('/goals')
  return { success: true }
}
