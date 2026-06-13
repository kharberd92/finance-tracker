import { EmptyState } from '@/components/empty-state'

export default function BillsPage() {
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Bills</h1>
      <EmptyState title="No bills yet" hint="Add a recurring bill to see what's due and when." />
    </section>
  )
}
