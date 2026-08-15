import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Local-dev sign-in helper. Mints a magic link through the Supabase admin API
 * WITHOUT sending an email, so it sidesteps the built-in SMTP rate limit that
 * blocks repeated sign-ins during development.
 *
 * The generated link is a live credential — anyone holding it gets a session
 * for that account. It is therefore written to `logs/` (gitignored) and never
 * printed to stdout, so it cannot end up in terminal scrollback, CI output, or
 * an agent transcript. Delete the file once you have used it.
 *
 * Usage:
 *   npm run dev:login -- you@example.com
 *   npm run dev:login -- you@example.com http://192.168.1.136:3000
 *
 * The redirect target must be registered in the Supabase dashboard under
 * Auth -> URL Configuration, or Supabase rejects it.
 */

const OUT_FILE = resolve(process.cwd(), 'logs/login-link.txt')

async function main() {
  const email = process.argv[2]
  const base = process.argv[3] ?? process.env.NEXT_PUBLIC_SITE_URL

  if (!email) {
    throw new Error('Usage: npm run dev:login -- <email> [base-url]')
  }
  if (!base) {
    throw new Error('No base URL: pass one as the second argument or set NEXT_PUBLIC_SITE_URL.')
  }

  const redirectTo = `${base.replace(/\/$/, '')}/auth/callback`

  const db = createAdminClient()
  const { data, error } = await db.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo },
  })

  if (error) throw new Error(`generateLink failed: ${error.message}`)

  const link = data?.properties?.action_link
  if (!link) throw new Error('generateLink returned no action_link.')

  mkdirSync(dirname(OUT_FILE), { recursive: true })
  writeFileSync(OUT_FILE, `${link}\n`, { encoding: 'utf8' })

  // Deliberately does not print the link itself — see the note above.
  console.log(`[dev-login] link for ${email} written to ${OUT_FILE}`)
  console.log(`[dev-login] redirects to ${redirectTo}`)
  console.log('[dev-login] open it on the target device, then delete the file.')
}

main().catch((err) => {
  console.error(`[dev-login] ${err instanceof Error ? err.message : String(err)}`)
  process.exitCode = 1
})
