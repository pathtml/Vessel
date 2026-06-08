import type { AppState, LimitSummary, Provider, ProviderStatus, UsageLimit, UsageSummary } from './types'
import { formatCountdown, normalizeLimitReset } from './reset'

export function summarizeProviders(state: AppState, now = new Date()): UsageSummary[] {
  return state.providers.map((provider) => summarizeProvider(provider, now))
}

export function summarizeProvider(provider: Provider, now = new Date()): UsageSummary {
  const limits = provider.models
    .flatMap((model) => model.limits)
    .map((limit) => summarizeLimit(limit, now))

  const remainingPercent = limits.length
    ? Math.min(...limits.map((summary) => summary.remainingPercent))
    : 100
  const status = limits.length ? combineStatus(limits.map((summary) => summary.status)) : 'unknown'
  const nextResetAt = limits.length
    ? limits
        .map((summary) => summary.limit.resetRule.nextResetAt)
        .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0]
    : now.toISOString()

  return {
    provider,
    limits,
    status,
    nextResetAt,
    remainingPercent,
  }
}

export function summarizeLimit(limit: UsageLimit, now = new Date()): LimitSummary {
  const normalized = normalizeLimitReset(limit, now)
  const used = Math.max(0, normalized.usedQuota)
  const maxQuota = Math.max(0, normalized.maxQuota)
  const remaining = Math.max(0, maxQuota - used)
  const remainingPercent = maxQuota === 0 ? 0 : Math.round((remaining / maxQuota) * 100)
  const status = getStatus(remainingPercent, normalized.warningThresholdPercent, maxQuota)

  return {
    limit: normalized,
    used,
    remaining,
    remainingPercent,
    status,
    resetCountdown: formatCountdown(normalized.resetRule.nextResetAt, now),
  }
}

export function applyDueResets(state: AppState, now = new Date()): AppState {
  return {
    ...state,
    providers: state.providers.map((provider) => ({
      ...provider,
      models: provider.models.map((model) => ({
        ...model,
        limits: model.limits.map((limit) => normalizeLimitReset(limit, now)),
      })),
    })),
  }
}

export function getStatus(remainingPercent: number, threshold: number, maxQuota: number): ProviderStatus {
  if (maxQuota <= 0) return 'unknown'
  if (remainingPercent <= 0) return 'red'
  if (remainingPercent <= threshold) return 'yellow'
  return 'green'
}

export function combineStatus(statuses: ProviderStatus[]): ProviderStatus {
  if (statuses.includes('red')) return 'red'
  if (statuses.includes('yellow')) return 'yellow'
  if (statuses.includes('green')) return 'green'
  return 'unknown'
}

export function formatUnit(value: number, unit: UsageLimit['unit']) {
  const rounded = unit === 'dollars' ? value.toFixed(2) : Math.round(value).toLocaleString()
  return unit === 'dollars' ? `$${rounded}` : rounded
}
