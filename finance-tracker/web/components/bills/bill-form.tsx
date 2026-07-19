'use client'

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { SPENDING_CATEGORIES } from '@/lib/finance/categories'
import { saveBill, deleteBill, type ActionState } from '@/app/(app)/bills/actions'
import type { Bill, BillFrequency } from '@/lib/types'

const initial: ActionState = {}
const fieldClass = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm'
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export interface BillPrefill {
  name: string
  amount: number
  category: string
  frequency: BillFrequency
  due_day: number
  due_month: number | null
  merchant_name: string
}

export function BillForm({
  bill,
  prefill = null,
  onClose,
}: {
  bill: Bill | null
  prefill?: BillPrefill | null
  onClose: () => void
}) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(saveBill, initial)
  const [frequency, setFrequency] = useState<string>(bill?.frequency ?? prefill?.frequency ?? 'monthly')

  useEffect(() => {
    if (state.success) {
      toast.success('Bill saved')
      router.refresh()
      onClose()
    } else if (state.error) {
      toast.error(state.error)
    }
  }, [state, onClose, router])

  const b = bill
  const isWeekly = frequency === 'weekly'
  const needsMonth = frequency === 'quarterly' || frequency === 'yearly'

  async function handleDelete() {
    if (!b) return
    const res = await deleteBill(b.id)
    if (res.error) {
      toast.error(res.error)
    } else {
      toast.success('Bill deleted')
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
        <h2 className="text-lg font-semibold">{b ? 'Edit bill' : 'Add bill'}</h2>
        <form action={formAction} className="space-y-3">
          {b && <input type="hidden" name="id" value={b.id} />}
          {!b && prefill?.merchant_name && (
            <input type="hidden" name="merchant_name" value={prefill.merchant_name} />
          )}

          <div>
            <label className="text-sm">Name</label>
            <Input name="name" defaultValue={b?.name ?? prefill?.name ?? ''} required />
          </div>
          <div>
            <label className="text-sm">Amount</label>
            <Input name="amount" type="number" step="0.01" min="0" defaultValue={b?.amount ?? prefill?.amount ?? ''} required />
          </div>
          <div>
            <label className="text-sm">Category</label>
            <select name="category" className={fieldClass} defaultValue={b?.category ?? prefill?.category ?? SPENDING_CATEGORIES[0]} required>
              {SPENDING_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm">Frequency</label>
            <select
              name="frequency"
              className={fieldClass}
              value={frequency}
              onChange={(e) => setFrequency(e.target.value)}
            >
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>

          {needsMonth && (
            <div>
              <label className="text-sm">Month</label>
              <select name="due_month" className={fieldClass} defaultValue={b?.due_month ?? prefill?.due_month ?? 1} required>
                {MONTHS.map((mn, i) => (
                  <option key={mn} value={i + 1}>
                    {mn}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="text-sm">{isWeekly ? 'Day of week' : 'Day of month'}</label>
            {isWeekly ? (
              <select name="due_day" className={fieldClass} defaultValue={b?.due_day ?? prefill?.due_day ?? 1} required>
                {WEEKDAYS.map((wd, i) => (
                  <option key={wd} value={i}>
                    {wd}
                  </option>
                ))}
              </select>
            ) : (
              <Input name="due_day" type="number" min="1" max="31" defaultValue={b?.due_day ?? prefill?.due_day ?? 1} required />
            )}
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
