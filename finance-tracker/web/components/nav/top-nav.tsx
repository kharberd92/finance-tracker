import Link from 'next/link'
import { signOut } from '@/app/auth/actions'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/nav/theme-toggle'

const LINKS = [
  { href: '/', label: 'Dashboard' },
  { href: '/transactions', label: 'Transactions' },
  { href: '/budgets', label: 'Budgets' },
  { href: '/goals', label: 'Goals' },
  { href: '/bills', label: 'Bills' },
  { href: '/accounts', label: 'Accounts' },
]

export function TopNav() {
  return (
    <header className="border-b">
      <nav className="mx-auto flex max-w-5xl items-center gap-4 p-4">
        <span className="font-semibold">💰 Finance Tracker</span>
        <ul className="flex flex-1 gap-3 text-sm">
          {LINKS.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="text-muted-foreground hover:text-foreground">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
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
