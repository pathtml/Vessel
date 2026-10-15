import { describe, expect, it } from 'vitest'
import { formatAgo, formatReset, healthInfo, lastUpdated, toneFor } from './format'
import type { UsageSnapshot } from '../types'

const NOW = 1_000_000_000_000

describe('formatReset', () => {
  it('formats hours and minutes', () => {
    expect(formatReset(NOW / 1000 + 2 * 3600 + 10 * 60, NOW)).toBe('2h 10m')
  })
  it('formats minutes only', () => {
    expect(formatReset(NOW / 1000 + 45 * 60, NOW)).toBe('45m')
  })
  it('formats days', () => {
    expect(formatReset(NOW / 1000 + 3 * 86400 + 5 * 3600, NOW)).toBe('3d 5h')
  })
  it('never goes negative', () => {
    expect(formatReset(NOW / 1000 - 500, NOW)).toBe('<1m')
  })
  it('is empty without a reset time', () => {
    expect(formatReset(null, NOW)).toBe('')
  })
})

describe('formatAgo', () => {
  it('reads naturally', () => {
    expect(formatAgo(NOW / 1000 - 10, NOW)).toBe('just now')
    expect(formatAgo(NOW / 1000 - 60, NOW)).toBe('1 min ago')
    expect(formatAgo(NOW / 1000 - 5 * 60, NOW)).toBe('5 min ago')
    expect(formatAgo(NOW / 1000 - 2 * 3600, NOW)).toBe('2 h ago')
  })
})

describe('toneFor', () => {
  it('matches the tray thresholds', () => {
    expect(toneFor(41)).toBe('green')
    expect(toneFor(40)).toBe('amber')
    expect(toneFor(15)).toBe('amber')
    expect(toneFor(14)).toBe('red')
  })
})

describe('healthInfo', () => {
  it('has no badge when healthy', () => {
    expect(healthInfo('ok')).toBeNull()
  })
  it('explains problems in plain language', () => {
    expect(healthInfo('signInAgain')?.label).toBe('Sign in again')
  })
})

describe('lastUpdated', () => {
  const snap = (fetchedAt: number, withData: boolean): UsageSnapshot => ({
    provider: 'p',
    displayName: 'P',
    windows: withData ? [{ label: '5h', usedPct: 1, remainingPct: 99, resetsAt: null }] : [],
    fetchedAt,
    health: 'ok',
    message: null,
  })
  it('ignores providers without numbers', () => {
    expect(lastUpdated([snap(100, true), snap(50, false)])).toBe(100)
  })
  it('is null when nothing has data', () => {
    expect(lastUpdated([snap(1, false)])).toBeNull()
  })
})

import { healthAction } from './format'

describe('healthAction', () => {
  it('offers exactly one fix per problem', () => {
    expect(healthAction('notConnected')).toBe('connect')
    expect(healthAction('offline')).toBe('retry')
    expect(healthAction('sourceChanged')).toBe('retry')
    expect(healthAction('signInAgain')).toBe('signInHelp')
  })
  it('offers nothing when healthy, waiting or not supported', () => {
    expect(healthAction('ok')).toBeNull()
    expect(healthAction('waitingForFirstUse')).toBeNull()
    expect(healthAction('comingSoon')).toBeNull()
  })
})
