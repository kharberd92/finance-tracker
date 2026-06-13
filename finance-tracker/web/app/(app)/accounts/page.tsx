import { createClient } from '@/lib/supabase/server'
import { EmptyState } from '@/components/empty-state'
import { Card } from '@/components/ui/card'
import { ConnectBankButton } from '@/components/plaid/connect-bank-button'
import { SyncButton } from '@/components/plaid/sync-button'
import type { Account } from '@/lib/types'

export default async function AccountsPage() {
  const supabase = await createClient()
  const { data } = await supabase.from('accounts').select('*').order('name')
  const accounts = (data ?? []) as Account[]

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Accounts</h1>
        <div className="flex gap-2">
          <ConnectBankButton />
          <SyncButton />
        </div>
      </div>

      {accounts.length === 0 ? (
        <EmptyState
          title="No linked accounts"
          hint='Click "Connect Bank" to link an account via Plaid, then "Sync now".'
        />
      ) : (
        <div className="space-y-2">
          {accounts.map((a) => (
            <Card key={a.id} className="flex items-center justify-between p-4">
              <div>
                <p className="font-medium">{a.name}</p>
                <p className="text-sm text-muted-foreground capitalize">
                  {a.type} · {a.institution_name}
                </p>
              </div>
              <p className="font-semibold">
                {a.current_balance.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
              </p>
            </Card>
          ))}
        </div>
      )}
    </section>
  )
}
