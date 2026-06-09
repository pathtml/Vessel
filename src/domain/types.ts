export type UsageSourceType = 'official' | 'local' | 'manual' | 'estimated' | 'unsupported'

export type UsagePeriodLabel = '5h' | 'daily' | 'weekly' | 'monthly' | 'custom'

export type ResetRoutineType =
  | 'rolling_5h'
  | 'fixed_daily'
  | 'fixed_weekly'
  | 'fixed_monthly'
  | 'custom_hours'
  | 'custom_datetime'

export type ResetDisplayFormat =
  | 'relative_countdown'
  | 'time_only'
  | 'date_only'
  | 'date_time'
  | 'weekday_date'
  | 'custom'

export type ProviderStatus = 'green' | 'yellow' | 'red' | 'neutral'

export type ProviderKind =
  | 'chatgpt'
  | 'chatgpt_codex'
  | 'claude'
  | 'gemini'
  | 'perplexity'
  | 'cursor'
  | 'github_copilot'
  | 'openai_api'
  | 'claude_api'
  | 'custom'

export interface ResetRoutine {
  type: ResetRoutineType
  timezone: string
  intervalHours?: number
  resetHour?: number
  resetMinute?: number
  weeklyResetDay?: number
  monthlyResetDay?: number
  customResetAt?: string
}

export interface ResetDisplaySettings {
  periodId: string
  format: ResetDisplayFormat
  customFormat?: string
  use24HourTime: boolean
  timezone: string
}

export interface UsagePeriod {
  id: string
  label: UsagePeriodLabel
  limit?: number
  used?: number
  remaining?: number
  percentageRemaining?: number
  resetRoutine: ResetRoutine
  resetDisplaySettings: ResetDisplaySettings
  nextResetAt?: string
  sourceType: UsageSourceType
  setupConfirmed: boolean
}

export interface AiProvider {
  id: string
  name: string
  displayName: string
  kind: ProviderKind
  enabled: boolean
  active: boolean
  sourceType: UsageSourceType
  supportedPeriods: UsagePeriod[]
  selectedDisplayPeriodId: string
  tooltipPeriodIds: string[]
  tooltipSettings: TooltipSettings
  warningThresholdPercent: number
  credentialKey?: string
  hasCredential?: boolean
  organizationId?: string
  projectId?: string
  workspaceId?: string
  createdAt: string
  lastUpdatedAt?: string
  notes?: string
}

export interface TooltipSettings {
  showPercentage: boolean
  showRemaining: boolean
  showNextReset: boolean
  showSourceType: boolean
  showLastUpdated: boolean
}

export interface UsageRecord {
  id: string
  providerId: string
  periodId: string
  amountUsed: number
  note?: string
  occurredAt: string
}

export interface NotificationRule {
  id: string
  providerId: string
  periodId: string
  enabled: boolean
  thresholdPercent: number
  cooldownMinutes: number
  lastNotifiedAt?: string
}

export interface IntegrationCredential {
  id: string
  providerId: string
  kind: 'apiKey' | 'adminApiKey'
  storageKey: string
  createdAt: string
}

export interface AppSettings {
  openAtLogin: boolean
  openDashboardOnStartup: boolean
  startMinimizedToTray: boolean
  notificationsEnabled: boolean
  privacyNoteAccepted: boolean
  defaultTimezone: string
}

export interface AppState {
  providers: AiProvider[]
  usageRecords: UsageRecord[]
  notificationRules: NotificationRule[]
  credentials: IntegrationCredential[]
  settings: AppSettings
}

export interface TrayDisplayState {
  percentage?: number
  status: ProviderStatus
  tooltip: string
  activeProvider?: AiProvider
  activePeriod?: UsagePeriod
}

export interface ProviderUsageAdapter {
  providerId: string
  providerName: string
  sourceType: UsageSourceType

  isConfigured(): Promise<boolean>
  fetchUsagePeriods(): Promise<UsagePeriod[]>
  validateCredentials?(): Promise<boolean>
}

export interface ProviderDraft {
  id?: string
  kind: ProviderKind
  name: string
  displayName: string
  sourceType: UsageSourceType
  active: boolean
  selectedDisplayPeriodId: string
  tooltipPeriodIds: string[]
  warningThresholdPercent: number
  notes?: string
  apiKey?: string
  periods: UsagePeriod[]
}
