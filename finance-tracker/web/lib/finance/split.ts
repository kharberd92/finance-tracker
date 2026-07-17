import type { Transaction, TransactionSplit } from '@/lib/types'

const CENT = 0.01

/** Sum of split magnitudes, rounded to cents. */
export function splitTotal(splits: { amount: number }[]): number {
  const sum = splits.reduce((acc, s) => acc + Math.abs(s.amount), 0)
  return Math.round(sum * 100) / 100
}

/** True when the parts' magnitudes add up to the parent magnitude (within 1 cent). */
export function splitsMatchParent(parentAmount: number, splits: { amount: number }[]): boolean {
  return Math.abs(splitTotal(splits) - Math.abs(parentAmount)) < CENT
}

/**
 * Replaces each split parent with one virtual Transaction per part (parent fields copied;
 * category/amount from the part; a unique synthetic id `${txnId}:${splitId}`). Transactions
 * with no splits pass through unchanged.
 */
export function explodeSplits(
  transactions: Transaction[],
  splits: TransactionSplit[],
): Transaction[] {
  const byTxn = new Map<string, TransactionSplit[]>()
  for (const s of splits) {
    const list = byTxn.get(s.transaction_id) ?? []
    list.push(s)
    byTxn.set(s.transaction_id, list)
  }
  const out: Transaction[] = []
  for (const t of transactions) {
    const parts = byTxn.get(t.id)
    if (!parts || parts.length === 0) {
      out.push(t)
      continue
    }
    for (const p of parts) {
      out.push({ ...t, id: `${t.id}:${p.id}`, category: p.category, amount: p.amount })
    }
  }
  return out
}
