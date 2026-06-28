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
})
