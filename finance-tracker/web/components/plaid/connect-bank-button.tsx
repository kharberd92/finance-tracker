'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { usePlaidLink, type PlaidLinkOnSuccessMetadata } from 'react-plaid-link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

export function ConnectBankButton() {
  const router = useRouter()
  const [linkToken, setLinkToken] = useState<string | null>(null)

  const onSuccess = useCallback(
    async (publicToken: string, metadata: PlaidLinkOnSuccessMetadata) => {
      try {
        const res = await fetch('/api/exchange-token', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            publicToken,
            institutionName: metadata.institution?.name ?? '',
          }),
          signal: AbortSignal.timeout(15000),
        })
        if (!res.ok) throw new Error()
        toast.success('Bank connected. Click "Sync now" to import transactions.')
        router.refresh()
      } catch {
        toast.error('Could not finish connecting the bank.')
      } finally {
        setLinkToken(null)
      }
    },
    [router],
  )

  const { open, ready } = usePlaidLink({ token: linkToken, onSuccess })

  useEffect(() => {
    if (linkToken && ready) open()
  }, [linkToken, ready, open])

  async function handleClick() {
    try {
      const res = await fetch('/api/create-link-token', {
        method: 'POST',
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) throw new Error()
      const { linkToken } = (await res.json()) as { linkToken: string }
      setLinkToken(linkToken)
    } catch {
      toast.error('Could not start bank connection.')
    }
  }

  return <Button onClick={handleClick}>Connect Bank</Button>
}
