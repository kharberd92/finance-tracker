'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const LINKS = [
  { href: '/', label: 'Dashboard' },
  { href: '/transactions', label: 'Transactions' },
  { href: '/budgets', label: 'Budgets' },
  { href: '/goals', label: 'Goals' },
  { href: '/bills', label: 'Bills' },
  { href: '/accounts', label: 'Accounts' },
]

export function NavLinks() {
  const pathname = usePathname()
  return (
    <ul className="flex flex-1 gap-4 text-sm">
      {LINKS.map((l) => {
        const active = l.href === '/' ? pathname === '/' : pathname.startsWith(l.href)
        return (
          <li key={l.href}>
            <Link
              href={l.href}
              className={
                active
                  ? 'relative font-semibold text-foreground after:absolute after:-bottom-[17px] after:left-0 after:right-0 after:h-0.5 after:rounded-full after:bg-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }
            >
              {l.label}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
