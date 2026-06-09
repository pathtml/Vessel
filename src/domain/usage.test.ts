import { describe, expect, it } from 'vitest'
import { createProvider, createUsagePeriod, PROVIDER_OPTIONS } from '../data/seed'
import { calculateNextResetAt, formatResetDisplay } from './reset'
import {
  addUsageToPeriod,
  applyDueResets,
  calculateRemainingPercentage,
  getTrayDisplayState,
  resetCurrentPeriod,
} from './usage'
import type { AppState, UsagePeriod } from './types'

const timezone = 'UTC'

function appState(periods: UsagePeriod[]): AppState {
  const provider = createProvider({
    kind: 'chatgpt_codex',
    displayName: 'ChatGPT Codex',
    sourceType: 'manual',
    periods,
    selectedDisplayPeriodId: periods[0]?.id,
  })

  return {
    providers: [provider],
    usageRecords: [],
    notificationRules: [],
    credentials: [],
    settings: {
      openAtLogin: false,
      openDashboardOnStartup: false,
      startMinimizedToTray: true,
      notificationsEnabled: true,
      privacyNoteAccepted: false,
      defaultTimezone: timezone,
    },
  }
}

describe('calculateRemainingPercentage', () => {
  it('returns undefined when the limit is missing', () => {
    expect(calculateRemainingPercentage(undefined, 20)).toBeUndefined()
  })

  it('treats missing used as zero after setup', () => {
    expect(calculateRemainingPercentage(100, undefined)).toEqual({
      remaining: 100,
      percentageRemaining: 100,
    })
  })

  it('clamps remaining and percentage to zero', () => {
    expect(calculateRemainingPercentage(100, 140)).toEqual({
      remaining: 0,
      percentageRemaining: 0,
    })
  })

  it('clamps percentage to 100', () => {
    expect(calculateRemainingPercentage(100, -20)).toEqual({
      remaining: 100,
      percentageRemaining: 100,
    })
  })
})

describe('formatResetDisplay', () => {
  const now = new Date('2026-06-09T10:00:00.000Z')
  const fiveHourReset = '2026-06-09T12:14:00.000Z'
  const weeklyReset = '2026-06-15T00:00:00.000Z'

  it('formats the 5h default as exact time', () => {
    expect(formatResetDisplay({
      nextResetAt: fiveHourReset,
      format: 'time_only',
      timezone,
      use24HourTime: true,
    }, now)).toBe('Reset at 12:14')
  })

  it('formats the weekly default as weekday and date', () => {
    expect(formatResetDisplay({
      nextResetAt: weeklyReset,
      format: 'weekday_date',
      timezone,
      use24HourTime: true,
    }, now)).toBe('Reset on Monday, Jun 15')
  })

  it('formats relative countdowns for 5h windows', () => {
    expect(formatResetDisplay({
      nextResetAt: fiveHourReset,
      format: 'relative_countdown',
      timezone,
      use24HourTime: true,
    }, now)).toBe('Reset in 2h 14m')
  })

  it('formats relative countdowns for weekly windows as days', () => {
    expect(formatResetDisplay({
      nextResetAt: weeklyReset,
      format: 'relative_countdown',
      timezone,
      use24HourTime: true,
    }, now)).toBe('Reset in 5 days')
  })

  it('supports date only, date time, missing, past, 12h time, and timezone formatting', () => {
    expect(formatResetDisplay({
      nextResetAt: weeklyReset,
      format: 'date_only',
      timezone,
      use24HourTime: true,
    }, now)).toBe('Reset on Jun 15, 2026')

    expect(formatResetDisplay({
      nextResetAt: weeklyReset,
      format: 'date_time',
      timezone,
      use24HourTime: false,
    }, now)).toContain('12:00 AM')

    expect(formatResetDisplay({
      format: 'time_only',
      timezone,
      use24HourTime: true,
    }, now)).toBe('Reset time not set')

    expect(formatResetDisplay({
      nextResetAt: '2026-06-09T09:59:00.000Z',
      format: 'time_only',
      timezone,
      use24HourTime: true,
    }, now)).toBe('Reset due now')

    expect(formatResetDisplay({
      nextResetAt: fiveHourReset,
      format: 'time_only',
      timezone: 'Asia/Bangkok',
      use24HourTime: false,
    }, now)).toBe('Reset at 7:14 PM')
  })
})

describe('reset behavior', () => {
  it('resets only the due 5h period', () => {
    const fiveHour = createUsagePeriod({ label: '5h', limit: 100, used: 80, timezone })
    const weekly = createUsagePeriod({ label: 'weekly', limit: 100, used: 25, timezone })
    const state = appState([
      { ...fiveHour, nextResetAt: '2026-06-09T09:00:00.000Z' },
      { ...weekly, nextResetAt: '2026-06-15T00:00:00.000Z' },
    ])

    const next = applyDueResets(state, new Date('2026-06-09T10:00:00.000Z'))
    expect(next.providers[0].supportedPeriods[0].used).toBe(0)
    expect(next.providers[0].supportedPeriods[1].used).toBe(25)
  })

  it('resets only the due weekly period', () => {
    const fiveHour = createUsagePeriod({ label: '5h', limit: 100, used: 80, timezone })
    const weekly = createUsagePeriod({ label: 'weekly', limit: 100, used: 25, timezone })
    const state = appState([
      { ...fiveHour, nextResetAt: '2026-06-09T15:00:00.000Z' },
      { ...weekly, nextResetAt: '2026-06-09T09:00:00.000Z' },
    ])

    const next = applyDueResets(state, new Date('2026-06-09T10:00:00.000Z'))
    expect(next.providers[0].supportedPeriods[0].used).toBe(80)
    expect(next.providers[0].supportedPeriods[1].used).toBe(0)
  })

  it('recalculates the next reset after a manual reset', () => {
    const period = createUsagePeriod({ label: '5h', limit: 100, used: 80, timezone })
    const state = appState([{ ...period, nextResetAt: '2026-06-09T12:00:00.000Z' }])

    const next = resetCurrentPeriod(state, new Date('2026-06-09T10:00:00.000Z'))
    expect(next.providers[0].supportedPeriods[0].used).toBe(0)
    expect(next.providers[0].supportedPeriods[0].nextResetAt).toBe(calculateNextResetAt(period.resetRoutine, new Date('2026-06-09T10:00:00.000Z')))
  })
})

