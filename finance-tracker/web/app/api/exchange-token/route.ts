import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createPlaidClient } from '@/lib/plaid/client'
import { encryptToken } from '@/lib/plaid/crypto'
import { mapAccount, type PlaidAccountLike } from '@/lib/plaid/map'

export const runtime = 'nodejs'

const bodySchema = z.object({
  publicToken: z.string().min(1),
  institutionName: z.string().optional().default(''),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'publicToken is required' }, { status: 400 })
  }
  const { publicToken, institutionName } = parsed.data

  try {
    const client = createPlaidClient()
    const exchange = await client.itemPublicTokenExchange({ public_token: publicToken })
    const accessToken = exchange.data.access_token

    const { data: item, error: itemError } = await supabase
      .from('plaid_items')
      .insert({
        user_id: user.id,
        plaid_item_id: exchange.data.item_id,
        encrypted_access_token: encryptToken(accessToken),
        institution_name: institutionName,
      })
      .select('id')
      .single()
    if (itemError || !item) {
      return NextResponse.json({ error: 'Failed to store item' }, { status: 500 })
    }

    const balances = await client.accountsBalanceGet({ access_token: accessToken })
    const accounts = (balances.data.accounts as PlaidAccountLike[]).map((a) =>
      mapAccount(a, user.id, (item as { id: string }).id, institutionName),
    )
    if (accounts.length > 0) {
      const { error: upsertError } = await supabase
        .from('accounts')
        .upsert(accounts, { onConflict: 'user_id,plaid_account_id' })
      if (upsertError) {
        return NextResponse.json({ error: 'Failed to store accounts' }, { status: 500 })
      }
    }

    return NextResponse.json({ ok: true, accountCount: accounts.length })
  } catch {
    return NextResponse.json({ error: 'Failed to exchange public token' }, { status: 502 })
  }
}
