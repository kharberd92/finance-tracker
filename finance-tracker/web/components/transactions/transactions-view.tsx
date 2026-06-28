'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/empty-state'
import { CATEGORIES } from '@/lib/finance/categories'
import { shiftMonth } from '@/lib/finance/month'
import { TransactionForm } from './transaction-form'
import type { Account, Transaction } from '@/lib/types'

const selectClass = 'h-9 rounded-md border border-input bg-background px-2 text-sm'

export function TransactionsView({
  month,
  transactions,
  accounts,
}: {
  month: string
  transactions: Transaction[]
  accounts: Account[]
}) {
  const router = useRouter()
  const [accountFilter, setAccountFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [creating, setCreating] = useState(false)

  const accountName = useMemo(() => {
    const m: Record<string, string> = {}
    for (const a of accounts) m[a.id] = a.name
    return m
  }, [accounts])

  const filtered = useMemo(
    () =>
      transactions.filter((t) => {
        if (accountFilter !== 'all' && t.account_id !== accountFilter) return false
        if (categoryFilter !== 'all' && t.category !== categoryFilter) return false
        if (search && !t.merchant_name.toLowerCase().includes(search.toLowerCase())) return false
        return true
      }),
    [transactions, accountFilter, categoryFilter, search],
  )

  function gotoMonth(delta: number) {
    router.push(`/transactions?month=${shiftMonth(month, delta)}`)
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Transactions</h1>
        <Button onClick={() => setCreating(true)}>+ Add transaction</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => gotoMonth(-1)}>
          ←
        </Button>
        <span className="min-w-24 text-center text-sm font-medium">{month}</span>
        <Button variant="outline" size="sm" onClick={() => gotoMonth(1)}>
          →
        </Button>

        <select
          aria-label="Filter by account"
          className={selectClass}
          value={accountFilter}
          onChange={(e) => setAccountFilter(e.target.value)}
        >
          <option value="all">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by category"
          className={selectClass}
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          <option value="all">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <Input
          className="w-48"
          placeholder="Search merchant…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No transactions"
          hint="Add a manual transaction, or connect a bank and sync."
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((t) => (
            <Card
              key={t.id}
              className="flex cursor-pointer items-center justify-between p-3"
              onClick={() => setEditing(t)}
            >
              <div className="flex flex-col">
                <span className="font-medium">{t.merchant_name}</span>
                <span className="text-xs text-muted-foreground">
                  {t.date} · {t.account_id ? accountName[t.account_id] ?? '—' : 'No account'}
                  {t.is_manual ? ' · manual' : ''}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{t.category}</span>
                <span
                  className={
                    t.amount < 0 ? 'font-semibold tabular-nums text-expense' : 'font-semibold tabular-nums text-income'
                  }
                >
                  {t.amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <TransactionForm
          accounts={accounts}
          transaction={editing}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
        />
      )}
    </section>
  )
}
