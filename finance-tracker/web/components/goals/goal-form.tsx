'use client'

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { GOAL_ICONS, GOAL_COLORS } from '@/lib/finance/goal-presets'
import { saveGoal, deleteGoal, type ActionState } from '@/app/(app)/goals/actions'
import type { Goal } from '@/lib/types'

const initial: ActionState = {}

export function GoalForm({ goal, onClose }: { goal: Goal | null; onClose: () => void }) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(saveGoal, initial)
  const [icon, setIcon] = useState<string>(goal?.icon ?? GOAL_ICONS[0])
  const [color, setColor] = useState<string>(goal?.color_hex ?? GOAL_COLORS[0])

  useEffect(() => {
    if (state.success) {
      toast.success('Goal saved')
      router.refresh()
      onClose()
    } else if (state.error) {
      toast.error(state.error)
    }
  }, [state, onClose, router])

  const g = goal

  async function handleDelete() {
    if (!g) return
    const res = await deleteGoal(g.id)
    if (res.error) {
      toast.error(res.error)
    } else {
      toast.success('Goal deleted')
      router.refresh()
      onClose()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <Card className="w-full max-w-sm space-y-4 p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold">{g ? 'Edit goal' : 'Add goal'}</h2>
        <form action={formAction} className="space-y-3">
          {g && <input type="hidden" name="id" value={g.id} />}
          <input type="hidden" name="icon" value={icon} />
          <input type="hidden" name="color_hex" value={color} />

          <div>
            <label className="text-sm">Name</label>
            <Input name="name" defaultValue={g?.name ?? ''} required />
          </div>
          <div>
            <label className="text-sm">Target amount</label>
            <Input
              name="target_amount"
              type="number"
              step="0.01"
              min="0"
              defaultValue={g?.target_amount ?? ''}
              required
            />
          </div>
          <div>
            <label className="text-sm">Current amount</label>
            <Input
              name="current_amount"
              type="number"
              step="0.01"
              min="0"
              defaultValue={g?.current_amount ?? 0}
            />
          </div>
          <div>
            <label className="text-sm">Target date (optional)</label>
            <Input name="target_date" type="date" defaultValue={g?.target_date ?? ''} />
          </div>

          <div>
            <label className="text-sm">Icon</label>
            <div className="flex flex-wrap gap-2">
              {GOAL_ICONS.map((ic) => (
                <button
                  type="button"
                  key={ic}
                  onClick={() => setIcon(ic)}
                  className={`h-9 w-9 rounded-md border text-lg ${
                    icon === ic ? 'border-foreground' : 'border-input'
                  }`}
                >
                  {ic}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-sm">Color</label>
            <div className="flex flex-wrap gap-2">
              {GOAL_COLORS.map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => setColor(c)}
                  aria-label={c}
                  className={`h-7 w-7 rounded-full border-2 ${
                    color === c ? 'border-foreground' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          {state.error && (
            <p className="text-sm text-destructive" role="alert">
              {state.error}
            </p>
          )}

          <div className="flex items-center justify-between gap-2">
            {g ? (
              <Button type="button" variant="destructive" onClick={handleDelete}>
                Delete
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </form>
      </Card>
    </div>
  )
}
