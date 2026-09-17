import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ForecastSvg } from './forecast-svg'
import type { ForecastPoint } from '@/lib/finance/forecast'

const origin: ForecastPoint = { date: '2026-07-19', balance: 3000 }
const points: ForecastPoint[] = [
  { date: '2026-07-25', balance: 1200 },
  { date: '2026-08-01', balance: -150 },
  { date: '2026-08-14', balance: 2250 },
]

describe('ForecastSvg', () => {
  it('says the line is a projection and that variable spending is excluded', () => {
    // The load-bearing honesty rule: a projection must never read as a
    // measurement, and the low must not read as a floor.
    render(<ForecastSvg origin={origin} points={points} />)
    expect(screen.getByText(/every point after today is a projection/i)).toBeTruthy()
    expect(screen.getByText(/variable spending is\s+not included/i)).toBeTruthy()
  })

  it('draws the curve dashed', () => {
    const { container } = render(<ForecastSvg origin={origin} points={points} />)
    const line = container.querySelector('polyline')
    expect(line?.getAttribute('stroke-dasharray')).toBeTruthy()
  })

  it('names the low and its date in the accessible title', () => {
    render(<ForecastSvg origin={origin} points={points} />)
    expect(screen.getByTitle(/low of .*\$150.*on Aug 1, 2026/i)).toBeTruthy()
  })

  it('draws a zero line only when the curve goes negative', () => {
    const { container: neg } = render(<ForecastSvg origin={origin} points={points} />)
    expect(neg.querySelectorAll('line.stroke-expense').length).toBe(1)

    const positive = [{ date: '2026-08-01', balance: 900 }]
    const { container: pos } = render(<ForecastSvg origin={origin} points={positive} />)
    expect(pos.querySelectorAll('line.stroke-expense').length).toBe(0)
  })

  it('explains an empty window instead of drawing bare axes', () => {
    // Gridlines with no line is indistinguishable from a bug — the lesson
    // NetWorthSvg already learned.
    const { container } = render(<ForecastSvg origin={origin} points={[]} />)
    expect(container.querySelector('svg')).toBeNull()
    expect(screen.getByText(/nothing projected in this window/i)).toBeTruthy()
  })
})
