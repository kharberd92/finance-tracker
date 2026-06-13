import { NextResponse } from 'next/server'
import { Products, CountryCode } from 'plaid'
import { createClient } from '@/lib/supabase/server'
import { createPlaidClient } from '@/lib/plaid/client'

export const runtime = 'nodejs'

export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const client = createPlaidClient()
    const response = await client.linkTokenCreate({
      user: { client_user_id: user.id },
      client_name: 'Personal Finance Tracker',
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: 'en',
    })
    return NextResponse.json({ linkToken: response.data.link_token })
  } catch {
    return NextResponse.json({ error: 'Failed to create link token' }, { status: 502 })
  }
}
