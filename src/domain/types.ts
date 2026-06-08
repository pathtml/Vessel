export type UsageSource = 'manual' | 'estimated' | 'official'
export type LimitUnit = 'messages' | 'tokens' | 'credits' | 'requests' | 'dollars'
export type ResetFrequency = 'daily' | 'weekly' | 'monthly' | 'customHours'
export type ProviderStatus = 'green' | 'yellow' | 'red' | 'unknown'
export type ProviderPlan = 'Free' | 'Plus' | 'Pro' | 'Team' | 'API' | 'Custom'

export interface Provider {
  id: string
  name: string
  plan: ProviderPlan
  source: UsageSource
  adapterId: string
  models: ProviderModel[]
  createdAt: string
  updatedAt: string
}

export interface ProviderModel {
  id: string
  providerId: string
  name: string
  limits: UsageLimit[]
  enabled: boolean
}

export interface UsageLimit {
  id: string
  providerId: string
  modelId?: string
  unit: LimitUnit
  maxQuota: number
  usedQuota: number
  resetRule: ResetRule
  warningThresholdPercent: number
  source: UsageSource
}

export interface ResetRule {
  frequency: ResetFrequency
  customHours?: number
  timezone: string
  lastResetAt: string
  nextResetAt: string
  weeklyResetDay?: 0 | 1 | 2 | 3 | 4 | 5 | 6
  monthlyResetDay?: number
}

export interface UsageRecord {
  id: string
  providerId: string
  modelId?: string
  limitId: string
  amount: number
  unit: LimitUnit
  source: UsageSource
  note?: string
  occurredAt: string
}

export interface NotificationRule {
  id: string
  providerId: string
  enabled: boolean
  thresholdPercent: number
  cooldownMinutes: number
  lastNotifiedAt?: string
}

export interface IntegrationCredential {
  id: string
  providerId: string
  kind: 'apiKey' | 'adminApiKey' | 'oauth'
  storageKey: string
  createdAt: string
}

export interface AppSettings {
  openAtLogin: boolean
  notificationsEnabled: boolean
  privacyNoteAccepted: boolean
}

export interface AppState {
  providers: Provider[]
  usageRecords: UsageRecord[]
  notificationRules: NotificationRule[]
  settings: AppSettings
}

export interface UsageSummary {
  provider: Provider
  limits: LimitSummary[]
  status: ProviderStatus
  nextResetAt: string
  remainingPercent: number
}

export interface LimitSummary {
  limit: UsageLimit
  used: number
  remaining: number
  remainingPercent: number
  status: ProviderStatus
  resetCountdown: string
}

export interface ProviderDraft {
  id?: string
  name: string
  plan: ProviderPlan
  source: UsageSource
  limitUnit: LimitUnit
  maxQuota: number
  usedQuota: number
  resetFrequency: ResetFrequency
  customHours?: number
  timezone: string
  weeklyResetDay?: 0 | 1 | 2 | 3 | 4 | 5 | 6
  monthlyResetDay?: number
  warningThresholdPercent: number
}
