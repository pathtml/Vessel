import type { Health, UsageSnapshot } from '../types'

/** "2h 10m", "45m", "<1m". Empty when there is no reset time. */
export function formatReset(resetsAt: number | null, nowMs: number): string {
  if (resetsAt === null) return ''
  const totalMins = Math.max(0, Math.round((resetsAt * 1000 - nowMs) / 60000))
  if (totalMins < 1) return '<1m'
  const days = Math.floor(totalMins / 1440)
  const hours = Math.floor((totalMins % 1440) / 60)
  const mins = totalMins % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

export function formatAgo(fetchedAt: number, nowMs: number): string {
  const mins = Math.floor((nowMs - fetchedAt * 1000) / 60000)
  if (mins < 1) return 'just now'
  if (mins === 1) return '1 min ago'
  if (mins < 60) return `${mins} min ago`
  return `${Math.floor(mins / 60)} h ago`
}

export type Tone = 'green' | 'amber' | 'red'

/** Same thresholds as the tray icon: above 40 green, 15-40 amber, below 15 red. */
export function toneFor(remainingPct: number): Tone {
  if (remainingPct > 40) return 'green'
  if (remainingPct >= 15) return 'amber'
  return 'red'
}

export function windowTitle(label: string): string {
  switch (label) {
    case '5h':
      return '5-hour limit'
    case 'weekly':
      return 'Weekly limit'
    case 'daily':
      return 'Daily limit'
    default:
      return label
  }
}

export interface HealthInfo {
  label: string
  /** Plain-language line shown under the badge. */
  hint: string
  tone: 'neutral' | 'warning' | 'error' | 'info'
}

export function healthInfo(health: Health): HealthInfo | null {
  switch (health) {
    case 'ok':
      return null
    case 'signInAgain':
      return { label: 'Sign in again', hint: 'Open the app and sign in, then refresh.', tone: 'warning' }
    case 'offline':
      return { label: 'Offline', hint: 'Showing the last known numbers.', tone: 'neutral' }
    case 'sourceChanged':
      return { label: 'Source changed', hint: 'The provider changed how it reports usage.', tone: 'error' }
    case 'waitingForFirstUse':
      return { label: 'Waiting for first use', hint: 'Use the tool once and Vessel will pick it up.', tone: 'info' }
    case 'notConnected':
      return { label: 'Not connected', hint: 'Connect this provider to see its limits.', tone: 'neutral' }
    case 'comingSoon':
      return { label: 'Coming soon', hint: 'Vessel cannot read this one automatically yet.', tone: 'neutral' }
  }
}

/** Oldest fetch time across providers that actually have numbers. */
export function lastUpdated(snapshots: UsageSnapshot[]): number | null {
  const times = snapshots.filter((s) => s.windows.length > 0).map((s) => s.fetchedAt)
  return times.length ? Math.min(...times) : null
}

/** The one button a provider row offers for its current health. */
export type HealthAction = 'connect' | 'retry' | 'signInHelp' | null

export function healthAction(health: Health): HealthAction {
  switch (health) {
    case 'notConnected':
      return 'connect'
    case 'offline':
    case 'sourceChanged':
      return 'retry'
    case 'signInAgain':
      return 'signInHelp'
    default:
      return null
  }
}

export function signInSteps(provider: string): string {
  switch (provider) {
    case 'codex':
      return 'Open a terminal, run "codex login", sign in, then press Refresh.'
    case 'claude':
      return 'Open Claude Code, sign in, use it once, then press Refresh.'
    default:
      return 'Sign in to the tool, then press Refresh.'
  }
}
