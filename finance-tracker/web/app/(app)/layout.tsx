import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { TopNav } from '@/components/nav/top-nav'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Defense in depth: the proxy also redirects, but never render app chrome
  // without a verified user.
  if (!user) redirect('/login')

  return (
    <div>
      <TopNav />
      <main className="mx-auto max-w-5xl p-4">{children}</main>
    </div>
  )
}
