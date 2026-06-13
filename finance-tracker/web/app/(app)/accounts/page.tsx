import { EmptyState } from '@/components/empty-state'

export default function AccountsPage() {
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Accounts</h1>
      <EmptyState
        title="No linked accounts"
        hint="Bank linking via Plaid arrives in the next plan."
      />
    </section>
  )
}
