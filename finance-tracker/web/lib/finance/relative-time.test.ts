import { describe, it, expect } from 'vitest'
import { formatRelativeTime } from './relative-time'

const now = new Date('2026-06-28T12:00:00Z')

describe('formatRelativeTime', () => {
  it('returns "Never synced" for null', () => {
    expect(formatRelativeTime(null, now)).toBe('Never synced')
  })
  it('returns "just now" under a minute', () => {
    expect(formatRelativeTime('2026-06-28T11:59:30Z', now)).toBe('just now')
  })
  it('formats minutes', () => {
    expect(formatRelativeTime('2026-06-28T11:45:00Z', now)).toBe('15m ago')
  })
  it('formats hours', () => {
    expect(formatRelativeTime('2026-06-28T09:00:00Z', now)).toBe('3h ago')
  })
  it('formats days', () => {
    expect(formatRelativeTime('2026-06-26T12:00:00Z', now)).toBe('2d ago')
  })

  // Boundary cases — pin the strict-less-than operators (sec<60, min<60, hr<24).
  it('crosses the minute boundary at exactly 60s', () => {
    expect(formatRelativeTime('2026-06-28T11:59:01Z', now)).toBe('just now') // 59s
    expect(formatRelativeTime('2026-06-28T11:59:00Z', now)).toBe('1m ago') // 60s
  })
  it('crosses the hour boundary at exactly 60m', () => {
    expect(formatRelativeTime('2026-06-28T11:01:00Z', now)).toBe('59m ago')
    expect(formatRelativeTime('2026-06-28T11:00:00Z', now)).toBe('1h ago')
  })
  it('crosses the day boundary at exactly 24h', () => {
    expect(formatRelativeTime('2026-06-27T13:00:00Z', now)).toBe('23h ago')
    expect(formatRelativeTime('2026-06-27T12:00:00Z', now)).toBe('1d ago')
  })
})
