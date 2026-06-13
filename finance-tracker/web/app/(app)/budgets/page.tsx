import { EmptyState } from '@/components/empty-state'

export default function BudgetsPage() {
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Budgets</h1>
      <EmptyState title="No budgets yet" hint="Create a category budget to track your spending." />
    </section>
  )
}
