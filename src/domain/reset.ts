import type { ResetFrequency, ResetRule, UsageLimit } from './types'

const DEFAULT_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

export function getDefaultTimezone() {
  return DEFAULT_TIMEZONE
}

export function formatCountdown(targetIso: string, now = new Date()) {
  const target = new Date(targetIso)
  const diffMs = Math.max(0, target.getTime() - now.getTime())
  const totalMinutes = Math.floor(diffMs / 60000)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

export function createResetRule(
  frequency: ResetFrequency,
  timezone = DEFAULT_TIMEZONE,
  options?: {
    customHours?: number
    weeklyResetDay?: 0 | 1 | 2 | 3 | 4 | 5 | 6
    monthlyResetDay?: number
  },
  now = new Date(),
): ResetRule {
  const lastResetAt = now.toISOString()
  const baseRule: ResetRule = {
    frequency,
    timezone,
    lastResetAt,
    nextResetAt: '',
    customHours: options?.customHours,
    weeklyResetDay: options?.weeklyResetDay,
    monthlyResetDay: options?.monthlyResetDay,
  }

  return {
    ...baseRule,
    nextResetAt: getNextResetAt(baseRule, now).toISOString(),
  }
}

export function normalizeLimitReset(limit: UsageLimit, now = new Date()): UsageLimit {
  let nextReset = new Date(limit.resetRule.nextResetAt)
  if (Number.isNaN(nextReset.getTime()) || nextReset <= new Date(limit.resetRule.lastResetAt)) {
    nextReset = getNextResetAt(limit.resetRule, now)
  }

  if (now < nextReset) {
    return {
      ...limit,
      resetRule: {
        ...limit.resetRule,
        nextResetAt: nextReset.toISOString(),
      },
    }
  }

  let lastReset = nextReset
  let safety = 0
  while (lastReset <= now && safety < 400) {
    nextReset = getNextResetAt({ ...limit.resetRule, lastResetAt: lastReset.toISOString() }, lastReset)
    if (nextReset <= lastReset) {
      nextReset = new Date(lastReset.getTime() + 60 * 60 * 1000)
    }
    if (nextReset <= now) {
      lastReset = nextReset
    }
    safety += 1
  }

  return {
    ...limit,
    usedQuota: 0,
    resetRule: {
      ...limit.resetRule,
      lastResetAt: lastReset.toISOString(),
      nextResetAt: nextReset.toISOString(),
    },
  }
}

export function getNextResetAt(rule: ResetRule, from = new Date()) {
  if (rule.frequency === 'customHours') {
    const hours = Math.max(1, rule.customHours ?? 24)
    return new Date(new Date(rule.lastResetAt || from).getTime() + hours * 60 * 60 * 1000)
  }

  const parts = getZonedParts(from, rule.timezone)
  if (rule.frequency === 'daily') {
    const today = zonedDate(parts.year, parts.month, parts.day, 0, 0, rule.timezone)
    const candidate = today > from ? today : zonedDate(parts.year, parts.month, parts.day + 1, 0, 0, rule.timezone)
    return candidate
  }

  if (rule.frequency === 'weekly') {
    const targetDay = rule.weeklyResetDay ?? 1
    const daysUntil = (targetDay - parts.weekday + 7) % 7
    const candidateDay = daysUntil === 0 ? parts.day + 7 : parts.day + daysUntil
    return zonedDate(parts.year, parts.month, candidateDay, 0, 0, rule.timezone)
  }

  const day = Math.max(1, Math.min(28, rule.monthlyResetDay ?? 1))
  const thisMonth = zonedDate(parts.year, parts.month, day, 0, 0, rule.timezone)
  if (thisMonth > from) return thisMonth
  return zonedDate(parts.year, parts.month + 1, day, 0, 0, rule.timezone)
}

function getZonedParts(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    weekday: 'short',
    hour12: false,
  })
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]))
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  }

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: weekdayMap[parts.weekday] ?? date.getDay(),
  }
}

function zonedDate(year: number, month: number, day: number, hour: number, minute: number, timezone: string) {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0))
  const offset = getTimeZoneOffsetMs(utcGuess, timezone)
  const firstPass = new Date(utcGuess.getTime() - offset)
  const correctedOffset = getTimeZoneOffsetMs(firstPass, timezone)
  return new Date(utcGuess.getTime() - correctedOffset)
}

function getTimeZoneOffsetMs(date: Date, timezone: string) {
  const parts = getZonedParts(date, timezone)
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  return asUtc - date.getTime()
}