describe('tray behavior', () => {
  it('uses neutral state when no provider exists', () => {
    expect(getTrayDisplayState([]).status).toBe('neutral')
  })

  it('uses neutral state when no limit exists', () => {
    const state = appState([createUsagePeriod({ label: '5h', timezone })])
    expect(getTrayDisplayState(state.providers).status).toBe('neutral')
  })

  it('uses the active provider selected 5h percentage', () => {
    const state = appState([createUsagePeriod({ label: '5h', limit: 100, used: 15, timezone })])
    expect(getTrayDisplayState(state.providers).percentage).toBe(85)
  })

  it('updates tray state when usage and display period change', () => {
    const fiveHour = createUsagePeriod({ label: '5h', limit: 100, used: 15, timezone })
    const weekly = createUsagePeriod({ label: 'weekly', limit: 100, used: 58, timezone })
    const state = appState([fiveHour, weekly])
    state.providers[0].selectedDisplayPeriodId = weekly.id
    expect(getTrayDisplayState(state.providers).percentage).toBe(42)

    const next = addUsageToPeriod(state, state.providers[0].id, weekly.id, 20)
    expect(getTrayDisplayState(next.providers).percentage).toBe(22)
  })

  it('tooltip respects selected fields and periods', () => {
    const fiveHour = createUsagePeriod({ label: '5h', limit: 100, used: 15, timezone })
    const weekly = createUsagePeriod({ label: 'weekly', limit: 100, used: 36, timezone })
    const state = appState([fiveHour, weekly])
    state.providers[0].tooltipPeriodIds = [weekly.id]
    const tooltip = getTrayDisplayState(state.providers).tooltip
    expect(tooltip).toContain('Weekly')
    expect(tooltip).toContain('64% remaining')
    expect(tooltip).not.toContain('85% remaining')
  })
})

describe('provider source defaults', () => {
  it('uses local sync for providers with supported local status sources', () => {
    const localKinds = ['chatgpt_codex', 'claude', 'gemini']
    expect(PROVIDER_OPTIONS.find((provider) => provider.kind === 'chatgpt_codex')?.sourceType).toBe('local')
    expect(PROVIDER_OPTIONS.find((provider) => provider.kind === 'claude')?.sourceType).toBe('local')
    expect(PROVIDER_OPTIONS.find((provider) => provider.kind === 'gemini')?.sourceType).toBe('local')
    expect(PROVIDER_OPTIONS.filter((provider) => !localKinds.includes(provider.kind)).every((provider) => provider.sourceType === 'manual')).toBe(true)
  })

  it('does not label API provider setup as official by default', () => {
    const openAiApi = PROVIDER_OPTIONS.find((provider) => provider.kind === 'openai_api')
    const provider = createProvider({
      kind: 'openai_api',
      displayName: openAiApi?.label ?? 'OpenAI API',
      sourceType: openAiApi?.sourceType,
      periods: [
        createUsagePeriod({
          label: '5h',
          sourceType: openAiApi?.sourceType,
          limit: 100,
          used: 25,
          timezone,
        }),
      ],
    })

    expect(provider.sourceType).toBe('manual')
    expect(provider.supportedPeriods[0].sourceType).toBe('manual')
    expect(openAiApi?.setupNote).toContain('manual setup')
  })

  it('labels Codex setup as local by default', () => {
    const codex = PROVIDER_OPTIONS.find((provider) => provider.kind === 'chatgpt_codex')
    const provider = createProvider({
      kind: 'chatgpt_codex',
      displayName: codex?.label ?? 'ChatGPT Codex',
      sourceType: codex?.sourceType,
      periods: [
        createUsagePeriod({
          label: '5h',
          sourceType: codex?.sourceType,
          limit: 100,
          used: 67,
          timezone,
        }),
      ],
    })

    expect(provider.sourceType).toBe('local')
    expect(provider.supportedPeriods[0].sourceType).toBe('local')
    expect(codex?.setupNote).toContain('local Codex CLI login')
  })

  it('labels Claude and Gemini setup as local when their local exports are configured', () => {
    const claude = PROVIDER_OPTIONS.find((provider) => provider.kind === 'claude')
    const gemini = PROVIDER_OPTIONS.find((provider) => provider.kind === 'gemini')

    expect(claude?.sourceType).toBe('local')
    expect(claude?.setupNote).toContain('status-line')
    expect(gemini?.sourceType).toBe('local')
    expect(gemini?.setupNote).toContain('Gemini CLI')
  })
})
