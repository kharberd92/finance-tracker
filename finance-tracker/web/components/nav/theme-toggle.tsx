'use client'

import { useSyncExternalStore } from 'react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'

// The theme is only knowable on the client, so `mounted` reads false on the
// server and through hydration, then true once React re-reads the snapshot.
// useSyncExternalStore (rather than setState in an effect) keeps that flip out
// of an effect body — see react-hooks/set-state-in-effect. The store never
// changes, so the subscribe callback has nothing to register.
const neverChanges = () => () => {}

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const mounted = useSyncExternalStore(
    neverChanges,
    () => true,
    () => false,
  )

  // Avoid hydration mismatch: render a stable placeholder until mounted.
  const isDark = mounted && resolvedTheme === 'dark'

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label="Toggle theme"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
    >
      {mounted ? (isDark ? '☀️' : '🌙') : '🌙'}
    </Button>
  )
}
