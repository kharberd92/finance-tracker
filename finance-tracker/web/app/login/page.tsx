'use client'

import { useActionState } from 'react'
import { signInWithMagicLink, type AuthState } from '@/app/auth/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'

const initialState: AuthState = {}

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(signInWithMagicLink, initialState)

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm space-y-4 p-6">
        <div>
          <h1 className="text-xl font-semibold">Sign in</h1>
          <p className="text-sm text-muted-foreground">
            We&apos;ll email you a magic link — no password needed.
          </p>
        </div>

        {state.success ? (
          <p className="text-sm" role="status">
            Check your email for a sign-in link.
          </p>
        ) : (
          <form action={formAction} className="space-y-3">
            <Input
              type="email"
              name="email"
              placeholder="you@example.com"
              required
              aria-label="Email address"
            />
            {state.error && (
              <p className="text-sm text-destructive" role="alert">
                {state.error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? 'Sending…' : 'Send magic link'}
            </Button>
          </form>
        )}
      </Card>
    </main>
  )
}
