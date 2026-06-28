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
        // The link owns its vertical padding and a 2px bottom border; -mb-px
        // makes that border overlap the header's border, so the active
        // underline sits on the header edge without a padding-coupled offset.
        return (
          <li key={l.href} className="flex">
            <Link
              href={l.href}
              className={`flex items-center border-b-2 py-4 -mb-px ${
                active
                  ? 'border-primary font-semibold text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {l.label}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
