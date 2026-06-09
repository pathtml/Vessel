import type {
  ResetDisplayFormat,
  ResetDisplaySettings,
  ResetRoutine,
  UsagePeriod,
  UsagePeriodLabel,
} from './types'

const DEFAULT_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

export function getDefaultTimezone() {
  return DEFAULT_TIMEZONE
}

export function getDefaultResetDisplayFormat(label: UsagePeriodLabel): ResetDisplayFormat {
  if (label === '5h' || label === 'daily') return 'time_only'
  if (label === 'weekly') return 'weekday_date'
  if (label === 'monthly') return 'date_only'
  return 'date_time'
}

export function createResetDisplaySettings(
  periodId: string,
  label: UsagePeriodLabel,
  timezone = DEFAULT_TIMEZONE,
): ResetDisplaySettings {
  return {
    periodId,
    format: getDefaultResetDisplayFormat(label),
    use24HourTime: true,
    timezone,
  }
}

export function createResetRoutine(label: UsagePeriodLabel, timezone = DEFAULT_TIMEZONE): ResetRoutine {
  if (label === '5h') {
    return { type: 'rolling_5h', timezone, intervalHours: 5 }
  }
  if (label === 'daily') {
    return { type: 'fixed_daily', timezone, resetHour: 0, resetMinute: 0 }
  }
  if (label === 'weekly') {
    return { type: 'fixed_weekly', timezone, weeklyResetDay: 1, resetHour: 0, resetMinute: 0 }
  }
  if (label === 'monthly') {
    return { type: 'fixed_monthly', timezone, monthlyResetDay: 1, resetHour: 0, resetMinute: 0 }
  }
  return { type: 'custom_hours', timezone, intervalHours: 24 }
}

export function calculateNextResetAt(routine: ResetRoutine, from = new Date(), previousResetAt?: string) {
  if (routine.type === 'custom_datetime') {
    return routine.customResetAt
  }

  if (routine.type === 'rolling_5h' || routine.type === 'custom_hours') {
    const base = previousResetAt ? new Date(previousResetAt) : from
    const intervalHours = Math.max(1, routine.intervalHours ?? (routine.type === 'rolling_5h' ? 5 : 24))
    let next = new Date(base.getTime() + intervalHours * 60 * 60 * 1000)
    while (next <= from) {
      next = new Date(next.getTime() + intervalHours * 60 * 60 * 1000)
    }
    return next.toISOString()
  }

  const timezone = routine.timezone || DEFAULT_TIMEZONE
  const resetHour = clampNumber(routine.resetHour, 0, 23, 0)
  const resetMinute = clampNumber(routine.resetMinute, 0, 59, 0)
  const parts = getZonedParts(from, timezone)

  if (routine.type === 'fixed_daily') {
    const today = zonedDate(parts.year, parts.month, parts.day, resetHour, resetMinute, timezone)
    return (today > from
      ? today
      : zonedDate(parts.year, parts.month, parts.day + 1, resetHour, resetMinute, timezone)
    ).toISOString()
  }

  if (routine.type === 'fixed_weekly') {
    const targetDay = clampNumber(routine.weeklyResetDay, 0, 6, 1)
    const daysUntil = (targetDay - parts.weekday + 7) % 7
    let candidate = zonedDate(parts.year, parts.month, parts.day + daysUntil, resetHour, resetMinute, timezone)
    if (candidate <= from) {
      candidate = zonedDate(parts.year, parts.month, parts.day + daysUntil + 7, resetHour, resetMinute, timezone)
    }
    return candidate.toISOString()
  }

  const targetDay = clampNumber(routine.monthlyResetDay, 1, 28, 1)
  const thisMonth = zonedDate(parts.year, parts.month, targetDay, resetHour, resetMinute, timezone)
  if (thisMonth > from) return thisMonth.toISOString()
  return zonedDate(parts.year, parts.month + 1, targetDay, resetHour, resetMinute, timezone).toISOString()
}

export function shouldResetPeriod(period: UsagePeriod, now = new Date()) {
  if (!period.nextResetAt) return false
  const nextReset = new Date(period.nextResetAt)
  return !Number.isNaN(nextReset.getTime()) && now >= nextReset
}

export function advancePeriodReset(period: UsagePeriod, now = new Date()): UsagePeriod {
  if (!shouldResetPeriod(period, now)) return period

  let previousResetAt = period.nextResetAt
  let nextResetAt = calculateNextResetAt(period.resetRoutine, now, previousResetAt)
  let safety = 0

  while (nextResetAt && new Date(nextResetAt) <= now && safety < 400) {
    previousResetAt = nextResetAt
    nextResetAt = calculateNextResetAt(period.resetRoutine, now, previousResetAt)
    safety += 1
  }

  return {
    ...period,
    used: 0,
    remaining: period.limit,
    percentageRemaining: period.limit && period.limit > 0 ? 100 : undefined,
    nextResetAt,
  }
}

export function formatResetDisplay({
  nextResetAt,
  format,
  timezone,
  use24HourTime,
}: {
  nextResetAt?: string
  format: ResetDisplayFormat
  timezone: string
  use24HourTime: boolean
  customFormat?: string
}, now = new Date()) {
  if (!nextResetAt) return 'Reset time not set'

  const date = new Date(nextResetAt)
  if (Number.isNaN(date.getTime())) return 'Reset time not set'
  if (date <= now) return 'Reset due now'

  if (format === 'relative_countdown') {
    return `Reset in ${formatRelativeDuration(date, now)}`
  }

  const hour12 = !use24HourTime
  if (format === 'time_only') {
    return `Reset at ${new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12,
    }).format(date)}`
  }

  if (format === 'date_only') {
    return `Reset on ${new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(date)}`
  }

  if (format === 'weekday_date') {
    return `Reset on ${new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    }).format(date)}`
  }

  // TODO: Implement safe custom date formatting if the app adopts a vetted date library.
  return `Reset at ${new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12,
  }).format(date)}`
}

function formatRelativeDuration(target: Date, now: Date) {
  const diffMs = target.getTime() - now.getTime()
  const totalMinutes = Math.max(0, Math.floor(diffMs / 60000))
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60

  if (totalMinutes <= 0) return 'soon'
  if (days >= 5) return `${days} days`
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function clampNumber(value: number | undefined, min: number, max: number, fallback: number) {
  if (value === undefined || Number.isNaN(value)) return fallback
  return Math.max(min, Math.min(max, value))
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
