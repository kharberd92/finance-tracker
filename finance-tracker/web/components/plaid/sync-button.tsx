'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

export function SyncButton() {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function handleSync() {
    setPending(true)
    try {
      const res = await fetch('/api/sync', { method: 'POST', signal: AbortSignal.timeout(30000) })
      if (!res.ok) throw new Error()
      const { added, modified, removed } = (await res.json()) as {
        added: number
        modified: number
        removed: number
      }
      toast.success(`Synced: ${added} added, ${modified} updated, ${removed} removed`)
      router.refresh()
    } catch {
      toast.error('Sync failed. Try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Button variant="outline" onClick={handleSync} disabled={pending}>
      {pending ? 'Syncing…' : 'Sync now'}
    </Button>
  )
}
