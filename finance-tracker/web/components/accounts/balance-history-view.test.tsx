import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('@/app/(app)/accounts/actions', () => ({ saveBalanceHistory: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { BalanceHistoryView } from './balance-history-view'
import { saveBalanceHistory } from '@/app/(app)/accounts/actions'
import type { Account, AccountBalanceSnapshot } from '@/lib/types'

const mockedSave = vi.mocked(saveBalanceHistory)

const dates = ['2026-06-30', '2026-07-31']

const accounts: Account[] = [
  {
    id: 'a', user_id: 'u', name: 'Checking', type: 'checking',
    current_balance: 500, institution_name: 'Bank',
  },
  {
    id: 'c', user_id: 'u', name: 'Card', type: 'credit',
    current_balance: 200, institution_name: 'Bank',
  },
]

function snap(partial: Partial<AccountBalanceSnapshot>): AccountBalanceSnapshot {
  return {
    id: 's', user_id: 'u', account_id: 'a', as_of: '2026-06-30',
    balance: 100, source: 'observed', ...partial,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedSave.mockResolvedValue({ success: true })
})

describe('BalanceHistoryView', () => {
  it('shows an estimate as a placeholder, never as a value', () => {
    // The load-bearing rule: a reconstructed number the user never looked at
    // must not be submittable as a balance they attested to.
    render(
      <BalanceHistoryView
        accounts={accounts}
        snapshots={[snap({ as_of: '2026-06-30', balance: 900, source: 'reconstructed' })]}
        dates={dates}
      />,
    )
    const field = screen.getByLabelText(/Balance on Jun 30, 2026/) as HTMLInputElement
    expect(field.value).toBe('')
    expect(field.placeholder).toContain('estimated')
    expect(screen.getByText('Estimated')).toBeTruthy()
  })

  it('submits nothing until a field is touched', () => {
    render(<BalanceHistoryView accounts={accounts} snapshots={[]} dates={dates} />)
    const save = screen.getByRole('button', { name: /Save balances/ }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.click(save)
    expect(mockedSave).not.toHaveBeenCalled()
  })

  it('sends only the touched cells', async () => {
    render(
      <BalanceHistoryView
        accounts={accounts}
        snapshots={[snap({ as_of: '2026-06-30', balance: 900, source: 'reconstructed' })]}
        dates={dates}
      />,
    )
    fireEvent.change(screen.getByLabelText(/Balance on Jul 31, 2026/), {
      target: { value: '1234.5' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Save balances/ }))

    await waitFor(() =>
      expect(mockedSave).toHaveBeenCalledWith('a', [
        { as_of: '2026-07-31', balance: 1234.5 },
      ]),
    )
  })

  it('sends null for a cleared recorded balance', async () => {
    render(
      <BalanceHistoryView
        accounts={accounts}
        snapshots={[snap({ as_of: '2026-06-30', balance: 900, source: 'manual' })]}
        dates={dates}
      />,
    )
    const field = screen.getByLabelText(/Balance on Jun 30, 2026/) as HTMLInputElement
    expect(field.value).toBe('900')
    fireEvent.change(field, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /Save balances/ }))

    await waitFor(() =>
      expect(mockedSave).toHaveBeenCalledWith('a', [
        { as_of: '2026-06-30', balance: null },
      ]),
    )
  })

  it('renders an observed capture read-only', () => {
    render(
      <BalanceHistoryView
        accounts={accounts}
        snapshots={[snap({ as_of: '2026-06-30', balance: 900, source: 'observed' })]}
        dates={dates}
      />,
    )
    expect(screen.queryByLabelText(/Balance on Jun 30, 2026/)).toBeNull()
    expect(screen.getByText('Captured')).toBeTruthy()
  })

  it('asks a credit account for the amount owed, not a signed balance', () => {
    // Typing -1500 for a card owing $1,500 would move net worth $3,000 the
    // wrong way, so the form has to name the convention.
    render(<BalanceHistoryView accounts={accounts} snapshots={[]} dates={dates} />)
    fireEvent.click(screen.getByRole('button', { name: 'Card' }))
    expect(screen.getByText(/amount owed as a positive number/)).toBeTruthy()
    expect(screen.getByLabelText(/Amount owed on Jul 31, 2026/)).toBeTruthy()
  })

  it('rejects a non-numeric entry before calling the action', () => {
    render(<BalanceHistoryView accounts={accounts} snapshots={[]} dates={dates} />)
    fireEvent.change(screen.getByLabelText(/Balance on Jul 31, 2026/), {
      target: { value: 'twelve' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Save balances/ }))
    expect(screen.getByText(/is not a number/)).toBeTruthy()
    expect(mockedSave).not.toHaveBeenCalled()
  })

  it('drops drafts when another account is selected', () => {
    render(<BalanceHistoryView accounts={accounts} snapshots={[]} dates={dates} />)
    fireEvent.change(screen.getByLabelText(/Balance on Jul 31, 2026/), {
      target: { value: '10' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Card' }))
    const field = screen.getByLabelText(/Amount owed on Jul 31, 2026/) as HTMLInputElement
    expect(field.value).toBe('')
  })
})
