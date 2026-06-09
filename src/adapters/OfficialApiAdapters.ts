import type { ProviderUsageAdapter, UsagePeriod } from '../domain/types'

interface OfficialAdapterOptions {
  providerId: string
  providerName: string
  hasCredential?: boolean
  lastKnownPeriods?: UsagePeriod[]
}

class PlannedOfficialUsageAdapter implements ProviderUsageAdapter {
  providerId: string
  providerName: string
  sourceType = 'unsupported' as const

  constructor(options: OfficialAdapterOptions) {
    this.providerId = options.providerId
    this.providerName = options.providerName
  }

  async isConfigured() {
    return false
  }

  async validateCredentials() {
    return false
  }

  async fetchUsagePeriods() {
    return []
  }
}

export class OpenAIApiUsageAdapter extends PlannedOfficialUsageAdapter {}

export class ClaudeApiUsageAdapter extends PlannedOfficialUsageAdapter {}
