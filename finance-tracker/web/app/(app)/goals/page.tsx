import { EmptyState } from '@/components/empty-state'

export default function GoalsPage() {
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Goals</h1>
      <EmptyState title="No goals yet" hint="Set a savings goal and track your progress." />
    </section>
  )
}
