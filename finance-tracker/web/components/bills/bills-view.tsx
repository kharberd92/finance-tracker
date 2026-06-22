'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/empty-state'
import { nextDueDate, daysUntilDue, isPaid, monthlyCost } from '@/lib/finance/bill'
import { setBillPaid } from '@/app/(app)/bills/actions'
import { BillForm } from './bill-form'
import type { Bill } from '@/lib/types'

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const fmtDate = (date: Date) =>
  date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

function dueLabel(days: number | null): string {
  if (days == null) return ''
  if (days === 0) return 'due today'
  if (days < 0) return `${-days} day${days === -1 ? '' : 's'} overdue`
  return `due in ${days} day${days === 1 ? '' : 's'}`
}

export function BillsView({ bills }: { bills: Bill[] }) {
  const router = useRouter()
  const [editing, setEditing] = useState<Bill | null>(null)
  const [creating, setCreating] = useState(false)
  const now = new Date()

  const sorted = [...bills].sort((a, b) => {
    const da = daysUntilDue(a, now)
    const db = daysUntilDue(b, now)
    if (da == null) return 1
    if (db == null) return -1
    return da - db
  })
  const totalMonthly = bills.reduce((sum, b) => sum + monthlyCost(b), 0)

  async function togglePaid(bill: Bill, paid: boolean) {
    const res = await setBillPaid(bill.id, !paid)
    if (res.error) {
      toast.error(res.error)
    } else {
      toast.success(!paid ? 'Marked paid' : 'Marked unpaid')
      router.refresh()
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Bills</h1>
        <Button onClick={() => setCreating(true)}>+ Add bill</Button>
      </div>

      {bills.length === 0 ? (
        <EmptyState title="No bills yet" hint="Add a recurring bill to see what's due and when." />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            ≈ {usd(totalMonthly)}/mo across {bills.length} bill{bills.length === 1 ? '' : 's'}
          </p>
          <div className="space-y-2">
            {sorted.map((b) => {
              const due = nextDueDate(b, now)
              const days = daysUntilDue(b, now)
              const paid = isPaid(b, now)
              return (
                <Card key={b.id} className="space-y-2 p-4">
                  <div className="flex items-center justify-between">
                    <button type="button" className="text-left" onClick={() => setEditing(b)}>
                      <span className="font-medium">{b.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{b.category}</span>
                    </button>
                    <span className="text-sm text-muted-foreground">
                      {usd(b.amount)} · {b.frequency}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                      {due ? `Next: ${fmtDate(due)} · ${dueLabel(days)}` : 'No upcoming date'}
                    </p>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          paid ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {paid ? 'Paid' : 'Due'}
                      </span>
                      <Button variant="outline" size="sm" onClick={() => togglePaid(b, paid)}>
                        {paid ? 'Mark unpaid' : 'Mark paid'}
                      </Button>
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        </>
      )}

      {(creating || editing) && (
        <BillForm
          bill={editing}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
        />
      )}
    </section>
  )
}
