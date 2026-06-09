import type { AiProvider, AppState, ProviderStatus, UsagePeriod, UsageSourceType } from './types'
import { advancePeriodReset, calculateNextResetAt, formatResetDisplay } from './reset'

export function calculateRemainingPercentage(limit?: number, used?: number) {
  if (!limit || limit <= 0) {
    return undefined
  }

  const safeUsed = Math.max(0, used ?? 0)
  const remaining = Math.max(limit - safeUsed, 0)
  const percentageRemaining = Math.max(0, Math.min(100, Math.round((remaining / limit) * 100)))

  return {
    remaining,
    percentageRemaining,
  }
}

export function normalizeUsagePeriod(period: UsagePeriod): UsagePeriod {
  const calculated = calculateRemainingPercentage(period.limit, period.used)
  return {
    ...period,
    remaining: calculated?.remaining,
    percentageRemaining: calculated?.percentageRemaining,
  }
}

export function getStatusForPercentage(percentage?: number): ProviderStatus {
  if (percentage === undefined) return 'neutral'
  if (percentage < 20) return 'red'
  if (percentage <= 60) return 'yellow'
  return 'green'
}

export function getActiveProvider(providers: AiProvider[]) {
  return providers.find((provider) => provider.enabled && provider.active) ?? providers.find((provider) => provider.enabled)
}

export function getDisplayPeriod(provider?: AiProvider) {
  if (!provider) return undefined
  return provider.supportedPeriods.find((period) => period.id === provider.selectedDisplayPeriodId)
}

export function getSourceBadgeMeta(sourceType: UsageSourceType) {
  switch (sourceType) {
    case 'official':
      return {
        label: 'Official',
        description: 'Usage comes from a documented official API.',
      }
    case 'local':
      return {
        label: 'Local',
        description: 'Usage comes from a supported local provider session.',
      }
    case 'manual':
      return {
        label: 'Manual',
        description: 'User manually sets limit and used amount.',
      }
    case 'estimated':
      return {
        label: 'Estimated',
        description: 'Usage is estimated only from activity this app can see.',
      }
    case 'unsupported':
      return {
        label: 'Unsupported',
        description: 'Official usage is unavailable and tracking is not configured.',
      }
  }
}

export function formatAmount(value?: number) {
  if (value === undefined) return 'Not configured'
  return Math.round(value).toLocaleString()
}

export function formatProviderLastUpdated(provider: AiProvider) {
  if (!provider.lastUpdatedAt) return 'Never'
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(new Date(provider.lastUpdatedAt))
    .replace(',', '')
}

export function buildTrayTooltip(provider?: AiProvider) {
  if (!provider) {
    return 'Ai Usage Dock\n\nNo provider configured.\nOpen dashboard to set up tracking.'
  }

  const displayPeriod = normalizeUsagePeriod(getDisplayPeriod(provider) ?? provider.supportedPeriods[0])
  if (!displayPeriod) {
    return `Ai Usage Dock\n\n${provider.displayName}\nSetup required.\nChoose provider and limits to start tracking.`
  }

  if (!displayPeriod.limit) {
    return `Ai Usage Dock\n\nNo limit configured for ${provider.displayName} ${displayPeriod.label} period.`
  }

  const lines = ['Ai Usage Dock', '', provider.displayName]
  const tooltipPeriods = provider.tooltipPeriodIds.length
    ? provider.tooltipPeriodIds
    : [provider.selectedDisplayPeriodId]

  for (const periodId of tooltipPeriods) {
    const period = normalizeUsagePeriod(
      provider.supportedPeriods.find((item) => item.id === periodId) ?? displayPeriod,
    )
    const settings = provider.tooltipSettings
    lines.push(formatPeriodLine(period, settings.showPercentage, settings.showRemaining))
    if (settings.showNextReset) {
      lines.push(formatResetDisplay({
        nextResetAt: period.nextResetAt,
        format: period.resetDisplaySettings.format,
        timezone: period.resetDisplaySettings.timezone,
        use24HourTime: period.resetDisplaySettings.use24HourTime,
        customFormat: period.resetDisplaySettings.customFormat,
      }))
    }
    lines.push('')
  }

  if (provider.tooltipSettings.showSourceType) {
    lines.push(`Source: ${getSourceBadgeMeta(displayPeriod.sourceType).label}`)
  }
  if (provider.tooltipSettings.showLastUpdated) {
    lines.push(`Last updated: ${formatProviderLastUpdated(provider)}`)
  }

  return lines.join('\n').trimEnd()
}

