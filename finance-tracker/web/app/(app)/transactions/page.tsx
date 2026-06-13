import { EmptyState } from '@/components/empty-state'

export default function TransactionsPage() {
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Transactions</h1>
      <EmptyState
        title="No transactions yet"
        hint="Connect a bank or add a manual transaction to get started."
      />
    </section>
  )
}
