import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TrendPanel } from './trend-panel'
import type { NetWorthPoint, HiddenHistory } from '@/lib/finance/net-worth-history'
import type { CashflowMonth } from '@/lib/finance/cashflow'

const cashflow: CashflowMonth[] = [
  { month: '2026-07', income: 100, expense: 50, net: 50 },
  { month: '2026-08', income: 120, expense: 60, net: 60 },
]

const netWorth: NetWorthPoint[] = [
  { as_of: '2026-08-16', net_worth: 1000, source: 'observed', complete: true },
  { as_of: '2026-08-17', net_worth: 1100, source: 'observed', complete: true },
]

const hidden: HiddenHistory = { dates: 4, from: '2026-04-30', to: '2026-07-31' }

describe('TrendPanel', () => {
  it('keeps the withheld-history note out of the cashflow view', () => {
    render(<TrendPanel cashflow={cashflow} netWorth={netWorth} hidden={hidden} />)
    // Cashflow is the default view; the note describes the net worth series only.
    expect(screen.queryByText(/aren’t charted/)).toBeNull()
  })

  it('names the withheld dates in the net worth view', () => {
    render(<TrendPanel cashflow={cashflow} netWorth={netWorth} hidden={hidden} />)
    fireEvent.click(screen.getByRole('button', { name: 'Net worth' }))

    const note = screen.getByText(/aren’t charted/)
    expect(note.textContent).toContain('4 earlier dates')
    expect(note.textContent).toContain('Apr 30, 2026')
    expect(note.textContent).toContain('Jul 31, 2026')
  })

  it('says nothing when no history is withheld', () => {
    render(<TrendPanel cashflow={cashflow} netWorth={netWorth} hidden={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Net worth' }))

    expect(screen.queryByText(/aren’t charted/)).toBeNull()
  })
})
