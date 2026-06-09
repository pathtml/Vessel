import { normalizeUsagePeriod } from '../domain/usage'
import type { ProviderUsageAdapter, UsagePeriod } from '../domain/types'

export class ManualUsageAdapter implements ProviderUsageAdapter {
  providerId: string
  providerName: string
  sourceType = 'manual' as const
  private periods: UsagePeriod[]

  constructor(providerId: string, providerName: string, periods: UsagePeriod[]) {
    this.providerId = providerId
    this.providerName = providerName
    this.periods = periods
  }

  async isConfigured() {
    return this.periods.some((period) => period.limit)
  }

  async fetchUsagePeriods() {
    return this.periods.map((period) => normalizeUsagePeriod({ ...period, sourceType: 'manual' }))
  }
}

export class EstimatedUsageAdapter implements ProviderUsageAdapter {
  providerId: string
  providerName: string
  sourceType = 'estimated' as const
  private periods: UsagePeriod[]

  constructor(providerId: string, providerName: string, periods: UsagePeriod[]) {
    this.providerId = providerId
    this.providerName = providerName
    this.periods = periods
  }

  async isConfigured() {
    return this.periods.some((period) => period.limit)
  }

  async fetchUsagePeriods() {
    return this.periods.map((period) => normalizeUsagePeriod({ ...period, sourceType: 'estimated' }))
  }
}

export class UnsupportedProviderAdapter implements ProviderUsageAdapter {
  providerId: string
  providerName: string
  sourceType = 'unsupported' as const

  constructor(providerId: string, providerName: string) {
    this.providerId = providerId
    this.providerName = providerName
  }

  async isConfigured() {
    return false
  }

  async fetchUsagePeriods() {
    return []
  }
}
