'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { addContribution } from '@/app/(app)/goals/actions'
import type { Goal } from '@/lib/types'

export function ContributionForm({ goal, onClose }: { goal: Goal; onClose: () => void }) {
  const router = useRouter()
  const [amount, setAmount] = useState('')
  const [pending, setPending] = useState(false)

  async function handleSave() {
    const n = Number(amount)
    if (!(n > 0)) {
      toast.error('Enter an amount greater than 0.')
      return
    }
    setPending(true)
    const res = await addContribution(goal.id, n)
    setPending(false)
    if (res.error) {
      toast.error(res.error)
    } else {
      toast.success('Contribution added')
      router.refresh()
      onClose()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <Card className="w-full max-w-sm space-y-4 p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold">Add to {goal.name}</h2>
        <div>
          <label className="text-sm">Amount</label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            autoFocus
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={pending}>
            {pending ? 'Adding…' : 'Add'}
          </Button>
        </div>
      </Card>
    </div>
  )
}
