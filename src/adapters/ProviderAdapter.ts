import type { UsageLimit, UsageSource } from '../domain/types'

export interface ProviderUsageSnapshot {
  source: UsageSource
  limits: UsageLimit[]
  fetchedAt: string
  note?: string
}

export interface ProviderAdapter {
  id: string
  label: string
  source: UsageSource
  supportsOfficialSync: boolean
  sync(providerId: string): Promise<ProviderUsageSnapshot>
}
