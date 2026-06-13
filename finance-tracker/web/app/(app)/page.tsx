import { createClient } from '@/lib/supabase/server'
import { netWorth } from '@/lib/finance/net-worth'
import { Card } from '@/components/ui/card'
import type { Account } from '@/lib/types'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data } = await supabase.from('accounts').select('*')
  const accounts = (data ?? []) as Account[]
  const total = netWorth(accounts)

  return (
    <div className="space-y-4">
      <Card className="p-6 text-center">
        <p className="text-xs uppercase text-muted-foreground">Net worth</p>
        <p className="text-3xl font-bold">
          {total.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
        </p>
      </Card>

      {/* Widget grid — real widgets land in Plan 5. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {['Spent vs. budget', 'Goals progress', 'Upcoming bills', 'Recent transactions'].map(
          (label) => (
            <Card key={label} className="p-6">
              <p className="font-medium">{label}</p>
              <p className="mt-1 text-sm text-muted-foreground">Coming soon.</p>
            </Card>
          ),
        )}
      </div>
    </div>
  )
}
