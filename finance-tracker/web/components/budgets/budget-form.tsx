'use client'

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { SPENDING_CATEGORIES } from '@/lib/finance/categories'
import { saveBudget, deleteBudget, type ActionState } from '@/app/(app)/budgets/actions'
import type { Budget } from '@/lib/types'

const initial: ActionState = {}
const fieldClass = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm'

export function BudgetForm({
  budget,
  budgetedCategories,
  onClose,
}: {
  budget: Budget | null
  budgetedCategories: string[]
  onClose: () => void
}) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(saveBudget, initial)

  useEffect(() => {
    if (state.success) {
      toast.success('Budget saved')
      router.refresh()
      onClose()
    } else if (state.error) {
      toast.error(state.error)
    }
  }, [state, onClose, router])

  const b = budget
  const available = SPENDING_CATEGORIES.filter((c) => !budgetedCategories.includes(c))

  async function handleDelete() {
    if (!b) return
    const res = await deleteBudget(b.id)
    if (res.error) {
      toast.error(res.error)
    } else {
      toast.success('Budget deleted')
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
        <h2 className="text-lg font-semibold">{b ? 'Edit budget' : 'Add budget'}</h2>
        <form action={formAction} className="space-y-3">
          <div>
            <label className="text-sm">Category</label>
            {b ? (
              <>
                <input type="hidden" name="category" value={b.category} />
                <p className="rounded-md bg-muted px-3 py-2 text-sm">{b.category}</p>
              </>
            ) : (
              <select name="category" className={fieldClass} defaultValue={available[0] ?? ''} required>
                {available.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label className="text-sm">Monthly limit</label>
            <Input
              name="monthly_limit"
              type="number"
              step="0.01"
              min="0"
              defaultValue={b?.monthly_limit ?? ''}
              required
            />
          </div>

          {state.error && (
            <p className="text-sm text-destructive" role="alert">
              {state.error}
            </p>
          )}

          <div className="flex items-center justify-between gap-2">
            {b ? (
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