export function getTrayDisplayState(providers: AiProvider[]) {
  const activeProvider = getActiveProvider(providers)
  const activePeriod = activeProvider ? normalizeUsagePeriod(getDisplayPeriod(activeProvider) ?? activeProvider.supportedPeriods[0]) : undefined
  const percentage = activePeriod?.limit ? activePeriod.percentageRemaining : undefined

  return {
    percentage,
    status: getStatusForPercentage(percentage),
    tooltip: buildTrayTooltip(activeProvider),
    activeProvider,
    activePeriod,
  }
}

export function applyDueResets(state: AppState, now = new Date()): AppState {
  let changed = false
  const providers = state.providers.map((provider) => {
    const periods = provider.supportedPeriods.map((period) => {
      const resetPeriod = advancePeriodReset(period, now)
      if (resetPeriod !== period) changed = true
      return normalizeUsagePeriod(resetPeriod)
    })
    return periods === provider.supportedPeriods ? provider : { ...provider, supportedPeriods: periods, lastUpdatedAt: now.toISOString() }
  })

  return changed ? { ...state, providers } : state
}

export function resetCurrentPeriod(state: AppState, now = new Date()): AppState {
  const activeProvider = getActiveProvider(state.providers)
  if (!activeProvider) return state

  return {
    ...state,
    providers: state.providers.map((provider) => {
      if (provider.id !== activeProvider.id) return provider
      return {
        ...provider,
        supportedPeriods: provider.supportedPeriods.map((period) => {
          if (period.id !== provider.selectedDisplayPeriodId) return period
          return normalizeUsagePeriod({
            ...period,
            used: 0,
            nextResetAt: calculateNextResetAt(period.resetRoutine, now),
          })
        }),
        lastUpdatedAt: now.toISOString(),
      }
    }),
  }
}

export function addUsageToPeriod(state: AppState, providerId: string, periodId: string, amountUsed: number, note?: string) {
  const now = new Date().toISOString()

  return {
    ...state,
    providers: state.providers.map((provider) => {
      if (provider.id !== providerId) return provider
      return {
        ...provider,
        supportedPeriods: provider.supportedPeriods.map((period) => {
          if (period.id !== periodId) return period
          return normalizeUsagePeriod({
            ...period,
            used: Math.max(0, (period.used ?? 0) + amountUsed),
            setupConfirmed: true,
          })
        }),
        lastUpdatedAt: now,
      }
    }),
    usageRecords: [
      ...state.usageRecords,
      {
        id: crypto.randomUUID(),
        providerId,
        periodId,
        amountUsed,
        note,
        occurredAt: now,
      },
    ],
  }
}

function formatPeriodLine(period: UsagePeriod, showPercentage: boolean, showRemaining: boolean) {
  const parts = [`${formatPeriodLabel(period.label)}:`]
  if (showPercentage) {
    parts.push(period.percentageRemaining === undefined ? 'setup required' : `${period.percentageRemaining}% remaining`)
  }
  if (showRemaining && period.remaining !== undefined && period.limit !== undefined) {
    parts.push(`(${formatAmount(period.remaining)} / ${formatAmount(period.limit)})`)
  }
  return parts.join(' ')
}

function formatPeriodLabel(label: UsagePeriod['label']) {
  if (label === '5h') return '5h'
  return label.charAt(0).toUpperCase() + label.slice(1)
}
