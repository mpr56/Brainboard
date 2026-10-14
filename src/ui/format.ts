const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

/** "just now", "5 min ago", "2h ago", "yesterday", "3 days ago", then a date. */
export function timeAgo(t: number, now = Date.now()): string {
  const d = Math.max(0, now - t)
  if (d < MIN) return 'just now'
  if (d < HOUR) return `${Math.floor(d / MIN)} min ago`
  if (d < DAY) return `${Math.floor(d / HOUR)}h ago`
  if (d < 2 * DAY) return 'yesterday'
  if (d < 7 * DAY) return `${Math.floor(d / DAY)} days ago`
  const date = new Date(t)
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

/** Binary units, one decimal under 10 and none above: "1.5 KB", "300 MB", "20 GB". */
export function formatBytes(n: number): string {
  let i = 0
  while (n >= 1024 && i < UNITS.length - 1) {
    n /= 1024
    i++
  }
  const shown = i === 0 || n >= 10 ? Math.round(n) : Math.round(n * 10) / 10
  return `${shown} ${UNITS[i]}`
}
