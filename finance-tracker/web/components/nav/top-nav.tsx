import Link from 'next/link'
import { signOut } from '@/app/auth/actions'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/nav/theme-toggle'
import { NavLinks } from '@/components/nav/nav-links'

export function TopNav() {
  return (
    <header className="border-b">
      <nav className="mx-auto flex max-w-5xl items-center gap-4 px-4">
        <span className="font-semibold">💰 Finance Tracker</span>
        <NavLinks />
        <Link href="/settings" className="text-sm text-muted-foreground hover:text-foreground">
          Settings
        </Link>
        <ThemeToggle />
        <form action={signOut}>
          <Button type="submit" variant="outline" size="sm">
            Sign out
          </Button>
        </form>
      </nav>
    </header>
  )
}
