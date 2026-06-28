/** Compact relative time for sync timestamps. `iso` null = never synced. */
export function formatRelativeTime(iso: string | null, now: Date): string {
  if (!iso) return 'Never synced'
  const diffMs = now.getTime() - new Date(iso).getTime()
  const sec = Math.floor(diffMs / 1000)
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  return `${day}d ago`
}
