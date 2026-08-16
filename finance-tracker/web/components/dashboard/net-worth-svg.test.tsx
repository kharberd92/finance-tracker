import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NetWorthSvg } from './net-worth-svg'
import type { NetWorthPoint } from '@/lib/finance/net-worth-history'

function point(partial: Partial<NetWorthPoint>): NetWorthPoint {
  return { as_of: '2026-08-16', net_worth: 1000, source: 'observed', complete: true, ...partial }
}

describe('NetWorthSvg', () => {
  it('explains itself instead of drawing bare axes when there is one point', () => {
    // The state right after applying the migration and running a first sync:
    // one comparable snapshot, nothing to join a line to.
    render(<NetWorthSvg points={[point({ as_of: '2026-08-16' })]} />)

    expect(screen.getByText(/not enough history to chart yet/i)).toBeInTheDocument()
    expect(screen.getByText(/2026-08-16/)).toBeInTheDocument()
    expect(document.querySelector('polyline')).toBeNull()
  })

  it('explains itself when there are no points at all', () => {
    render(<NetWorthSvg points={[]} />)

    expect(screen.getByText(/not enough history to chart yet/i)).toBeInTheDocument()
    expect(screen.getByText(/one snapshot per day/i)).toBeInTheDocument()
    expect(document.querySelector('polyline')).toBeNull()
  })

  it('draws the chart once two points exist', () => {
    render(
      <NetWorthSvg
        points={[
          point({ as_of: '2026-08-15', net_worth: 900 }),
          point({ as_of: '2026-08-16', net_worth: 1000 }),
        ]}
      />,
    )

    expect(screen.queryByText(/not enough history/i)).toBeNull()
    expect(document.querySelectorAll('polyline').length).toBeGreaterThan(0)
  })

  it('marks a reconstructed run dashed and says so', () => {
    render(
      <NetWorthSvg
        points={[
          point({ as_of: '2026-07-31', net_worth: 800, source: 'reconstructed' }),
          point({ as_of: '2026-08-15', net_worth: 900 }),
          point({ as_of: '2026-08-16', net_worth: 1000 }),
        ]}
      />,
    )

    const dashed = [...document.querySelectorAll('polyline')].filter((p) =>
      p.getAttribute('stroke-dasharray'),
    )
    expect(dashed.length).toBe(1)
    expect(screen.getByText(/estimated from transaction history/i)).toBeInTheDocument()
  })

  it('omits the estimated-data note when every point is observed', () => {
    render(
      <NetWorthSvg
        points={[
          point({ as_of: '2026-08-15', net_worth: 900 }),
          point({ as_of: '2026-08-16', net_worth: 1000 }),
        ]}
      />,
    )

    expect(screen.queryByText(/estimated from transaction history/i)).toBeNull()
  })
})
