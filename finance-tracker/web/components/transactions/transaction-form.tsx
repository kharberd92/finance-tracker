'use client'

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { CATEGORIES } from '@/lib/finance/categories'
import { splitTotal, splitsMatchParent } from '@/lib/finance/split'
import {
  saveManualTransaction,
  updateTransactionCategory,
  deleteManualTransaction,
  saveTransactionSplits,
  removeTransactionSplits,
  type ActionState,
} from '@/app/(app)/transactions/actions'
import type { Account, Transaction, TransactionSplit } from '@/lib/types'

const initial: ActionState = {}
const fieldClass = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm'

export function TransactionForm({
  accounts,
  transaction,
  splits,
  onClose,
}: {
  accounts: Account[]
  transaction: Transaction | null
  splits: TransactionSplit[]
  onClose: () => void
}) {
  const router = useRouter()
  const isManual = transaction ? transaction.is_manual : true
  const [state, formAction, pending] = useActionState(
    isManual ? saveManualTransaction : updateTransactionCategory,
    initial,
  )

  useEffect(() => {
    if (state.success) {
      toast.success('Transaction saved')
      router.refresh()
      onClose()
    } else if (state.error) {
      toast.error(state.error)
    }
  }, [state, onClose, router])

  const t = transaction
  const defaultType = t ? (t.amount < 0 ? 'expense' : 'income') : 'expense'

  async function handleDelete() {
    if (!t) return
    const res = await deleteManualTransaction(t.id)
    if (res.error) {
      toast.error(res.error)
    } else {
      toast.success('Transaction deleted')
      router.refresh()
      onClose()
    }
  }

  type Part = { category: string; amount: string }
  const [parts, setParts] = useState<Part[]>(
    splits.length > 0
      ? splits.map((s) => ({ category: s.category, amount: String(Math.abs(s.amount)) }))
      : [
          { category: 'Groceries', amount: '' },
          { category: 'Shopping', amount: '' },
        ],
  )
  const [splitOpen, setSplitOpen] = useState(splits.length > 0)

  const partAmounts = parts.map((p) => ({ amount: Number(p.amount) || 0 }))
  const allocated = splitTotal(partAmounts)
  const parentMagnitude = t ? Math.abs(t.amount) : 0
  const splitsBalance = t ? splitsMatchParent(t.amount, partAmounts) : false

  function updatePart(i: number, patch: Partial<Part>) {
    setParts((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)))
  }
  function addPart() {
    setParts((prev) => [...prev, { category: 'Uncategorized', amount: '' }])
  }
  function removePart(i: number) {
    setParts((prev) => prev.filter((_, idx) => idx !== i))
  }

  async function handleSaveSplits() {
    if (!t) return
    const form = new FormData()
    form.set('id', t.id)
    form.set(
      'splits',
      JSON.stringify(parts.map((p) => ({ category: p.category, amount: Number(p.amount) || 0 }))),
    )
    const res = await saveTransactionSplits({}, form)
    if (res.error) {
      toast.error(res.error)
    } else {
      toast.success('Split saved')
      router.refresh()
      onClose()
    }
  }

  async function handleRemoveSplits() {
    if (!t) return
    const res = await removeTransactionSplits(t.id)
    if (res.error) {
      toast.error(res.error)
    } else {
      toast.success('Split removed')
      router.refresh()
      onClose()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <Card className="w-full max-w-md space-y-4 p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold">
          {t ? (isManual ? 'Edit transaction' : 'Edit category') : 'Add transaction'}
        </h2>

        <form action={formAction} className="space-y-3">
          {t && <input type="hidden" name="id" value={t.id} />}

          {isManual ? (
            <>
              <div>
                <label className="text-sm">Date</label>
                <Input type="date" name="date" defaultValue={t?.date ?? ''} required />
              </div>
              <div>
                <label className="text-sm">Merchant</label>
                <Input name="merchant_name" defaultValue={t?.merchant_name ?? ''} required />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-sm">Type</label>
                  <select name="type" defaultValue={defaultType} className={fieldClass}>
                    <option value="expense">Expense</option>
                    <option value="income">Income</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-sm">Amount</label>
                  <Input
                    name="amount"
                    type="number"
                    step="0.01"
                    min="0"
                    defaultValue={t ? Math.abs(t.amount) : ''}
                    required
                  />
                </div>
              </div>
              <div>
                <label className="text-sm">Account (optional)</label>
                <select name="account_id" defaultValue={t?.account_id ?? ''} className={fieldClass}>
                  <option value="">No account</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            </>
          ) : (
            <div className="rounded-md bg-muted p-3 text-sm">
              <p className="font-medium">{t!.merchant_name}</p>
              <p className="text-muted-foreground">
                {t!.date} ·{' '}
                {t!.amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} · synced
                (amount/date locked)
              </p>
            </div>
          )}

          <div>
            <label className="text-sm">Category</label>
            <select name="category" defaultValue={t?.category ?? 'Uncategorized'} className={fieldClass}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm">Notes</label>
            <textarea
              name="notes"
              defaultValue={t?.notes ?? ''}
              rows={2}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>

          {state.error && (
            <p className="text-sm text-destructive" role="alert">
              {state.error}
            </p>
          )}

          {t && (
            <div className="rounded-md border border-input p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Split transaction</span>
                {!splitOpen && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setSplitOpen(true)}>
                    {splits.length > 0 ? 'Edit split' : 'Split'}
                  </Button>
                )}
              </div>

              {splitOpen && (
                <div className="mt-3 space-y-2">
                  {parts.map((p, i) => (
                    <div key={i} className="flex gap-2">
                      <select
                        aria-label={`Split ${i + 1} category`}
                        className={fieldClass}
                        value={p.category}
                        onChange={(e) => updatePart(i, { category: e.target.value })}
                      >
                        {CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                      <Input
                        aria-label={`Split ${i + 1} amount`}
                        type="number"
                        step="0.01"
                        min="0"
                        className="w-28"
                        value={p.amount}
                        onChange={(e) => updatePart(i, { amount: e.target.value })}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => removePart(i)}
                        disabled={parts.length <= 2}
                      >
                        ✕
                      </Button>
                    </div>
                  ))}

                  <Button type="button" variant="outline" size="sm" onClick={addPart}>
                    + Add split
                  </Button>

                  <p className={`text-xs ${splitsBalance ? 'text-muted-foreground' : 'text-destructive'}`}>
                    Allocated {allocated.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} of{' '}
                    {parentMagnitude.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                  </p>

                  <div className="flex gap-2">
                    <Button type="button" onClick={handleSaveSplits} disabled={!splitsBalance}>
                      Save split
                    </Button>
                    {splits.length > 0 && (
                      <Button type="button" variant="destructive" onClick={handleRemoveSplits}>
                        Remove split
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            {t && isManual ? (
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
