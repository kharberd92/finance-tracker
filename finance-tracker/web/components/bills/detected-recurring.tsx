'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { monthlyEquivalent } from '@/lib/finance/bill'
import type { RecurringCandidate } from '@/lib/finance/recurring'
import { dismissRecurring, restoreRecurring } from '@/app/(app)/bills/actions'
import { BillForm, type BillPrefill } from './bill-form'

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

export function DetectedRecurring({
  open,
  dismissed,
}: {
  open: RecurringCandidate[]
  dismissed: RecurringCandidate[]
}) {
  const router = useRouter()
  const [tracking, setTracking] = useState<RecurringCandidate | null>(null)
  const [showDismissed, setShowDismissed] = useState(false)

  async function handleDismiss(c: RecurringCandidate) {
    const res = await dismissRecurring(c.merchantKey)
    if (res.error) {
      toast.error(res.error)
    } else {
      toast.success('Dismissed')
      router.refresh()
    }
  }

  async function handleRestore(c: RecurringCandidate) {
    const res = await restoreRecurring(c.merchantKey)
    if (res.error) {
      toast.error(res.error)
    } else {
      toast.success('Restored')
      router.refresh()
    }
  }

  const prefill: BillPrefill | null = tracking && {
    name: tracking.displayName,
    amount: tracking.amount,
    category: tracking.categoryGuess,
    frequency: tracking.frequency,
    due_day: tracking.dueDayGuess,
    due_month: tracking.dueMonthGuess,
    merchant_name: tracking.merchantKey,
  }

  return (
    <div className="space-y-2 pt-2">
      <h2 className="text-sm font-medium">Detected recurring</h2>

      {open.length === 0 && dismissed.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No recurring charges detected yet — candidates appear after a few months of history.
        </p>
      ) : (
        <>
          {open.map((c) => (
            <Card key={c.merchantKey} className="flex items-center justify-between p-4">
              <div>
                <span className="font-medium">{c.displayName}</span>
                <p className="text-xs text-muted-foreground">
                  {usd(c.amount)} · {c.frequency} · ≈ {usd(monthlyEquivalent(c.amount, c.frequency))}
                  /mo · seen {c.occurrences}×
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setTracking(c)}>
                  Track as bill
                </Button>
                <Button size="sm" variant="outline" onClick={() => handleDismiss(c)}>
                  Dismiss
                </Button>
              </div>
            </Card>
          ))}
          {open.length === 0 && (
            <p className="text-sm text-muted-foreground">
              All detected recurring charges are tracked or dismissed.
            </p>
          )}

          {dismissed.length > 0 && (
            <div>
              <button
                type="button"
                className="text-xs font-medium text-muted-foreground hover:underline"
                onClick={() => setShowDismissed((v) => !v)}
              >
                Dismissed ({dismissed.length}) {showDismissed ? '▾' : '▸'}
              </button>
              {showDismissed && (
                <div className="mt-2 space-y-2">
                  {dismissed.map((c) => (
                    <Card key={c.merchantKey} className="flex items-center justify-between p-3">
                      <span className="text-sm text-muted-foreground">
                        {c.displayName} · {usd(c.amount)} · {c.frequency}
                      </span>
                      <Button size="sm" variant="outline" onClick={() => handleRestore(c)}>
                        Restore
                      </Button>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {tracking && prefill && (
        <BillForm bill={null} prefill={prefill} onClose={() => setTracking(null)} />
      )}
    </div>
  )
}
