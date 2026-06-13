import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

// Next 16 renamed the `middleware` file convention to `proxy` (the deprecated
// `middleware.ts` would still work but emits a deprecation warning).
export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  // Run on everything except Next internals and static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
