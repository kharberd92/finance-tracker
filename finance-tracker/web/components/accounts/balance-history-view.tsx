'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { dayLabel } from '@/components/dashboard/chart-geometry'
import { isLiability } from '@/lib/finance/net-worth'
import { saveBalanceHistory } from '@/app/(app)/accounts/actions'
import type { Account, AccountBalanceSnapshot, SnapshotProvenance } from '@/lib/types'

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

const BADGE: Record<SnapshotProvenance, { label: string; className: string }> = {
  manual: { label: 'Recorded', className: 'bg-income/15 text-income' },
  observed: { label: 'Captured', className: 'bg-accent-soft text-accent-soft-foreground' },
  reconstructed: { label: 'Estimated', className: 'bg-muted text-muted-foreground' },
}

export function BalanceHistoryView({
  accounts,
  snapshots,
  dates,
}: {
  accounts: Account[]
  snapshots: AccountBalanceSnapshot[]
  dates: string[]
}) {
  const router = useRouter()
  const [selectedId, setSelectedId] = useState(accounts[0]?.id ?? '')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  const account = accounts.find((a) => a.id === selectedId)

  // Existing rows for the selected account, by date.
  const existing = new Map(
    snapshots.filter((s) => s.account_id === selectedId).map((s) => [s.as_of, s]),
  )

  function select(id: string) {
    setSelectedId(id)
    setDrafts({})
    setError(null)
    setSaved(false)
  }

  function onSave() {
    if (!account) return
    setError(null)
    setSaved(false)

    // Only cells the user actually touched are submitted. An estimate is shown
    // as a placeholder, never a value, so an untouched field cannot quietly
    // promote a guess into a balance the user is taken to have attested to.
    const entries = Object.entries(drafts).map(([as_of, raw]) => {
      const text = raw.trim()
      return { as_of, balance: text === '' ? null : Number(text) }
    })

    if (entries.length === 0) {
      setError('Nothing has changed yet.')
      return
    }
    const bad = entries.find((e) => e.balance !== null && !Number.isFinite(e.balance))
    if (bad) {
      setError(`${dayLabel(bad.as_of)} is not a number.`)
      return
    }

    startTransition(async () => {
      const res = await saveBalanceHistory(account.id, entries)
      if (res.error) {
        setError(res.error)
        return
      }
      setDrafts({})
      setSaved(true)
      router.refresh()
    })
  }

  if (accounts.length === 0) return null

  const owed = account ? isLiability(account.type) : false

  return (
    <Card className="space-y-4 p-4">
      <div>
        <h2 className="font-medium">Add balances</h2>
        <p className="text-sm text-muted-foreground">
          Enter what each statement showed on that date. Blank fields are left alone; clearing a
          recorded balance removes it.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {accounts.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => select(a.id)}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
              a.id === selectedId
                ? 'bg-accent-soft text-accent-soft-foreground shadow-sm'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {a.name}
          </button>
        ))}
      </div>

      {account && (
        <>
          <p className="text-xs text-muted-foreground">
            {owed
              ? `${account.name} is a credit account — enter the amount owed as a positive number, the way the statement shows it.`
              : `${account.name} — enter the balance as the statement shows it.`}
          </p>

          <div className="space-y-1.5">
            {dates.map((as_of) => {
              const row = existing.get(as_of)
              const badge = row ? BADGE[row.source] : null
              const locked = row?.source === 'observed'
              // A manual row is editable and pre-filled; an estimate shows only
              // as a placeholder so it cannot be saved without being retyped.
              const value =
                drafts[as_of] ??
                (row?.source === 'manual' ? String(row.balance) : '')

              return (
                <div key={as_of} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 text-sm whitespace-nowrap">{dayLabel(as_of)}</span>

                  {locked ? (
                    <span className="h-8 flex-1 rounded-lg border bg-muted/50 px-2.5 py-1 text-sm tabular-nums text-muted-foreground">
                      {usd(row.balance)}
                    </span>
                  ) : (
                    <input
                      type="text"
                      inputMode="decimal"
                      aria-label={`${owed ? 'Amount owed' : 'Balance'} on ${dayLabel(as_of)}`}
                      value={value}
                      placeholder={
                        row?.source === 'reconstructed' ? `${usd(row.balance)} (estimated)` : ''
                      }
                      onChange={(e) => {
                        setSaved(false)
                        setDrafts((d) => ({ ...d, [as_of]: e.target.value }))
                      }}
                      className="h-8 flex-1 rounded-lg border bg-background px-2.5 text-sm tabular-nums outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    />
                  )}

                  <span
                    className={`w-20 shrink-0 rounded-full px-2 py-0.5 text-center text-xs font-medium ${
                      badge ? badge.className : 'bg-muted/50 text-muted-foreground'
                    }`}
                  >
                    {badge ? badge.label : 'Missing'}
                  </span>
                </div>
              )
            })}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {saved && !error && <p className="text-sm text-income">Balances saved.</p>}

          <div className="flex items-center gap-2">
            <Button onClick={onSave} disabled={pending || Object.keys(drafts).length === 0}>
              {pending ? 'Saving…' : 'Save balances'}
            </Button>
            {Object.keys(drafts).length > 0 && (
              <Button variant="ghost" onClick={() => setDrafts({})} disabled={pending}>
                Discard changes
              </Button>
            )}
          </div>
        </>
      )}
    </Card>
  )
}
