import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/card'

export default async function SettingsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Settings</h1>
      <Card className="p-6">
        <p className="text-sm text-muted-foreground">Signed in as</p>
        <p className="font-medium">{user?.email}</p>
      </Card>
    </section>
  )
}
