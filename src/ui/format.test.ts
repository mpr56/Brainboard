import { describe, expect, it } from 'vitest'
import { formatBytes, timeAgo } from './format'

const NOW = new Date(2026, 9, 14, 12, 0, 0).getTime()
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

describe('timeAgo', () => {
  it.each([
    [NOW - 10_000, 'just now'],
    [NOW - 5 * MIN, '5 min ago'],
    [NOW - 2 * HOUR, '2h ago'],
    [NOW - 1.2 * DAY, 'yesterday'],
    [NOW - 3 * DAY, '3 days ago'],
  ])('%s → %s', (t, out) => {
    expect(timeAgo(t, NOW)).toBe(out)
  })

  it('falls back to a date after a week', () => {
    expect(timeAgo(new Date(2026, 8, 2).getTime(), NOW)).toBe('2 Sept')
  })

  it('names the year when it is not this one', () => {
    expect(timeAgo(new Date(2025, 0, 5).getTime(), NOW)).toBe('5 Jan 2025')
  })

  it('treats a clock in the future as now', () => {
    expect(timeAgo(NOW + 5 * MIN, NOW)).toBe('just now')
  })
})

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [900, '900 B'],
    [1536, '1.5 KB'],
    [4.2 * 1024 ** 3, '4.2 GB'],
    [20 * 1024 ** 3, '20 GB'],
    [300 * 1024 ** 2, '300 MB'],
  ])('%s → %s', (n, out) => {
    expect(formatBytes(n)).toBe(out)
  })
})
